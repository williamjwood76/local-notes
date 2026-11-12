import { useSyncExternalStore } from "react";
import * as api from "./api";
import { bridge, type OpenSpec } from "./bridge";
import { writeProperty } from "./frontmatter";
import {
  activeTab,
  allLeaves,
  closeLeaf,
  closeTab,
  emptyLayout,
  findGraphTab,
  findNoteTab,
  findTabs,
  firstLeaf,
  isLayoutNode,
  openTab,
  renameLayoutPaths,
  splitLeaf,
  uid,
  updateTabs,
} from "./layout";
import { annotationPath } from "./pdfmarks";
import { fileTitle, parseNote, sectionRange } from "./parser";
import { makeResolver } from "./resolve";
import { dailyFileName, expandTemplate, joinPath } from "./template";
import type {
  FsEntry,
  GraphMode,
  LayoutNode,
  LeftTab,
  Note,
  PersistedSettings,
  PropertyValue,
  Tab,
  VaultPrefs,
} from "./types";

export type Doc = { content: string; saved: string; dirty: boolean };

export type PromptState = {
  kind: "new-note" | "new-folder" | "rename" | "daily-folder" | "template-path";
  title: string;
  initial: string;
  target?: string;
};

type ScrollRequest = { path: string; offset: number; nonce: number };
type InsertRequest = { path: string; text: string; nonce: number };

export type AppState = {
  ready: boolean;
  vaultPath: string | null;
  entries: FsEntry[];
  notes: Map<string, Note>;
  notesVersion: number;
  docs: Record<string, Doc>;
  layout: LayoutNode;
  activeLeaf: string;
  leftOpen: boolean;
  leftWidth: number;
  rightOpen: boolean;
  leftTab: LeftTab;
  selection: string | null;
  expanded: Record<string, boolean>;
  dailyFolder: string;
  templatePath: string | null;
  preview: boolean;
  graphMode: GraphMode;
  graphOrphans: boolean;
  graphTag: string;
  palette: "commands" | "files" | null;
  prompt: PromptState | null;
  confirmPath: string | null;
  ambiguous: { paths: string[]; heading: string | null; blockId: string | null } | null;
  status: string;
  searchQuery: string;
  scroll: ScrollRequest | null;
  insert: InsertRequest | null;
  settings: PersistedSettings;
};

const settingsEmpty: PersistedSettings = { lastVault: null, vaults: {} };

let state: AppState = {
  ready: false,
  vaultPath: null,
  entries: [],
  notes: new Map(),
  notesVersion: 0,
  docs: {},
  layout: emptyLayout(),
  activeLeaf: "",
  leftOpen: true,
  leftWidth: 280,
  rightOpen: true,
  leftTab: "files",
  selection: null,
  expanded: {},
  dailyFolder: "",
  templatePath: null,
  preview: true,
  graphMode: "global",
  graphOrphans: true,
  graphTag: "",
  palette: null,
  prompt: null,
  confirmPath: null,
  ambiguous: null,
  status: "",
  searchQuery: "",
  scroll: null,
  insert: null,
  settings: settingsEmpty,
};
state = { ...state, activeLeaf: state.layout.type === "tabs" ? state.layout.id : "" };

const listeners = new Set<() => void>();
const saveTimers = new Map<string, number>();
let persistTimer = 0;
let unlisten: (() => void) | null = null;

function syncBridge() {
  bridge.notes = state.notes;
  bridge.files = state.entries.filter((entry) => !entry.isDir).map((entry) => entry.path);
  bridge.resolve = makeResolver(state.notes.values());
  bridge.openLink = (spec) => {
    void openLink(spec);
  };
}

function emit() {
  for (const listener of listeners) listener();
}

function setState(patch: Partial<AppState>, persist = false) {
  const notesChanged = patch.notes !== undefined && patch.notes !== state.notes;
  const entriesChanged = patch.entries !== undefined && patch.entries !== state.entries;
  state = { ...state, ...patch };
  if (notesChanged || entriesChanged) syncBridge();
  emit();
  if (persist) schedulePersist();
}

export function getState(): AppState {
  return state;
}

export function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useApp<T>(select: (state: AppState) => T): T {
  return useSyncExternalStore(subscribe, () => select(state), () => select(state));
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function setStatus(status: string) {
  setState({ status });
}

export function activePath(current = state): string | null {
  const leaf = findTabs(current.layout, current.activeLeaf) ?? firstLeaf(current.layout);
  const tab = activeTab(leaf);
  return tab?.kind === "note" ? tab.path : null;
}

function prefsFromState(): VaultPrefs {
  return {
    layout: state.layout,
    activeLeaf: state.activeLeaf,
    leftOpen: state.leftOpen,
    leftWidth: state.leftWidth,
    rightOpen: state.rightOpen,
    leftTab: state.leftTab,
    dailyFolder: state.dailyFolder,
    templatePath: state.templatePath,
    preview: state.preview,
    graphMode: state.graphMode,
    graphOrphans: state.graphOrphans,
    graphTag: state.graphTag,
    expanded: state.expanded,
  };
}

function schedulePersist() {
  window.clearTimeout(persistTimer);
  persistTimer = window.setTimeout(() => {
    void persist();
  }, 250);
}

async function persist() {
  try {
    if (!state.vaultPath) {
      await api.saveSettings(state.settings);
      return;
    }
    const settings: PersistedSettings = {
      lastVault: state.vaultPath,
      vaults: { ...state.settings.vaults, [state.vaultPath]: prefsFromState() },
    };
    state = { ...state, settings };
    await api.saveSettings(settings);
  } catch (error) {
    setStatus(message(error));
  }
}

function normalizeSettings(value: PersistedSettings | Record<string, never>): PersistedSettings {
  const lastVault = typeof value.lastVault === "string" ? value.lastVault : null;
  const vaults: Record<string, VaultPrefs> = {};
  const raw = value.vaults && typeof value.vaults === "object" ? value.vaults : {};
  for (const [path, prefs] of Object.entries(raw)) {
    if (!prefs || typeof prefs !== "object" || !isLayoutNode(prefs.layout)) continue;
    vaults[path] = {
      layout: prefs.layout,
      activeLeaf: typeof prefs.activeLeaf === "string" ? prefs.activeLeaf : firstLeaf(prefs.layout).id,
      leftOpen: prefs.leftOpen !== false,
      leftWidth: clampLeftWidth(prefs.leftWidth),
      rightOpen: prefs.rightOpen !== false,
      leftTab: prefs.leftTab === "search" || prefs.leftTab === "tags" ? prefs.leftTab : "files",
      dailyFolder: typeof prefs.dailyFolder === "string" ? prefs.dailyFolder : "",
      templatePath: typeof prefs.templatePath === "string" ? prefs.templatePath : null,
      preview: prefs.preview !== false,
      graphMode: prefs.graphMode === "local" ? "local" : "global",
      graphOrphans: prefs.graphOrphans !== false,
      graphTag: typeof prefs.graphTag === "string" ? prefs.graphTag : "",
      expanded: prefs.expanded && typeof prefs.expanded === "object" ? prefs.expanded : {},
    };
  }
  return { lastVault, vaults };
}

export async function boot() {
  try {
    const loaded = await api.loadSettings();
    state = { ...state, settings: normalizeSettings(loaded), ready: true };
  } catch (error) {
    state = { ...state, ready: true, status: message(error) };
  }
  syncBridge();
  emit();
  if (state.settings.lastVault) {
    try {
      await openVault(state.settings.lastVault);
    } catch (error) {
      setStatus(message(error));
    }
  }
}

async function watchVault() {
  if (unlisten) unlisten();
  unlisten = await api.onVaultChange((paths) => {
    void applyDiskChanges(paths);
  });
}

export async function openVault(path: string) {
  setStatus("Opening vault…");
  const entries = await api.openVault(path);
  const files = await api.readNotes();
  const notes = new Map(files.map((file) => [file.path, parseNote(file.path, file.content, file.mtimeMs)]));
  const saved = state.settings.vaults[path];
  const layout = saved?.layout ?? emptyLayout();
  const leaf = findTabs(layout, saved?.activeLeaf ?? "") ?? firstLeaf(layout);
  const expanded = { ...(saved?.expanded ?? {}) };
  for (const entry of entries) {
    if (entry.isDir && !entry.path.includes("/") && expanded[entry.path] === undefined) expanded[entry.path] = true;
  }
  setState(
    {
      vaultPath: path,
      entries,
      notes,
      notesVersion: state.notesVersion + 1,
      docs: {},
      layout,
      activeLeaf: leaf.id,
      leftOpen: saved?.leftOpen ?? true,
      leftWidth: clampLeftWidth(saved?.leftWidth),
      rightOpen: saved?.rightOpen ?? true,
      leftTab: saved?.leftTab ?? "files",
      dailyFolder: saved?.dailyFolder ?? "",
      templatePath: saved?.templatePath ?? null,
      preview: saved?.preview ?? true,
      graphMode: saved?.graphMode ?? "global",
      graphOrphans: saved?.graphOrphans ?? true,
      graphTag: saved?.graphTag ?? "",
      expanded,
      selection: null,
      status: `${notes.size} notes`,
      settings: { ...state.settings, lastVault: path },
    },
    true,
  );
  await watchVault();
}

export async function chooseVault() {
  try {
    const path = await api.pickFolder();
    if (path) await openVault(path);
  } catch (error) {
    setStatus(message(error));
  }
}

async function refreshEntries() {
  const entries = await api.vaultEntries();
  setState({ entries });
}

function replaceNote(path: string, content: string) {
  const notes = new Map(state.notes);
  notes.set(path, parseNote(path, content, Date.now()));
  return notes;
}

export function onEdit(path: string, content: string) {
  const current = state.docs[path];
  if (current?.content === content) return;
  const saved = current?.saved ?? "";
  setState({
    docs: { ...state.docs, [path]: { content, saved, dirty: content !== saved } },
    notes: replaceNote(path, content),
    notesVersion: state.notesVersion + 1,
  });
  const existing = saveTimers.get(path);
  if (existing) window.clearTimeout(existing);
  saveTimers.set(path, window.setTimeout(() => void saveDoc(path), 600));
}

export async function saveDoc(path: string) {
  const doc = state.docs[path];
  if (!doc || !doc.dirty) return;
  const snapshot = doc.content;
  try {
    await api.writeText(path, snapshot);
  } catch (error) {
    setStatus(message(error));
    return;
  }
  const current = state.docs[path];
  if (!current || current.content !== snapshot) return;
  setState({
    docs: { ...state.docs, [path]: { ...current, saved: snapshot, dirty: false } },
    status: "Saved",
  });
}

export async function ensureDoc(path: string) {
  if (state.docs[path]) return;
  try {
    const text = state.notes.get(path)?.content ?? (await api.readText(path));
    if (state.docs[path]) return;
    const notes = state.notes.has(path) ? state.notes : replaceNote(path, text);
    setState({
      docs: { ...state.docs, [path]: { content: text, saved: text, dirty: false } },
      notes,
      notesVersion: state.notesVersion + 1,
    });
  } catch (error) {
    setStatus(message(error));
  }
}

function leafIds(node: LayoutNode): string[] {
  return node.type === "tabs" ? [node.id] : [...leafIds(node.first), ...leafIds(node.second)];
}

export async function openNote(path: string, loc?: { heading: string | null; blockId: string | null }) {
  await ensureDoc(path);
  const existing = findNoteTab(state.layout, path);
  let layout = state.layout;
  let activeLeaf = state.activeLeaf;
  if (existing) {
    layout = updateTabs(layout, existing.leaf, (leaf) => ({ ...leaf, active: existing.tab }));
    activeLeaf = existing.leaf;
  } else {
    const leaf = findTabs(layout, activeLeaf) ?? firstLeaf(layout);
    const tab: Tab = { id: uid("tab"), kind: "note", path };
    layout = updateTabs(layout, leaf.id, (node) => openTab(node, tab));
    activeLeaf = leaf.id;
  }
  let scroll = state.scroll;
  if (loc && (loc.heading || loc.blockId)) {
    const note = state.notes.get(path);
    if (note) {
      scroll = { path, offset: sectionRange(note, loc.heading, loc.blockId).start, nonce: Date.now() };
    }
  }
  setState(
    {
      layout,
      activeLeaf,
      selection: path,
      expanded: expandTo(path, state.expanded),
      scroll,
    },
    true,
  );
}

export async function openLink(spec: OpenSpec) {
  const resolved = bridge.resolve(spec.target);
  if (resolved.status === "missing") {
    setStatus(`No note named ${spec.target}`);
    return;
  }
  if (resolved.status === "ambiguous") {
    setState({ ambiguous: { paths: resolved.paths, heading: spec.heading, blockId: spec.blockId } });
    return;
  }
  await openNote(resolved.path, spec);
}

export function chooseAmbiguous(path: string) {
  const pending = state.ambiguous;
  setState({ ambiguous: null });
  if (!pending) return;
  void openNote(path, { heading: pending.heading, blockId: pending.blockId });
}

export async function openPdf(path: string) {
  const existing = findPdfTab(state.layout, path);
  let layout = state.layout;
  let activeLeaf = state.activeLeaf;
  if (existing) {
    layout = updateTabs(layout, existing.leaf, (leaf) => ({ ...leaf, active: existing.tab }));
    activeLeaf = existing.leaf;
  } else {
    const leaf = findTabs(layout, activeLeaf) ?? firstLeaf(layout);
    const tab: Tab = { id: uid("tab"), kind: "pdf", path };
    layout = updateTabs(layout, leaf.id, (node) => openTab(node, tab));
    activeLeaf = leaf.id;
  }
  setState({ layout, activeLeaf, selection: path, expanded: expandTo(path, state.expanded) }, true);
}

function findPdfTab(node: LayoutNode, path: string): { leaf: string; tab: string } | null {
  if (node.type === "tabs") {
    const found = node.tabs.find((tab) => tab.kind === "pdf" && tab.path === path);
    return found ? { leaf: node.id, tab: found.id } : null;
  }
  return findPdfTab(node.first, path) ?? findPdfTab(node.second, path);
}

export function openGraph() {
  const existing = findGraphTab(state.layout);
  if (existing) {
    const layout = updateTabs(state.layout, existing.leaf, (leaf) => ({ ...leaf, active: existing.tab }));
    setState({ layout, activeLeaf: existing.leaf }, true);
    return;
  }
  const leaf = findTabs(state.layout, state.activeLeaf) ?? firstLeaf(state.layout);
  const tab: Tab = { id: uid("tab"), kind: "graph" };
  setState(
    {
      layout: updateTabs(state.layout, leaf.id, (node) => openTab(node, tab)),
      activeLeaf: leaf.id,
    },
    true,
  );
}

export function focusLeaf(id: string) {
  if (state.activeLeaf !== id) setState({ activeLeaf: id }, true);
}

export function activateTab(leafId: string, tabId: string) {
  setState(
    {
      activeLeaf: leafId,
      layout: updateTabs(state.layout, leafId, (leaf) => ({ ...leaf, active: tabId })),
    },
    true,
  );
}

export function closeTabById(leafId: string, tabId: string) {
  setState({ layout: closeTab(state.layout, leafId, tabId), activeLeaf: leafId }, true);
}

export function closeActiveTab() {
  const leaf = findTabs(state.layout, state.activeLeaf);
  if (!leaf?.active) return;
  closeTabById(leaf.id, leaf.active);
}

export function splitActive(direction: "horizontal" | "vertical") {
  const before = new Set(leafIds(state.layout));
  const layout = splitLeaf(state.layout, state.activeLeaf, direction);
  const created = leafIds(layout).find((id) => !before.has(id)) ?? state.activeLeaf;
  setState({ layout, activeLeaf: created }, true);
}

export function closePane() {
  const layout = closeLeaf(state.layout, state.activeLeaf);
  const leaf = findTabs(layout, state.activeLeaf) ?? firstLeaf(layout);
  setState({ layout, activeLeaf: leaf.id }, true);
}

export function resizeSplit(splitId: string, ratio: number) {
  const next = mapSplit(state.layout, splitId, ratio);
  setState({ layout: next }, true);
}

function mapSplit(node: LayoutNode, splitId: string, ratio: number): LayoutNode {
  if (node.type === "split" && node.id === splitId) {
    return { ...node, ratio: Math.min(0.82, Math.max(0.18, ratio)) };
  }
  if (node.type === "tabs") return node;
  return { ...node, first: mapSplit(node.first, splitId, ratio), second: mapSplit(node.second, splitId, ratio) };
}

export function togglePreview() {
  setState({ preview: !state.preview }, true);
}

export function clampLeftWidth(width: unknown): number {
  const value = typeof width === "number" && Number.isFinite(width) ? width : 280;
  return Math.min(960, Math.max(180, Math.round(value)));
}

export function setLeftWidth(width: number) {
  const leftWidth = clampLeftWidth(width);
  if (leftWidth === state.leftWidth) return;
  setState({ leftWidth }, true);
}

export function toggleLeft() {
  setState({ leftOpen: !state.leftOpen }, true);
}

export function toggleRight() {
  setState({ rightOpen: !state.rightOpen }, true);
}

export function setLeftTab(leftTab: LeftTab) {
  setState({ leftTab, leftOpen: true });
}

export function setSearchQuery(searchQuery: string) {
  setState({ searchQuery, leftTab: "search", leftOpen: true });
}

export function selectPath(path: string | null) {
  setState({ selection: path });
}

export function toggleExpanded(path: string) {
  setState({ expanded: { ...state.expanded, [path]: !state.expanded[path] }, selection: path });
}

export function setGraphMode(graphMode: GraphMode) {
  setState({ graphMode }, true);
}

export function toggleOrphans() {
  setState({ graphOrphans: !state.graphOrphans }, true);
}

export function setGraphTag(graphTag: string) {
  setState({ graphTag }, true);
}

export function showPalette(palette: "commands" | "files" | null) {
  setState({ palette });
}

export function showPrompt(prompt: PromptState | null) {
  setState({ prompt });
}

export function askNewNote() {
  showPrompt({ kind: "new-note", title: "New note", initial: "" });
}

export function askNewFolder() {
  showPrompt({ kind: "new-folder", title: "New folder", initial: "" });
}

export function askRename() {
  if (!state.selection) return;
  const name = state.selection.split("/").pop() ?? state.selection;
  showPrompt({ kind: "rename", title: "Rename", initial: name, target: state.selection });
}

export function askDelete() {
  if (state.selection) setState({ confirmPath: state.selection });
}

export function cancelConfirm() {
  setState({ confirmPath: null, ambiguous: null, prompt: null });
}

export function clearScroll(nonce: number) {
  if (state.scroll?.nonce === nonce) setState({ scroll: null });
}

export function clearInsert(nonce: number) {
  if (state.insert?.nonce === nonce) setState({ insert: null });
}

export function scrollTo(path: string, offset: number) {
  setState({ scroll: { path, offset, nonce: Date.now() } });
}

function expandTo(path: string, expanded: Record<string, boolean>) {
  const next = { ...expanded };
  const parts = path.split("/");
  let acc = "";
  for (let index = 0; index < parts.length - 1; index++) {
    acc = acc ? `${acc}/${parts[index]}` : parts[index];
    next[acc] = true;
  }
  return next;
}

export function safeRel(input: string): string | null {
  const rel = input.trim().replace(/\\/g, "/").replace(/^\/+|\/+$/g, "");
  if (!rel || rel.split("/").some((part) => !part || part === "." || part === "..")) return null;
  return rel;
}

function parentFolder(): string {
  const selected = state.selection;
  if (!selected) return "";
  const entry = state.entries.find((item) => item.path === selected);
  if (entry?.isDir) return selected;
  const slash = selected.lastIndexOf("/");
  return slash === -1 ? "" : selected.slice(0, slash);
}

async function ensureParent(path: string) {
  const slash = path.lastIndexOf("/");
  if (slash === -1) return;
  const parent = path.slice(0, slash);
  if (!state.entries.some((entry) => entry.isDir && entry.path === parent)) await api.createDir(parent);
}

export async function submitPrompt(value: string) {
  const prompt = state.prompt;
  if (!prompt) return;
  setState({ prompt: null });
  try {
    if (prompt.kind === "daily-folder") {
      const folder = value.trim() ? safeRel(value) : "";
      if (value.trim() && !folder) {
        setStatus("That folder path is not allowed");
        return;
      }
      setState({ dailyFolder: folder ?? "" }, true);
      return;
    }
    if (prompt.kind === "template-path") {
      const templatePath = value.trim() ? safeRel(value) : null;
      if (value.trim() && !templatePath) {
        setStatus("That template path is not allowed");
        return;
      }
      setState({ templatePath }, true);
      return;
    }
    if (prompt.kind === "new-folder") {
      const name = safeRel(joinPath(parentFolder(), value.trim()));
      if (!name) return;
      await api.createDir(name);
      await refreshEntries();
      setState({ expanded: { ...state.expanded, [name]: true }, selection: name });
      return;
    }
    if (prompt.kind === "rename" && prompt.target) {
      const parent = prompt.target.includes("/") ? prompt.target.slice(0, prompt.target.lastIndexOf("/")) : "";
      const next = safeRel(joinPath(parent, value.trim()));
      if (!next) return;
      await renameVaultPath(prompt.target, next);
      return;
    }
    if (prompt.kind === "new-note") {
      const withExt = /\.(md|markdown)$/i.test(value.trim()) ? value.trim() : `${value.trim()}.md`;
      const path = safeRel(joinPath(parentFolder(), withExt));
      if (!path) return;
      await ensureParent(path);
      try {
        await api.readText(path);
      } catch {
        await api.writeText(path, `# ${fileTitle(path)}\n\n`);
      }
      await refreshEntries();
      const text = await api.readText(path);
      setState({ notes: replaceNote(path, text), notesVersion: state.notesVersion + 1 });
      await openNote(path);
    }
  } catch (error) {
    setStatus(message(error));
  }
}

function rewrite(path: string, from: string, to: string, isDir: boolean): string {
  if (path === from) return to;
  if (isDir && path.startsWith(`${from}/`)) return `${to}${path.slice(from.length)}`;
  return path;
}

async function renameVaultPath(from: string, to: string) {
  const isDir = state.entries.some((entry) => entry.isDir && entry.path === from);
  await api.renamePath(from, to);
  const notes = new Map<string, Note>();
  for (const note of state.notes.values()) {
    const path = rewrite(note.path, from, to, isDir);
    notes.set(path, { ...note, path });
  }
  const docs: Record<string, Doc> = {};
  for (const [path, doc] of Object.entries(state.docs)) docs[rewrite(path, from, to, isDir)] = doc;
  setState(
    {
      notes,
      docs,
      notesVersion: state.notesVersion + 1,
      layout: renameLayoutPaths(state.layout, from, to, isDir),
      selection: rewrite(state.selection ?? from, from, to, isDir),
    },
    true,
  );
  await refreshEntries();
}

export async function confirmDelete() {
  const path = state.confirmPath;
  if (!path) return;
  setState({ confirmPath: null });
  try {
    const isDir = state.entries.some((entry) => entry.isDir && entry.path === path);
    await api.deletePath(path);
    let layout = state.layout;
    for (const leaf of allLeaves(layout)) {
      for (const tab of [...leaf.tabs]) {
        if (tab.kind !== "graph" && (tab.path === path || (isDir && tab.path.startsWith(`${path}/`)))) {
          layout = closeTab(layout, leaf.id, tab.id);
        }
      }
    }
    const notes = new Map(
      [...state.notes].filter(([notePath]) => notePath !== path && !(isDir && notePath.startsWith(`${path}/`))),
    );
    const docs: Record<string, Doc> = {};
    for (const [notePath, doc] of Object.entries(state.docs)) {
      if (notePath === path || (isDir && notePath.startsWith(`${path}/`))) continue;
      docs[notePath] = doc;
    }
    setState({ notes, docs, layout, selection: null, notesVersion: state.notesVersion + 1, status: "Deleted" }, true);
    if (!isDir && path.toLowerCase().endsWith(".pdf")) {
      await api.deletePath(annotationPath(path)).catch(() => undefined);
    }
    await refreshEntries();
  } catch (error) {
    setStatus(message(error));
  }
}

export function setNoteProperty(path: string, key: string, value: PropertyValue | null) {
  const doc = state.docs[path];
  if (!doc || !key.trim()) return;
  onEdit(path, writeProperty(doc.content, key.trim(), value));
}

export async function openDaily() {
  const name = dailyFileName();
  const path = joinPath(state.dailyFolder, name);
  if (!safeRel(path)) return;
  if (state.dailyFolder) await api.createDir(state.dailyFolder);
  let existing: string | null = null;
  try {
    existing = await api.readText(path);
  } catch {
    existing = null;
  }
  if (existing === null) {
    let content = `# ${name.replace(/\.md$/, "")}\n\n`;
    if (state.templatePath) {
      try {
        content = expandTemplate(await api.readText(state.templatePath), name.replace(/\.md$/, ""), new Date());
        if (!content.endsWith("\n")) content += "\n";
      } catch {
        setStatus("Template file was not found");
      }
    }
    await api.writeText(path, content);
    existing = content;
  }
  await refreshEntries();
  if (!getState().docs[path]?.dirty) {
    setState({ notes: replaceNote(path, existing), notesVersion: state.notesVersion + 1 });
  }
  await openNote(path);
}

export async function insertTemplate() {
  const path = activePath();
  if (!path) {
    setStatus("Open a note before inserting a template");
    return;
  }
  if (!state.templatePath) {
    showPrompt({ kind: "template-path", title: "Template note path", initial: "" });
    return;
  }
  try {
    const template = await api.readText(state.templatePath);
    const title = state.notes.get(path)?.title ?? fileTitle(path);
    setState({ insert: { path, text: expandTemplate(template, title, new Date()), nonce: Date.now() } });
  } catch (error) {
    setStatus(message(error));
  }
}

async function applyDiskChanges(paths: string[]) {
  if (!state.vaultPath || paths.length === 0) return;
  let entries = state.entries;
  try {
    entries = await api.vaultEntries();
  } catch {
    return;
  }
  const notes = new Map(state.notes);
  const docs = { ...state.docs };
  let layout = state.layout;
  for (const path of paths) {
    if (!/\.(md|markdown)$/i.test(path)) continue;
    try {
      const text = await api.readText(path);
      const doc = docs[path];
      if (doc?.dirty && doc.content !== text) continue;
      if (doc) docs[path] = { content: text, saved: text, dirty: false };
      notes.set(path, parseNote(path, text, Date.now()));
    } catch {
      if (docs[path]?.dirty) continue;
      notes.delete(path);
      delete docs[path];
      for (const leaf of allLeaves(layout)) {
        for (const tab of [...leaf.tabs]) {
          if (tab.kind === "note" && tab.path === path) layout = closeTab(layout, leaf.id, tab.id);
        }
      }
    }
  }
  const present = new Set(entries.filter((entry) => /\.(md|markdown)$/i.test(entry.path)).map((entry) => entry.path));
  for (const path of [...notes.keys()]) {
    if (!present.has(path) && !docs[path]?.dirty) notes.delete(path);
  }
  setState({ entries, notes, docs, layout, notesVersion: state.notesVersion + 1 });
}

export async function saveActive() {
  const path = activePath();
  if (path) await saveDoc(path);
}
