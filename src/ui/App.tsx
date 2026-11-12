import { useEffect, useMemo, useState } from "react";
import { NoteEditor } from "../editor/NoteEditor";
import { fuzzyRank } from "../fuzzy";
import { fileTitle } from "../parser";
import { backlinksFor, makeResolver, outgoingFor } from "../resolve";
import { searchNotes } from "../search";
import {
  activateTab,
  activePath,
  askDelete,
  askNewFolder,
  askNewNote,
  askRename,
  boot,
  cancelConfirm,
  chooseAmbiguous,
  chooseVault,
  closeActiveTab,
  closePane,
  closeTabById,
  confirmDelete,
  focusLeaf,
  getState,
  insertTemplate,
  openDaily,
  openGraph,
  openLink,
  openNote,
  openPdf,
  resizeSplit,
  setLeftWidth,
  saveActive,
  scrollTo,
  selectPath,
  setGraphMode,
  setLeftTab,
  setNoteProperty,
  setSearchQuery,
  showPalette,
  showPrompt,
  splitActive,
  submitPrompt,
  toggleExpanded,
  toggleLeft,
  toggleOrphans,
  togglePreview,
  toggleRight,
  useApp,
} from "../store";
import { buildTree, type TreeNode } from "../tree";
import type { LayoutNode, PropertyValue, SplitNode, TabsNode } from "../types";
import { GraphView } from "./Graph";
import { PdfView } from "./PdfView";

export function App() {
  const ready = useApp((state) => state.ready);
  const vaultPath = useApp((state) => state.vaultPath);
  const layout = useApp((state) => state.layout);

  useEffect(() => {
    void boot();
  }, []);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        cancelConfirm();
        showPalette(null);
        return;
      }
      if (!(event.metaKey || event.ctrlKey)) return;
      const key = event.key.toLowerCase();
      if (key === "p") {
        event.preventDefault();
        showPalette(getState().palette === "commands" ? null : "commands");
      } else if (key === "o") {
        event.preventDefault();
        showPalette("files");
      } else if (key === "s") {
        event.preventDefault();
        void saveActive();
      } else if (key === "n") {
        event.preventDefault();
        askNewNote();
      } else if (key === "w") {
        event.preventDefault();
        closeActiveTab();
      } else if (key === "b" && event.shiftKey) {
        event.preventDefault();
        toggleRight();
      } else if (key === "b") {
        event.preventDefault();
        toggleLeft();
      } else if (key === "d") {
        event.preventDefault();
        void openDaily();
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, []);

  if (!ready) return <div className="welcome">Loading…</div>;
  if (!vaultPath) return <Welcome />;

  return (
    <div className="shell">
      <TopBar />
      <div className="workspace">
        <LeftSidebar />
        <LeftResizeHandle />
        <LayoutView node={layout} />
        <RightSidebar />
      </div>
      <StatusBar />
      <Palette />
      <PromptDialog />
      <ConfirmDialog />
      <AmbiguousDialog />
    </div>
  );
}

function Welcome() {
  return (
    <div className="welcome">
      <p className="eyebrow">Local notes</p>
      <h1>Open a folder of markdown.</h1>
      <p>Notes stay as plain files on this Mac. Wikilinks, backlinks, and the graph read that folder.</p>
      <button className="primary" onClick={() => void chooseVault()} type="button">
        Open folder
      </button>
    </div>
  );
}

function TopBar() {
  const vaultPath = useApp((state) => state.vaultPath) ?? "";
  const preview = useApp((state) => state.preview);
  const name = vaultPath.split("/").pop() || "Notes";
  return (
    <header className="topbar">
      <div>
        <strong>Notes</strong>
        <span>{name}</span>
      </div>
      <div className="top-actions">
        <button onClick={() => toggleLeft()} type="button">Files</button>
        <button onClick={() => setLeftTab("search")} type="button">Search</button>
        <button onClick={() => showPalette("commands")} type="button">Commands</button>
        <button className={preview ? "on" : ""} onClick={() => togglePreview()} type="button">
          {preview ? "Live preview" : "Source"}
        </button>
        <button onClick={() => void openDaily()} type="button">Today</button>
        <button onClick={() => void chooseVault()} type="button">Open…</button>
      </div>
    </header>
  );
}

function LeftSidebar() {
  const open = useApp((state) => state.leftOpen);
  const width = useApp((state) => state.leftWidth);
  const tab = useApp((state) => state.leftTab);
  if (!open) return null;
  return (
    <aside className="sidebar left" style={{ width }}>
      <div className="side-tabs">
        <button className={tab === "files" ? "on" : ""} onClick={() => setLeftTab("files")} type="button">Files</button>
        <button className={tab === "search" ? "on" : ""} onClick={() => setLeftTab("search")} type="button">Search</button>
        <button className={tab === "tags" ? "on" : ""} onClick={() => setLeftTab("tags")} type="button">Tags</button>
      </div>
      {tab === "files" ? <FilePane /> : null}
      {tab === "search" ? <SearchPane /> : null}
      {tab === "tags" ? <TagPane /> : null}
    </aside>
  );
}

function LeftResizeHandle() {
  const open = useApp((state) => state.leftOpen);
  if (!open) return null;
  return (
    <div
      aria-label="Resize file list"
      className="side-resize"
      onPointerDown={(event) => {
        event.preventDefault();
        const startX = event.clientX;
        const startWidth = getState().leftWidth;
        const move = (ev: PointerEvent) => setLeftWidth(startWidth + ev.clientX - startX);
        const up = () => {
          window.removeEventListener("pointermove", move);
          window.removeEventListener("pointerup", up);
        };
        window.addEventListener("pointermove", move);
        window.addEventListener("pointerup", up);
      }}
      role="separator"
    />
  );
}

function FilePane() {
  const entries = useApp((state) => state.entries);
  const expanded = useApp((state) => state.expanded);
  const selection = useApp((state) => state.selection);
  const tree = useMemo(() => buildTree(entries), [entries]);
  return (
    <div className="side-body">
      <div className="side-actions">
        <button onClick={() => askNewNote()} type="button">New note</button>
        <button onClick={() => askNewFolder()} type="button">New folder</button>
        <button disabled={!selection} onClick={() => askRename()} type="button">Rename</button>
        <button disabled={!selection} onClick={() => askDelete()} type="button">Delete</button>
      </div>
      <div className="tree">
        {tree.map((node) => (
          <TreeRow depth={0} expanded={expanded} key={node.path} node={node} selection={selection} />
        ))}
      </div>
    </div>
  );
}

function TreeRow({
  node,
  depth,
  expanded,
  selection,
}: {
  node: TreeNode;
  depth: number;
  expanded: Record<string, boolean>;
  selection: string | null;
}) {
  const isOpen = expanded[node.path];
  if (node.isDir) {
    return (
      <div>
        <button
          className={selection === node.path ? "tree-row selected" : "tree-row"}
          onClick={() => toggleExpanded(node.path)}
          style={{ paddingLeft: 8 + depth * 14 }}
          type="button"
        >
          <span className="twist">{isOpen ? "▾" : "▸"}</span>
          <span className="tree-name" title={node.name}>{node.name}</span>
        </button>
        {isOpen ? node.children.map((child) => (
          <TreeRow depth={depth + 1} expanded={expanded} key={child.path} node={child} selection={selection} />
        )) : null}
      </div>
    );
  }
  const note = /\.(md|markdown)$/i.test(node.name);
  return (
    <button
      className={selection === node.path ? "tree-row selected" : "tree-row"}
      onClick={() => {
        selectPath(node.path);
        if (note) void openNote(node.path);
        else if (/\.pdf$/i.test(node.name)) void openPdf(node.path);
      }}
      style={{ paddingLeft: 22 + depth * 14 }}
      title={node.name}
      type="button"
    >
      <span className={note ? "tree-name" : "tree-name muted"}>{node.name}</span>
    </button>
  );
}

function SearchPane() {
  const query = useApp((state) => state.searchQuery);
  const version = useApp((state) => state.notesVersion);
  const hits = useMemo(() => searchNotes(getState().notes.values(), query), [query, version]);
  return (
    <div className="side-body">
      <input
        aria-label="Search notes"
        onChange={(event) => setSearchQuery(event.target.value)}
        placeholder="Search, or tag:name"
        value={query}
      />
      <div className="result-list">
        {hits.map((hit) => (
          <button
            key={`${hit.path}:${hit.offset}`}
            onClick={() => {
              void openNote(hit.path).then(() => scrollTo(hit.path, hit.offset));
            }}
            type="button"
          >
            <strong>{hit.title}</strong>
            <small>{hit.snippet || hit.path}</small>
          </button>
        ))}
      </div>
    </div>
  );
}

function TagPane() {
  const version = useApp((state) => state.notesVersion);
  const tags = useMemo(() => {
    const counts = new Map<string, number>();
    for (const note of getState().notes.values()) {
      for (const tag of note.tags) counts.set(tag, (counts.get(tag) ?? 0) + 1);
    }
    return [...counts.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  }, [version]);
  return (
    <div className="side-body result-list">
      {tags.map(([tag, count]) => (
        <button key={tag} onClick={() => setSearchQuery(`tag:${tag}`)} style={{ paddingLeft: 8 + tag.split("/").length * 10 }} type="button">
          <strong>#{tag}</strong>
          <small>{count}</small>
        </button>
      ))}
    </div>
  );
}

function RightSidebar() {
  const open = useApp((state) => state.rightOpen);
  const path = useApp(activePath);
  const version = useApp((state) => state.notesVersion);
  if (!open) return null;
  const notes = getState().notes;
  const note = path ? notes.get(path) : undefined;
  const resolve = makeResolver(notes.values());
  void version;
  const backlinks = note ? backlinksFor(notes.values(), note.path, resolve) : [];
  const outgoing = note ? outgoingFor(note, resolve) : [];
  return (
    <aside className="sidebar right">
      <section>
        <h2>Outline</h2>
        {note?.headings.length ? note.headings.map((heading) => (
          <button
            className="outline-row"
            key={`${heading.offset}:${heading.text}`}
            onClick={() => path && scrollTo(path, heading.offset)}
            style={{ paddingLeft: 8 + (heading.level - 1) * 12 }}
            type="button"
          >
            {heading.text}
          </button>
        )) : <p className="muted">No headings</p>}
      </section>
      <section>
        <h2>Backlinks</h2>
        {backlinks.length === 0 ? <p className="muted">None</p> : backlinks.map((link) => (
          <button key={`${link.from}:${link.offset}`} onClick={() => void openAt(link.from, link.offset)} type="button">
            <strong>{link.title}</strong>
            <small>{link.line}</small>
          </button>
        ))}
      </section>
      <section>
        <h2>Outgoing</h2>
        {outgoing.length === 0 ? <p className="muted">None</p> : outgoing.map((item) => (
          <button
            key={`${item.link.target}:${item.link.offset}`}
            onClick={() => void openLink({
              target: item.link.target,
              heading: item.link.heading,
              blockId: item.link.blockId,
            })}
            type="button"
          >
            <strong>{item.link.alias || item.link.target}</strong>
            <small>{item.hit.status === "ok" ? item.hit.path : item.hit.status}</small>
          </button>
        ))}
      </section>
    </aside>
  );
}

function openAt(path: string, offset: number) {
  void openNote(path).then(() => scrollTo(path, offset));
}

function LayoutView({ node }: { node: LayoutNode }) {
  if (node.type === "split") return <SplitView node={node} />;
  return <TabPane node={node} />;
}

function SplitView({ node }: { node: SplitNode }) {
  return (
    <div className={node.direction === "horizontal" ? "split row" : "split column"}>
      <div className="split-pane" style={{ flex: node.ratio }}>
        <LayoutView node={node.first} />
      </div>
      <div
        className="split-handle"
        onPointerDown={(event) => {
          const parent = event.currentTarget.parentElement;
          if (!parent) return;
          const rect = parent.getBoundingClientRect();
          const move = (ev: PointerEvent) => {
            const ratio = node.direction === "horizontal"
              ? (ev.clientX - rect.left) / rect.width
              : (ev.clientY - rect.top) / rect.height;
            resizeSplit(node.id, ratio);
          };
          const up = () => {
            window.removeEventListener("pointermove", move);
            window.removeEventListener("pointerup", up);
          };
          window.addEventListener("pointermove", move);
          window.addEventListener("pointerup", up);
        }}
      />
      <div className="split-pane" style={{ flex: 1 - node.ratio }}>
        <LayoutView node={node.second} />
      </div>
    </div>
  );
}

function TabPane({ node }: { node: TabsNode }) {
  const active = useApp((state) => state.activeLeaf);
  const docs = useApp((state) => state.docs);
  const tab = node.tabs.find((item) => item.id === node.active) ?? null;
  return (
    <section className={active === node.id ? "pane active-pane" : "pane"} onPointerDown={() => focusLeaf(node.id)}>
      <div className="tabs">
        {node.tabs.map((item) => {
          const label = item.kind === "graph" ? "Graph" : item.kind === "pdf" ? item.path.split("/").pop() ?? item.path : fileTitle(item.path);
          const dirty = item.kind === "note" && docs[item.path]?.dirty;
          return (
            <div className={item.id === node.active ? "tab on" : "tab"} key={item.id}>
              <button onClick={() => activateTab(node.id, item.id)} type="button">
                {label}
                {dirty ? " •" : ""}
              </button>
              <button aria-label={`Close ${label}`} onClick={() => closeTabById(node.id, item.id)} type="button">×</button>
            </div>
          );
        })}
      </div>
      {tab?.kind === "note" ? (
        <div className="note-stack">
          <NoteEditor path={tab.path}>
            <Properties path={tab.path} />
          </NoteEditor>
        </div>
      ) : null}
      {tab?.kind === "graph" ? <GraphView /> : null}
      {tab?.kind === "pdf" ? <PdfView path={tab.path} /> : null}
      {!tab ? (
        <div className="empty-pane">
          <p>No note in this pane.</p>
          <button onClick={() => showPalette("files")} type="button">Quick open</button>
        </div>
      ) : null}
    </section>
  );
}

function Properties({ path }: { path: string }) {
  const version = useApp((state) => state.notesVersion);
  const note = version >= 0 ? getState().notes.get(path) : undefined;
  const [keyName, setKeyName] = useState("");
  const [draft, setDraft] = useState("");
  if (!note) return null;
  return (
    <div className="properties">
      {Object.entries(note.properties).map(([name, value]) => (
        <PropertyField key={`${path}:${name}`} name={name} path={path} value={value} />
      ))}
      <form
        className="add-property"
        onSubmit={(event) => {
          event.preventDefault();
          if (!keyName.trim()) return;
          setNoteProperty(path, keyName, inferProperty(draft));
          setKeyName("");
          setDraft("");
        }}
      >
        <input aria-label="Property name" onChange={(event) => setKeyName(event.target.value)} placeholder="Property" value={keyName} />
        <input aria-label="Property value" onChange={(event) => setDraft(event.target.value)} placeholder="Value" value={draft} />
        <button type="submit">Add</button>
      </form>
    </div>
  );
}

function PropertyField({ path, name, value }: { path: string; name: string; value: PropertyValue }) {
  const [draft, setDraft] = useState(propertyText(value));
  useEffect(() => setDraft(propertyText(value)), [name, path, JSON.stringify(value)]);
  if (typeof value === "boolean") {
    return (
      <label className="property-row">
        <span>{name}</span>
        <input checked={value} onChange={(event) => setNoteProperty(path, name, event.target.checked)} type="checkbox" />
        <button onClick={() => setNoteProperty(path, name, null)} type="button">Remove</button>
      </label>
    );
  }
  const date = typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value);
  return (
    <label className="property-row">
      <span>{name}</span>
      {Array.isArray(value) ? (
        <textarea
          onBlur={() => setNoteProperty(path, name, draft.split("\n").map((item) => item.trim()).filter(Boolean))}
          onChange={(event) => setDraft(event.target.value)}
          value={draft}
        />
      ) : (
        <input
          onBlur={() => setNoteProperty(path, name, typeof value === "number" ? Number(draft) : draft)}
          onChange={(event) => setDraft(event.target.value)}
          type={date ? "date" : typeof value === "number" ? "number" : "text"}
          value={draft}
        />
      )}
      <button onClick={() => setNoteProperty(path, name, null)} type="button">Remove</button>
    </label>
  );
}

function propertyText(value: PropertyValue): string {
  return Array.isArray(value) ? value.join("\n") : String(value);
}

function inferProperty(value: string): PropertyValue {
  if (value === "true") return true;
  if (value === "false") return false;
  if (/^-?\d+(\.\d+)?$/.test(value)) return Number(value);
  return value;
}

function StatusBar() {
  const status = useApp((state) => state.status);
  return <footer className="status">{status}</footer>;
}

const commands = [
  { title: "Quick open", hint: "⌘O", run: () => showPalette("files") },
  { title: "Toggle live preview", run: () => togglePreview() },
  { title: "Toggle file sidebar", hint: "⌘B", run: () => toggleLeft() },
  { title: "Toggle context sidebar", hint: "⇧⌘B", run: () => toggleRight() },
  { title: "Split right", run: () => splitActive("horizontal") },
  { title: "Split down", run: () => splitActive("vertical") },
  { title: "Close tab", hint: "⌘W", run: () => closeActiveTab() },
  { title: "Close pane", run: () => closePane() },
  { title: "New note", hint: "⌘N", run: () => askNewNote() },
  { title: "New folder", run: () => askNewFolder() },
  { title: "Open daily note", hint: "⌘D", run: () => void openDaily() },
  { title: "Insert template", run: () => void insertTemplate() },
  { title: "Set daily notes folder", run: () => showPrompt({ kind: "daily-folder", title: "Daily notes folder", initial: getState().dailyFolder }) },
  { title: "Set template note", run: () => showPrompt({ kind: "template-path", title: "Template note path", initial: getState().templatePath ?? "" }) },
  { title: "Open graph", run: () => openGraph() },
  { title: "Show neighboring notes", run: () => { setGraphMode("local"); openGraph(); } },
  { title: "Show full graph", run: () => { setGraphMode("global"); openGraph(); } },
  { title: "Toggle orphan notes", run: () => toggleOrphans() },
  { title: "Save", hint: "⌘S", run: () => void saveActive() },
  { title: "Open folder", run: () => void chooseVault() },
];

function Palette() {
  const palette = useApp((state) => state.palette);
  const version = useApp((state) => state.notesVersion);
  const [query, setQuery] = useState("");
  const [index, setIndex] = useState(0);
  useEffect(() => {
    setQuery("");
    setIndex(0);
  }, [palette]);
  const items = useMemo(() => {
    if (palette === "files") {
      return fuzzyRank(query, [...getState().notes.values()], (note) => `${note.title} ${note.path}`).slice(0, 40);
    }
    if (palette === "commands") return fuzzyRank(query, commands, (command) => command.title);
    return [];
  }, [palette, query, version]);
  useEffect(() => setIndex(0), [query, palette]);
  if (!palette) return null;
  const choose = (position: number) => {
    const item = items[position];
    if (!item) return;
    showPalette(null);
    if (palette === "files" && "path" in item) void openNote(item.path);
    if (palette === "commands" && "run" in item) item.run();
  };
  return (
    <div className="overlay" onMouseDown={() => showPalette(null)}>
      <div className="dialog" onMouseDown={(event) => event.stopPropagation()}>
        <input
          aria-label={palette === "files" ? "Quick open" : "Commands"}
          autoFocus
          onChange={(event) => setQuery(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "ArrowDown") {
              event.preventDefault();
              setIndex((current) => Math.min(items.length - 1, current + 1));
            } else if (event.key === "ArrowUp") {
              event.preventDefault();
              setIndex((current) => Math.max(0, current - 1));
            } else if (event.key === "Enter") {
              event.preventDefault();
              choose(index);
            }
          }}
          placeholder={palette === "files" ? "Open a note" : "Run a command"}
          value={query}
        />
        <div className="result-list">
          {items.map((item, position) => (
            <button className={position === index ? "selected" : ""} key={"path" in item ? item.path : item.title} onClick={() => choose(position)} onMouseEnter={() => setIndex(position)} type="button">
              <strong>{"path" in item ? item.title : item.title}</strong>
              <small>{"path" in item ? item.path : item.hint ?? ""}</small>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

function PromptDialog() {
  const prompt = useApp((state) => state.prompt);
  const [value, setValue] = useState("");
  useEffect(() => setValue(prompt?.initial ?? ""), [prompt]);
  if (!prompt) return null;
  return (
    <div className="overlay" onMouseDown={() => cancelConfirm()}>
      <form
        className="dialog narrow"
        onMouseDown={(event) => event.stopPropagation()}
        onSubmit={(event) => {
          event.preventDefault();
          void submitPrompt(value);
        }}
      >
        <h2>{prompt.title}</h2>
        <input aria-label={prompt.title} autoFocus onChange={(event) => setValue(event.target.value)} value={value} />
        <div className="dialog-actions">
          <button onClick={() => cancelConfirm()} type="button">Cancel</button>
          <button className="primary" type="submit">Save</button>
        </div>
      </form>
    </div>
  );
}

function ConfirmDialog() {
  const path = useApp((state) => state.confirmPath);
  if (!path) return null;
  return (
    <div className="overlay" onMouseDown={() => cancelConfirm()}>
      <div className="dialog narrow" onMouseDown={(event) => event.stopPropagation()}>
        <h2>Delete {path.split("/").pop()}?</h2>
        <p>This removes the file from the vault folder.</p>
        <div className="dialog-actions">
          <button onClick={() => cancelConfirm()} type="button">Cancel</button>
          <button className="danger" onClick={() => void confirmDelete()} type="button">Delete</button>
        </div>
      </div>
    </div>
  );
}

function AmbiguousDialog() {
  const ambiguous = useApp((state) => state.ambiguous);
  if (!ambiguous) return null;
  return (
    <div className="overlay" onMouseDown={() => cancelConfirm()}>
      <div className="dialog" onMouseDown={(event) => event.stopPropagation()}>
        <h2>Which note?</h2>
        <div className="result-list">
          {ambiguous.paths.map((path) => (
            <button key={path} onClick={() => chooseAmbiguous(path)} type="button">
              <strong>{fileTitle(path)}</strong>
              <small>{path}</small>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
