import { useEffect, useRef, useState, type ReactNode } from "react";
import { defaultKeymap, history, historyKeymap } from "@codemirror/commands";
import { Compartment, EditorState } from "@codemirror/state";
import { EditorView, keymap } from "@codemirror/view";
import { aliasesOf } from "../resolve";
import { activePath, attachFiles, clearInsert, clearScroll, ensureDoc, getState, onEdit, pasteImage, saveDoc, useApp } from "../store";
import { wikiChoices, wikiQuery, type WikiChoice } from "../mentions";
import { applyFormat, type FormatKind } from "./format";
import { notesLanguage } from "./language";
import { linkClickHandler, livePreview, notesTheme, refreshEffect } from "./preview";

const previewCompartment = new Compartment();
const spellCompartment = new Compartment();

function spellExtension(on: boolean) {
  return EditorView.contentAttributes.of({ spellcheck: on ? "true" : "false" });
}

function mapCaret(before: string, after: string, pos: number): number {
  let start = 0;
  const limit = Math.min(before.length, after.length);
  while (start < limit && before[start] === after[start]) start += 1;
  let endBefore = before.length;
  let endAfter = after.length;
  while (endBefore > start && endAfter > start && before[endBefore - 1] === after[endAfter - 1]) {
    endBefore -= 1;
    endAfter -= 1;
  }
  if (pos <= start) return pos;
  if (pos >= endBefore) return Math.min(after.length, pos + (endAfter - endBefore));
  return Math.min(after.length, endAfter);
}

type WikiMenu = { from: number; query: string; choices: WikiChoice[]; index: number; top: number; left: number };

export function NoteEditor({ path, children }: { path: string; children?: ReactNode }) {
  const host = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  const wikiRef = useRef<WikiMenu | null>(null);
  const content = useApp((state) => state.docs[path]?.content);
  const preview = useApp((state) => state.preview);
  const spellcheck = useApp((state) => state.spellcheck);
  const scroll = useApp((state) => state.scroll);
  const insert = useApp((state) => state.insert);
  const notesVersion = useApp((state) => state.notesVersion);
  const findOpen = useApp((state) => state.findOpen && activePath(state) === path);
  const findNonce = useApp((state) => state.findNonce);
  const [wiki, setWiki] = useState<WikiMenu | null>(null);
  const [findQuery, setFindQuery] = useState("");
  const [findAt, setFindAt] = useState(0);
  const ready = content !== undefined;
  wikiRef.current = wiki;
  wikiActions.shift = (delta) => {
    const current = wikiRef.current;
    if (!current || current.choices.length === 0) return false;
    const index = (current.index + delta + current.choices.length) % current.choices.length;
    setWiki({ ...current, index });
    return true;
  };
  wikiActions.accept = () => {
    const current = wikiRef.current;
    const view = viewRef.current;
    if (!current || !view) return false;
    const choice = current.choices[current.index];
    if (!choice) return false;
    insertChoice(view, current.from, choice.label);
    return true;
  };
  wikiActions.dismiss = () => {
    if (!wikiRef.current) return false;
    setWiki(null);
    return true;
  };
  wikiActions.sync = (view) => {
    const pos = view.state.selection.main.head;
    if (!view.state.selection.main.empty) {
      setWiki((prev) => (prev ? null : prev));
      return;
    }
    const line = view.state.doc.lineAt(pos);
    const found = wikiQuery(line.text, pos - line.from);
    if (!found) {
      setWiki((prev) => (prev ? null : prev));
      return;
    }
    const choices = wikiChoices(
      [...getState().notes.values()].map((note) => ({ title: note.title, path: note.path, aliases: aliasesOf(note) })),
      found.query,
    );
    if (choices.length === 0) {
      setWiki((prev) => (prev ? null : prev));
      return;
    }
    const coords = view.coordsAtPos(pos);
    const from = line.from + found.from;
    setWiki((prev) => {
      const index = prev && prev.query === found.query ? Math.min(prev.index, choices.length - 1) : 0;
      const top = (coords?.bottom ?? 0) + 4;
      const left = Math.max(8, coords?.left ?? 8);
      if (
        prev &&
        prev.from === from &&
        prev.query === found.query &&
        prev.index === index &&
        prev.top === top &&
        prev.left === left &&
        prev.choices.length === choices.length &&
        prev.choices.every((choice, index) => choice.label === choices[index].label && choice.detail === choices[index].detail)
      ) return prev;
      return { from, query: found.query, choices, index, top, left };
    });
  };

  useEffect(() => {
    void ensureDoc(path);
  }, [path]);

  useEffect(() => {
    if (!host.current || !ready) return;
    const initial = getState().docs[path]?.content ?? "";
    const view = new EditorView({
      parent: host.current,
      state: EditorState.create({
        doc: initial,
        extensions: [
          history(),
          keymap.of([
            { key: "Mod-s", run: () => { void saveDoc(path); return true; } },
            { key: "ArrowDown", run: () => shiftWiki(1) },
            { key: "ArrowUp", run: () => shiftWiki(-1) },
            { key: "Enter", run: () => acceptWiki() },
            { key: "Tab", run: () => acceptWiki() },
            { key: "Escape", run: () => dismissWiki() },
            ...historyKeymap,
            ...defaultKeymap,
          ]),
          notesLanguage,
          notesTheme,
          spellCompartment.of(spellExtension(getState().spellcheck)),
          EditorView.lineWrapping,
          EditorView.domEventHandlers({
            paste(event) {
              const file = pastedImage(event.clipboardData);
              if (!file) return false;
              event.preventDefault();
              void file.arrayBuffer().then((buffer) => {
                void pasteImage(path, new Uint8Array(buffer), file.type || "image/png");
              });
              return true;
            },
          }),
          linkClickHandler,
          previewCompartment.of(getState().preview ? livePreview : []),
          EditorView.updateListener.of((update) => {
            if (update.docChanged) onEdit(path, update.state.doc.toString());
            if (update.docChanged || update.selectionSet) syncWiki(update.view);
          }),
        ],
      }),
    });
    viewRef.current = view;
    return () => {
      view.destroy();
      viewRef.current = null;
    };
  }, [path, ready]);

  useEffect(() => {
    const view = viewRef.current;
    if (!view || content === undefined) return;
    const current = view.state.doc.toString();
    if (current === content) return;
    view.dispatch({
      changes: { from: 0, to: current.length, insert: content },
      selection: { anchor: mapCaret(current, content, view.state.selection.main.head) },
    });
  }, [content]);

  useEffect(() => {
    viewRef.current?.dispatch({
      effects: previewCompartment.reconfigure(preview ? livePreview : []),
    });
  }, [preview]);

  useEffect(() => {
    viewRef.current?.dispatch({ effects: spellCompartment.reconfigure(spellExtension(spellcheck)) });
  }, [spellcheck]);

  useEffect(() => {
    viewRef.current?.dispatch({ effects: refreshEffect.of(null) });
  }, [notesVersion]);

  useEffect(() => {
    const view = viewRef.current;
    if (!view || !scroll || scroll.path !== path) return;
    const anchor = Math.min(scroll.offset, view.state.doc.length);
    view.dispatch({ selection: { anchor }, scrollIntoView: true });
    view.focus();
    clearScroll(scroll.nonce);
  }, [scroll, path, ready]);

  useEffect(() => {
    const view = viewRef.current;
    if (!view || !insert || insert.path !== path) return;
    const at = view.state.selection.main.from;
    view.dispatch({
      changes: { from: at, to: view.state.selection.main.to, insert: insert.text },
      selection: { anchor: at + insert.text.length },
    });
    view.focus();
    clearInsert(insert.nonce);
  }, [insert, path, ready]);

  const findRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (!findOpen) return;
    const view = viewRef.current;
    if (view && !view.state.selection.main.empty) {
      const text = view.state.sliceDoc(view.state.selection.main.from, view.state.selection.main.to);
      if (text && !text.includes("\n") && text.length <= 80) setFindQuery(text);
    }
    findRef.current?.focus();
    findRef.current?.select();
  }, [findOpen, findNonce]);

  const format = (kind: FormatKind) => {
    const view = viewRef.current;
    if (!view) return;
    const range = view.state.selection.main;
    const change = applyFormat(view.state.doc.toString(), range.from, range.to, kind);
    view.dispatch({
      changes: { from: change.from, to: change.to, insert: change.insert },
      selection: { anchor: change.anchor, head: change.head },
    });
    view.focus();
  };

  const spots = findSpots(viewRef.current?.state.doc.toString() ?? "", findQuery);
  const showMatch = (index: number) => {
    const view = viewRef.current;
    if (!view || spots.length === 0) return;
    const at = spots[(index + spots.length) % spots.length];
    view.dispatch({
      selection: { anchor: at, head: at + findQuery.length },
      scrollIntoView: true,
    });
    setFindAt((index + spots.length) % spots.length);
  };

  useEffect(() => {
    if (findOpen && findQuery) showMatch(0);
  }, [findOpen, findQuery]);

  if (!ready) return <div className="editor-loading">Loading note…</div>;
  return (
    <>
      <FormatBar onFormat={format} />
      {findOpen ? (
        <form
          className="find-bar"
          onSubmit={(event) => {
            event.preventDefault();
            showMatch(findAt + 1);
          }}
        >
          <input
            aria-label="Find in note"
            onChange={(event) => {
              setFindQuery(event.target.value);
              setFindAt(0);
            }}
            placeholder="Find in note"
            ref={findRef}
            value={findQuery}
          />
          <span className="muted">{findQuery ? `${spots.length === 0 ? 0 : findAt + 1} of ${spots.length}` : ""}</span>
          <button onClick={() => showMatch(findAt - 1)} type="button">Previous</button>
          <button type="submit">Next</button>
        </form>
      ) : null}
      {children}
      <div
        className="editor-host"
        onDragOver={(event) => {
          if (event.dataTransfer.types.includes("Files")) event.preventDefault();
        }}
        onDrop={(event) => {
          if (event.dataTransfer.files.length === 0) return;
          event.preventDefault();
          void droppedFiles(path, event.dataTransfer.files);
        }}
        ref={host}
      />
      {wiki && wiki.choices.length > 0 ? (
        <div className="wiki-menu" style={{ top: wiki.top, left: wiki.left }}>
          {wiki.choices.map((choice, index) => (
            <button
              className={index === wiki.index ? "selected" : ""}
              key={`${choice.detail}:${choice.label}`}
              onMouseDown={(event) => {
                event.preventDefault();
                const view = viewRef.current;
                if (!view) return;
                insertChoice(view, wiki.from, choice.label);
              }}
              type="button"
            >
              <strong>{choice.label}</strong>
              <small>{choice.detail}</small>
            </button>
          ))}
        </div>
      ) : null}
    </>
  );
}

function insertChoice(view: EditorView, from: number, label: string) {
  const to = view.state.selection.main.head;
  const after = view.state.sliceDoc(to, to + 2);
  const text = after === "]]" ? label : `${label}]]`;
  view.dispatch({
    changes: { from, to, insert: text },
    selection: { anchor: from + text.length + (after === "]]" ? 2 : 0) },
  });
  view.focus();
}

function findSpots(content: string, query: string): number[] {
  if (!query) return [];
  const doc = content.toLowerCase();
  const needle = query.toLowerCase();
  const spots: number[] = [];
  let at = 0;
  while (at <= doc.length - needle.length) {
    const found = doc.indexOf(needle, at);
    if (found === -1) break;
    spots.push(found);
    at = found + needle.length;
  }
  return spots;
}

async function droppedFiles(notePath: string, files: FileList) {
  const attached: { name: string; bytes: Uint8Array }[] = [];
  for (const file of files) {
    attached.push({ name: file.name, bytes: new Uint8Array(await file.arrayBuffer()) });
  }
  await attachFiles(notePath, attached);
}

function shiftWiki(delta: number): boolean {
  return wikiActions.shift(delta);
}

function acceptWiki(): boolean {
  return wikiActions.accept();
}

function dismissWiki(): boolean {
  return wikiActions.dismiss();
}

function syncWiki(view: EditorView): void {
  wikiActions.sync(view);
}

const wikiActions = {
  shift(_delta: number) {
    return false;
  },
  accept() {
    return false;
  },
  dismiss() {
    return false;
  },
  sync(_view: EditorView) {},
};

const formats: { kind: FormatKind; label: string; title: string; className?: string }[] = [
  { kind: "bullet", label: "•", title: "Bulleted list" },
  { kind: "number", label: "1.", title: "Numbered list" },
  { kind: "bold", label: "B", title: "Bold", className: "mark bold" },
  { kind: "italic", label: "I", title: "Italic", className: "mark italic" },
  { kind: "underline", label: "U", title: "Underline", className: "mark underline" },
  { kind: "h1", label: "H1", title: "Heading 1", className: "mark" },
  { kind: "h2", label: "H2", title: "Heading 2", className: "mark" },
  { kind: "h3", label: "H3", title: "Heading 3", className: "mark" },
  { kind: "quote", label: "“”", title: "Quote" },
  { kind: "code", label: "</>", title: "Code" },
  { kind: "link", label: "🔗", title: "Link" },
  { kind: "image", label: "▣", title: "Image" },
  { kind: "table", label: "⊞", title: "Table" },
];

function FormatBar({ onFormat }: { onFormat: (kind: FormatKind) => void }) {
  return (
    <div aria-label="Formatting" className="format-bar" role="toolbar">
      {formats.map((item, index) => (
        <span key={item.kind} style={{ display: "contents" }}>
          {index === 2 || index === 8 ? <span className="sep" /> : null}
          <button
            className={item.className}
            onClick={() => onFormat(item.kind)}
            onMouseDown={(event) => event.preventDefault()}
            title={item.title}
            type="button"
          >
            {item.label}
          </button>
        </span>
      ))}
    </div>
  );
}

function pastedImage(data: DataTransfer | null): File | null {
  if (!data) return null;
  for (const item of data.items) {
    if (item.kind === "file" && item.type.startsWith("image/")) {
      const file = item.getAsFile();
      if (file) return file;
    }
  }
  for (const file of data.files) {
    if (file.type.startsWith("image/")) return file;
  }
  return null;
}
