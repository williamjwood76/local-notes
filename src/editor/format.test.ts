import { describe, expect, it } from "vitest";
import { applyFormat } from "./format";

function applied(doc: string, from: number, to: number, kind: Parameters<typeof applyFormat>[3]) {
  const edit = applyFormat(doc, from, to, kind);
  const next = doc.slice(0, edit.from) + edit.insert + doc.slice(edit.to);
  return { next, selected: next.slice(edit.anchor, edit.head) };
}

describe("format bar", () => {
  it("wraps and removes bold", () => {
    expect(applied("say hello", 4, 9, "bold")).toMatchObject({ next: "say **hello**", selected: "hello" });
    expect(applied("say **hello**", 6, 11, "bold").next).toBe("say hello");
  });

  it("does not treat bold markers as italic", () => {
    expect(applied("**hello**", 2, 7, "italic").next).toBe("***hello***");
  });

  it("toggles a heading", () => {
    expect(applied("Title", 0, 0, "h1").next).toBe("# Title");
    expect(applied("# Title", 2, 2, "h1").next).toBe("Title");
  });

  it("numbers each selected line and can remove the numbers", () => {
    expect(applied("a\nb", 0, 3, "number").next).toBe("1. a\n2. b");
    expect(applied("1. a\n2. b", 0, 9, "number").next).toBe("a\nb");
  });

  it("turns a selection into a link and selects the address", () => {
    expect(applied("Notes", 0, 5, "link")).toMatchObject({
      next: "[Notes](https://)",
      selected: "https://",
    });
  });
});
