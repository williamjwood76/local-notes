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

function spansOf(doc: string, anchor = doc.length): Array<[number, number]> {
  const state = EditorState.create({ doc, selection: { anchor }, extensions: [notesLanguage] });
  const spans: Array<[number, number]> = [];
  buildDecorations(state, () => {}).between(0, doc.length, (from, to) => {
    spans.push([from, to]);
  });
  return spans;
}

function covers(spans: Array<[number, number]>, index: number): boolean {
  return spans.some(([from, to]) => index >= from && index < to) || spans.some(([from, to]) => from === to && from === index);
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

  it("renders markdown after the cursor leaves the line", () => {
    const doc = [
      "- bullet",
      "* star",
      "+ plus",
      "1. number",
      "2) paren",
      "  - nested",
      "- [ ] open",
      "- [x] done",
      "# Title",
      "A **bold** and *slant* and _under_ and ~~gone~~ and `code`",
      "H~2~O and E=mc^2^",
      "> quoted",
      "[site](https://example.com)",
      "<https://example.com/auto>",
      "see www.example.com",
      "[[Note]]",
      "```",
      "fence",
      "```",
      "",
      "| a | b |",
      "| --- | --- |",
      "| 1 | 2 |",
      "",
      "---",
      "",
    ].join("\n");
    const spans = spansOf(doc);
    const at = (needle: string) => {
      const index = doc.indexOf(needle);
      expect(index).toBeGreaterThan(-1);
      expect(covers(spans, index)).toBe(true);
    };
    at("- bullet");
    at("* star");
    at("+ plus");
    at("1. number");
    at("2) paren");
    at("- nested");
    at("[ ]");
    at("[x]");
    at("# Title");
    at("**bold**");
    at("*slant*");
    at("_under_");
    at("~~gone~~");
    at("`code`");
    at("~2~");
    at("^2^");
    at("> quoted");
    at("[site]");
    at("<https://example.com/auto>");
    at("www.example.com");
    at("[[Note]]");
    at("```");
    at("| a |");
    at("---");
    const quote = doc.indexOf("> quoted");
    expect(spans.some(([from, to]) => from === quote && to === quote)).toBe(true);
    const editing = spansOf(doc, 0);
    expect(covers(editing, 0)).toBe(false);
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

  it("opens an image link instead of ignoring the click", () => {
    const doc = "[[pic.png]] ![[shot.jpg]] ![alt](attachments/a.png) ![web](https://example.com/a.png)\n";
    const state = EditorState.create({ doc, extensions: [notesLanguage] });
    expect(linkActionAt(state, doc.indexOf("pic"))).toEqual({
      kind: "note",
      spec: { target: "pic.png", heading: null, blockId: null },
    });
    expect(linkActionAt(state, doc.indexOf("shot"))).toEqual({
      kind: "note",
      spec: { target: "shot.jpg", heading: null, blockId: null },
    });
    expect(linkActionAt(state, doc.indexOf("attachments"))).toEqual({
      kind: "note",
      spec: { target: "attachments/a.png", heading: null, blockId: null },
    });
    expect(linkActionAt(state, doc.indexOf("https"))).toEqual({ kind: "url", url: "https://example.com/a.png" });
  });

  it("follows a link on a plain click and only edits on option-click", () => {
    expect(followOnClick(0, false)).toBe(true);
    expect(followOnClick(0, true)).toBe(false);
    expect(followOnClick(2, false)).toBe(false);
  });
});
