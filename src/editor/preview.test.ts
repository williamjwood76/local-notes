import { syntaxTree } from "@codemirror/language";
import { EditorState } from "@codemirror/state";
import { describe, expect, it } from "vitest";
import { notesLanguage } from "./language";
import { buildDecorations, followOnClick, linkActionAt } from "./preview";

function namesOf(doc: string): string[] {
  const state = EditorState.create({ doc, extensions: [notesLanguage] });
  const names: string[] = [];
  syntaxTree(state).iterate({ enter(node) { names.push(node.name); } });
  return names;
}

describe("live preview", () => {
  it("decorates markdown away from the cursor line", () => {
    const doc = "# Title\n\nA **bold** [[Atlas]] and #focus.\n\n- [ ] task\n\n```\ncode\n```\n\n> [!note] Hello\n> body\n";
    const state = EditorState.create({
      doc,
      selection: { anchor: doc.length },
      extensions: [notesLanguage],
    });
    expect(namesOf(doc)).toContain("WikiLink");
    expect(namesOf(doc)).toContain("HashTag");
    expect(buildDecorations(state, () => {}).size).toBeGreaterThan(0);
  });

  it("treats a click on a link as navigation and ignores the surrounding text", () => {
    const doc = "See [[Atlas]] and [site](https://example.com) plus plain words.\n";
    const state = EditorState.create({ doc, extensions: [notesLanguage] });
    const wiki = doc.indexOf("Atlas");
    const url = doc.indexOf("https");
    const plain = doc.indexOf("plain");
    expect(linkActionAt(state, wiki)).toEqual({
      kind: "note",
      spec: { target: "Atlas", heading: null, blockId: null },
    });
    expect(linkActionAt(state, url)).toEqual({ kind: "url", url: "https://example.com" });
    expect(linkActionAt(state, plain)).toBeNull();
  });

  it("follows a link on a plain click and only edits on option-click", () => {
    expect(followOnClick(0, false)).toBe(true);
    expect(followOnClick(0, true)).toBe(false);
    expect(followOnClick(2, false)).toBe(false);
  });
});
