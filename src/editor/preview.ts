import { syntaxTree } from "@codemirror/language";
import katex from "katex";
import { type EditorState, StateEffect, StateField, RangeSetBuilder } from "@codemirror/state";
import {
  Decoration,
  type DecorationSet,
  EditorView,
  WidgetType,
  ViewPlugin,
} from "@codemirror/view";
import type { SyntaxNode, SyntaxNodeRef } from "@lezer/common";
import { bridge, type OpenSpec } from "../bridge";
import { parseWikiTarget, sectionRange } from "../parser";
import { isImagePath, resolveAttachment } from "../resolve";
import { readBytes } from "../api";
import { findMath } from "./math";

export const refreshEffect = StateEffect.define<null>();

const imageUrls = new Map<string, string>();
const imagePending = new Set<string>();

function mime(path: string): string {
  const ext = path.split(".").pop()?.toLowerCase();
  if (ext === "jpg" || ext === "jpeg") return "image/jpeg";
  if (ext === "gif") return "image/gif";
  if (ext === "webp") return "image/webp";
  if (ext === "svg") return "image/svg+xml";
  return "image/png";
}

function requestImage(path: string, refresh: () => void) {
  if (imageUrls.has(path) || imagePending.has(path)) return;
  imagePending.add(path);
  void readBytes(path)
    .then((encoded) => {
      const binary = atob(encoded);
      const bytes = new Uint8Array(binary.length);
      for (let index = 0; index < binary.length; index++) bytes[index] = binary.charCodeAt(index);
      imageUrls.set(path, URL.createObjectURL(new Blob([bytes], { type: mime(path) })));
      imagePending.delete(path);
      refresh();
    })
    .catch(() => {
      imagePending.delete(path);
    });
}

class StyledWidget extends WidgetType {
  constructor(
    readonly text: string,
    readonly className: string,
    readonly pos: number,
  ) {
    super();
  }

  eq(other: StyledWidget): boolean {
    return other.text === this.text && other.className === this.className;
  }

  toDOM(view: EditorView): HTMLElement {
    const element = document.createElement("span");
    element.className = this.className;
    element.textContent = this.text;
    element.addEventListener("mousedown", (event) => {
      event.preventDefault();
      const coords = view.posAtCoords({ x: event.clientX, y: event.clientY });
      view.dispatch({ selection: { anchor: coords ?? this.pos } });
      view.focus();
    });
    return element;
  }

  ignoreEvent(): boolean {
    return true;
  }
}

class LinkWidget extends WidgetType {
  constructor(
    readonly label: string,
    readonly spec: OpenSpec,
  ) {
    super();
  }

  eq(other: LinkWidget): boolean {
    return other.label === this.label && other.spec.target === this.spec.target && other.spec.heading === this.spec.heading && other.spec.blockId === this.spec.blockId;
  }

  toDOM(): HTMLElement {
    const link = document.createElement("a");
    link.className = "wikilink";
    link.href = "#";
    link.textContent = this.label;
    link.addEventListener("mousedown", (event) => {
      event.preventDefault();
      event.stopPropagation();
      bridge.openLink(this.spec);
    });
    return link;
  }

  ignoreEvent(): boolean {
    return true;
  }
}

class ImageWidget extends WidgetType {
  constructor(
    readonly src: string | null,
    readonly alt: string,
  ) {
    super();
  }

  eq(other: ImageWidget): boolean {
    return other.src === this.src && other.alt === this.alt;
  }

  toDOM(): HTMLElement {
    if (!this.src) {
      const missing = document.createElement("span");
      missing.className = "embed-missing";
      missing.textContent = this.alt;
      return missing;
    }
    const image = document.createElement("img");
    image.className = "embed-image";
    image.alt = this.alt;
    image.src = this.src;
    return image;
  }

  ignoreEvent(): boolean {
    return false;
  }
}

class NoteEmbedWidget extends WidgetType {
  constructor(
    readonly title: string,
    readonly text: string,
    readonly spec: OpenSpec,
    readonly missing: boolean,
  ) {
    super();
  }

  eq(other: NoteEmbedWidget): boolean {
    return other.title === this.title && other.text === this.text && other.missing === this.missing;
  }

  toDOM(): HTMLElement {
    const box = document.createElement("div");
    box.className = this.missing ? "note-embed missing" : "note-embed";
    const heading = document.createElement("div");
    heading.className = "note-embed-title";
    heading.textContent = this.title;
    const body = document.createElement("div");
    body.className = "note-embed-body";
    body.textContent = this.text;
    box.append(heading, body);
    box.addEventListener("mousedown", (event) => {
      event.preventDefault();
      if (!this.missing) bridge.openLink(this.spec);
    });
    return box;
  }

  ignoreEvent(): boolean {
    return true;
  }
}

class MathWidget extends WidgetType {
  constructor(
    readonly tex: string,
    readonly display: boolean,
  ) {
    super();
  }

  eq(other: MathWidget): boolean {
    return other.tex === this.tex && other.display === this.display;
  }

  toDOM(): HTMLElement {
    const element = document.createElement("span");
    element.className = this.display ? "math-display" : "math-inline";
    try {
      katex.render(this.tex, element, { throwOnError: false, displayMode: this.display });
    } catch {
      element.textContent = this.tex;
    }
    return element;
  }

  ignoreEvent(): boolean {
    return true;
  }
}

class MermaidWidget extends WidgetType {
  constructor(readonly source: string) {
    super();
  }

  eq(other: MermaidWidget): boolean {
    return other.source === this.source;
  }

  toDOM(): HTMLElement {
    const host = document.createElement("div");
    host.className = "mermaid-block";
    host.textContent = "Drawing diagram…";
    const source = this.source;
    void import("mermaid").then(async ({ default: mermaid }) => {
      mermaid.initialize({ startOnLoad: false, securityLevel: "strict", theme: "dark" });
      const id = `diagram-${Math.random().toString(36).slice(2)}`;
      const drawn = await mermaid.render(id, source);
      if (host.isConnected) host.innerHTML = drawn.svg;
    }).catch((error: unknown) => {
      host.textContent = error instanceof Error ? error.message : String(error);
    });
    return host;
  }

  ignoreEvent(): boolean {
    return true;
  }
}

class CodeWidget extends WidgetType {
  constructor(readonly text: string) {
    super();
  }

  eq(other: CodeWidget): boolean {
    return other.text === this.text;
  }

  toDOM(): HTMLElement {
    const pre = document.createElement("pre");
    pre.className = "code-block";
    pre.textContent = this.text;
    return pre;
  }
}

class RuleWidget extends WidgetType {
  toDOM(): HTMLElement {
    const rule = document.createElement("hr");
    rule.className = "md-rule";
    return rule;
  }

  eq(): boolean {
    return true;
  }
}

class CalloutWidget extends WidgetType {
  constructor(readonly kind: string) {
    super();
  }

  eq(other: CalloutWidget): boolean {
    return other.kind === this.kind;
  }

  toDOM(): HTMLElement {
    const label = document.createElement("span");
    label.className = `callout-label kind-${this.kind.toLowerCase()}`;
    label.textContent = this.kind;
    return label;
  }
}

class TableWidget extends WidgetType {
  constructor(readonly rows: string[][]) {
    super();
  }

  eq(other: TableWidget): boolean {
    return JSON.stringify(other.rows) === JSON.stringify(this.rows);
  }

  toDOM(): HTMLElement {
    const table = document.createElement("table");
    table.className = "md-table";
    for (const [index, row] of this.rows.entries()) {
      const line = document.createElement("tr");
      for (const cell of row) {
        const item = document.createElement(index === 0 ? "th" : "td");
        item.textContent = cell;
        line.append(item);
      }
      table.append(line);
    }
    return table;
  }
}

class CheckWidget extends WidgetType {
  constructor(
    readonly checked: boolean,
    readonly from: number,
  ) {
    super();
  }

  eq(other: CheckWidget): boolean {
    return other.checked === this.checked && other.from === this.from;
  }

  toDOM(view: EditorView): HTMLElement {
    const input = document.createElement("input");
    input.type = "checkbox";
    input.className = "task-box";
    input.checked = this.checked;
    input.addEventListener("mousedown", (event) => {
      event.preventDefault();
      event.stopPropagation();
      const line = view.state.doc.lineAt(this.from);
      const next = line.text.includes("[ ]")
        ? line.text.replace("[ ]", "[x]")
        : line.text.replace(/\[[xX]\]/, "[ ]");
      view.dispatch({ changes: { from: line.from, to: line.to, insert: next } });
    });
    return input;
  }

  ignoreEvent(): boolean {
    return true;
  }
}

const NESTED = new Set(["WikiLink", "Embed", "Image", "InlineCode", "FencedCode", "HashTag"]);

function subtreeHas(node: SyntaxNode, names: Set<string>): boolean {
  let child = node.firstChild;
  while (child) {
    if (names.has(child.name) || subtreeHas(child, names)) return true;
    child = child.nextSibling;
  }
  return false;
}

function fullyOnCursorLine(state: EditorState, from: number, to: number): boolean {
  const line = state.doc.lineAt(state.selection.main.head);
  return from >= line.from && to <= line.to;
}

function onCursorLine(state: EditorState, from: number, to: number): boolean {
  const line = state.doc.lineAt(state.selection.main.head);
  return from <= line.to && to >= line.from;
}

function innerWrapped(raw: string, name: string): string {
  if (name === "StrongEmphasis") return raw.replace(/^(?:\*\*|__)/, "").replace(/(?:\*\*|__)$/, "");
  if (name === "Emphasis") return raw.replace(/^(?:\*|_)/, "").replace(/(?:\*|_)$/, "");
  if (name === "Strikethrough") return raw.replace(/^~~/, "").replace(/~~$/, "");
  if (name === "InlineCode") return raw.replace(/^`+/, "").replace(/`+$/, "");
  if (name.startsWith("ATXHeading") || name.startsWith("SetextHeading")) {
    return raw.replace(/^#{1,6}[ \t]+/, "").replace(/\s+#+\s*$/, "").trim();
  }
  return raw;
}

function fenceLang(raw: string): string {
  const first = raw.split("\n", 1)[0] ?? "";
  return first.replace(/^(?:`{3,}|~{3,})\s*/, "").trim().toLowerCase();
}

function fenceBody(raw: string): string {
  const lines = raw.replace(/\n$/, "").split("\n");
  if (lines.length >= 2 && /^(```|~~~)/.test(lines[0]) && /^(```|~~~)/.test(lines[lines.length - 1])) {
    return lines.slice(1, -1).join("\n");
  }
  return raw;
}

function tableRows(raw: string): string[][] {
  return raw
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line && !/^\|?\s*:?-{3,}/.test(line.replace(/\|/g, "").trim()) && !/^\|?\s*:?-+:?\s*(\|\s*:?-+:?\s*)+\|?\s*$/.test(line))
    .map((line) =>
      line
        .replace(/^\|/, "")
        .replace(/\|$/, "")
        .split("|")
        .map((cell) => cell.trim()),
    );
}

function specFrom(rawInner: string): OpenSpec {
  const parsed = parseWikiTarget(rawInner);
  return { target: parsed.target, heading: parsed.heading, blockId: parsed.blockId };
}

function linkLabel(rawInner: string): string {
  const parsed = parseWikiTarget(rawInner);
  return parsed.alias || parsed.heading || parsed.blockId || parsed.target;
}

export function linkSpecAt(state: EditorState, pos: number): OpenSpec | null {
  let node: SyntaxNode | null = syntaxTree(state).resolveInner(pos, 1);
  while (node) {
    if (node.name === "WikiLink" || node.name === "Embed") {
      const raw = state.doc.sliceString(node.from, node.to).replace(/^!?\[\[/, "").replace(/\]\]$/, "");
      const spec = specFrom(raw);
      return isImagePath(spec.target) ? null : spec;
    }
    if (node.name === "Link") {
      const raw = state.doc.sliceString(node.from, node.to);
      const match = /^\[[^\]]*\]\(([^)\s]+)\)/.exec(raw);
      if (!match || /^[a-z]+:/i.test(match[1])) return null;
      return specFrom(decodeURIComponentSafe(match[1]));
    }
    node = node.parent;
  }
  return null;
}

function decodeURIComponentSafe(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

export function buildDecorations(state: EditorState, refresh: () => void): DecorationSet {
  const blocked: Array<[number, number]> = [];
  syntaxTree(state).iterate({
    enter(node) {
      if (node.name === "FencedCode" || node.name === "InlineCode" || node.name === "CodeText") {
        blocked.push([node.from, node.to]);
        return false;
      }
      return undefined;
    },
  });
  const math = findMath(state.doc.toString(), blocked);
  const hitsMath = (from: number, to: number) => math.some((span) => from < span.to && to > span.from);
  const pieces: { from: number; to: number; deco: Decoration }[] = [];
  const add = (from: number, to: number, deco: Decoration, keep = false) => {
    if (to < from || onCursorLine(state, from, to)) return;
    if (!keep && hitsMath(from, to)) return;
    pieces.push({ from, to, deco });
  };

  syntaxTree(state).iterate({
    enter(node: SyntaxNodeRef) {
      if (fullyOnCursorLine(state, node.from, node.to)) return false;
      const raw = state.doc.sliceString(node.from, node.to);
      const blockNode = node.name === "FencedCode" || node.name === "Table" || node.name.startsWith("ATXHeading") || node.name.startsWith("SetextHeading");
      if (blockNode && onCursorLine(state, node.from, node.to)) return false;
      if (node.name === "FencedCode") {
        const body = fenceBody(raw);
        const widget = fenceLang(raw) === "mermaid" ? new MermaidWidget(body) : new CodeWidget(body);
        add(node.from, node.to, Decoration.replace({ widget }));
        return false;
      }
      if (node.name === "Table") {
        add(node.from, node.to, Decoration.replace({ widget: new TableWidget(tableRows(raw)) }));
        return false;
      }
      if (node.name.startsWith("ATXHeading") || node.name.startsWith("SetextHeading")) {
        const level = Number(node.name.replace(/\D/g, "")) || 1;
        add(node.from, node.to, Decoration.replace({ widget: new StyledWidget(innerWrapped(raw, node.name), `heading heading-${level}`, node.from) }));
        return false;
      }
      if (node.name === "HorizontalRule") {
        add(node.from, node.to, Decoration.replace({ widget: new RuleWidget() }));
        return false;
      }
      if (node.name === "WikiLink") {
        const inner = raw.replace(/^\[\[/, "").replace(/\]\]$/, "");
        add(node.from, node.to, Decoration.replace({ widget: new LinkWidget(linkLabel(inner), specFrom(inner)) }));
        return false;
      }
      if (node.name === "Embed" || node.name === "Image") {
        add(node.from, node.to, embedDecoration(raw, refresh));
        return false;
      }
      if (node.name === "HashTag") {
        add(node.from, node.to, Decoration.replace({ widget: new StyledWidget(raw, "hash-tag", node.from) }));
        return false;
      }
      if (node.name === "TaskMarker") {
        add(node.from, node.to, Decoration.replace({ widget: new CheckWidget(/\[[xX]\]/.test(raw), node.from) }));
        return false;
      }
      if (node.name === "Emphasis" || node.name === "StrongEmphasis" || node.name === "Strikethrough" || node.name === "InlineCode") {
        if (subtreeHas(node.node, NESTED)) return undefined;
        const className = node.name === "StrongEmphasis" ? "md-strong" : node.name === "Emphasis" ? "md-em" : node.name === "Strikethrough" ? "md-strike" : "md-code";
        add(node.from, node.to, Decoration.replace({ widget: new StyledWidget(innerWrapped(raw, node.name), className, node.from) }));
        return false;
      }
      if (node.name === "QuoteMark") {
        const extra = state.doc.sliceString(node.to, node.to + 1) === " " ? 1 : 0;
        add(node.from, node.to + extra, Decoration.replace({}));
        return false;
      }
      if (node.name === "Link") {
        const match = /^\[([^\]]*)\]\(([^)\s]+)\)/.exec(raw);
        if (!match) return undefined;
        const url = match[2];
        if (/^[a-z]+:/i.test(url)) {
          add(node.from, node.to, Decoration.replace({ widget: new StyledWidget(match[1] || url, "md-link", node.from) }));
        } else {
          add(node.from, node.to, Decoration.replace({ widget: new LinkWidget(match[1] || url, specFrom(decodeURIComponentSafe(url))) }));
        }
        return false;
      }
      return undefined;
    },
  });

  for (const span of math) {
    add(span.from, span.to, Decoration.replace({ widget: new MathWidget(span.tex, span.display) }), true);
  }

  const source = state.doc.toString();
  const underline = /<u>([^<\n]*)<\/u>/g;
  let underlined: RegExpExecArray | null;
  while ((underlined = underline.exec(source))) {
    add(underlined.index, underlined.index + underlined[0].length, Decoration.replace({
      widget: new StyledWidget(underlined[1], "md-u", underlined.index),
    }));
  }

  for (let lineNumber = 1; lineNumber <= state.doc.lines; lineNumber++) {
    const line = state.doc.line(lineNumber);
    if (onCursorLine(state, line.from, line.to)) continue;
    const match = /^\s*>\s*\[!([A-Za-z]+)\]/.exec(line.text);
    if (!match) continue;
    const start = line.from + line.text.indexOf("[!");
    const end = start + match[0].length - line.text.indexOf("[!");
    add(start, end, Decoration.replace({ widget: new CalloutWidget(match[1]) }));
  }

  pieces.sort((a, b) => a.from - b.from || b.to - a.to);
  const builder = new RangeSetBuilder<Decoration>();
  let cursor = 0;
  for (const piece of pieces) {
    if (piece.from < cursor) continue;
    builder.add(piece.from, piece.to, piece.deco);
    cursor = piece.to;
  }
  return builder.finish();
}

function embedDecoration(raw: string, refresh: () => void): Decoration {
  if (raw.startsWith("![")) {
    const match = /^!\[([^\]]*)\]\(([^)\s]+)\)/.exec(raw);
    const alt = match?.[1] || "image";
    const url = match?.[2] ?? "";
    if (/^[a-z]+:/i.test(url)) return Decoration.replace({ widget: new ImageWidget(url, alt) });
    return imageFor(url || alt, alt, refresh);
  }
  const inner = raw.replace(/^!\[\[/, "").replace(/\]\]$/, "");
  const spec = specFrom(inner);
  if (isImagePath(spec.target)) return imageFor(spec.target, spec.target, refresh);
  const resolved = bridge.resolve(spec.target);
  if (resolved.status !== "ok") {
    return Decoration.replace({
      widget: new NoteEmbedWidget(spec.target, "Note not found", spec, true),
    });
  }
  const note = bridge.notes.get(resolved.path);
  if (!note) return Decoration.replace({ widget: new NoteEmbedWidget(spec.target, "Note not found", spec, true) });
  const range = sectionRange(note, spec.heading, spec.blockId);
  let text = note.content.slice(range.start, range.end).trim();
  if (text.length > 1200) text = `${text.slice(0, 1200)}…`;
  return Decoration.replace({ widget: new NoteEmbedWidget(note.title, text, { ...spec, target: spec.target }, false) });
}

function imageFor(target: string, alt: string, refresh: () => void): Decoration {
  const file = resolveAttachment(bridge.files, target);
  if (!file) return Decoration.replace({ widget: new ImageWidget(null, alt) });
  const src = imageUrls.get(file) ?? null;
  if (!src) requestImage(file, refresh);
  return Decoration.replace({ widget: new ImageWidget(src, alt) });
}

function safeRefresh(view: EditorView) {
  if (view.dom.isConnected) view.dispatch({ effects: refreshEffect.of(null) });
}

const previewViews = new Set<EditorView>();

function refreshOpenPreviews() {
  for (const view of previewViews) safeRefresh(view);
}

const previewField = StateField.define<DecorationSet>({
  create(state) {
    return buildDecorations(state, refreshOpenPreviews);
  },
  update(value, transaction) {
    if (
      transaction.docChanged ||
      transaction.selection ||
      transaction.effects.some((effect) => effect.is(refreshEffect))
    ) {
      return buildDecorations(transaction.state, refreshOpenPreviews);
    }
    return value;
  },
});

// A state field can replace whole blocks such as fences and tables.
export const livePreview = [
  previewField,
  EditorView.decorations.from(previewField),
  ViewPlugin.fromClass(
    class {
      view: EditorView;
      constructor(view: EditorView) {
        this.view = view;
        previewViews.add(view);
      }
      destroy() {
        previewViews.delete(this.view);
      }
    },
  ),
];

export const linkClickHandler = EditorView.domEventHandlers({
  mousedown(event, view) {
    if (!(event.metaKey || event.ctrlKey) || event.button !== 0) return false;
    const pos = view.posAtCoords({ x: event.clientX, y: event.clientY });
    if (pos == null) return false;
    const spec = linkSpecAt(view.state, pos);
    if (!spec) return false;
    event.preventDefault();
    bridge.openLink(spec);
    return true;
  },
});

export const notesTheme = EditorView.theme(
  {
    "&": { height: "100%", backgroundColor: "transparent", color: "var(--text)" },
    ".cm-scroller": {
      fontFamily: "var(--serif)",
      fontSize: "17px",
      lineHeight: "1.65",
      overflow: "auto",
    },
    ".cm-content": { padding: "28px 32px 40vh", caretColor: "var(--accent)" },
    ".cm-line": { padding: "0" },
    "&.cm-focused": { outline: "none" },
    ".cm-cursor, .cm-dropCursor": { borderLeftColor: "var(--accent)" },
    ".cm-selectionBackground, &.cm-focused .cm-selectionBackground": { backgroundColor: "rgba(215, 161, 90, 0.28)" },
  },
  { dark: true },
);
