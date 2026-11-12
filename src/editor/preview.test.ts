import { syntaxTree } from "@codemirror/language";
import { EditorState } from "@codemirror/state";
import { describe, expect, it } from "vitest";
import { notesLanguage } from "./language";
import { buildDecorations } from "./preview";

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
});
