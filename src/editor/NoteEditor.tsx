import { useEffect, useRef, type ReactNode } from "react";
import { defaultKeymap, history, historyKeymap } from "@codemirror/commands";
import { Compartment, EditorState } from "@codemirror/state";
import { EditorView, keymap } from "@codemirror/view";
import { applyFormat, type FormatKind } from "./format";
import { notesLanguage } from "./language";
import { linkClickHandler, livePreview, notesTheme, refreshEffect } from "./preview";
import { clearInsert, clearScroll, ensureDoc, getState, onEdit, saveDoc, useApp } from "../store";

const previewCompartment = new Compartment();

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

export function NoteEditor({ path, children }: { path: string; children?: ReactNode }) {
  const host = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  const content = useApp((state) => state.docs[path]?.content);
  const preview = useApp((state) => state.preview);
  const scroll = useApp((state) => state.scroll);
  const insert = useApp((state) => state.insert);
  const notesVersion = useApp((state) => state.notesVersion);
  const ready = content !== undefined;

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
            ...historyKeymap,
            ...defaultKeymap,
          ]),
          notesLanguage,
          notesTheme,
          EditorView.lineWrapping,
          linkClickHandler,
          previewCompartment.of(getState().preview ? livePreview : []),
          EditorView.updateListener.of((update) => {
            if (!update.docChanged) return;
            onEdit(path, update.state.doc.toString());
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

  if (!ready) return <div className="editor-loading">Loading note…</div>;
  return (
    <>
      <FormatBar onFormat={format} />
      {children}
      <div className="editor-host" ref={host} />
    </>
  );
}

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
