import { describe, expect, it } from "vitest";
import { findMath } from "./math";

describe("math", () => {
  it("reads inline and display math", () => {
    const doc = "Energy $E=mc^2$ and\n$$\nx^2\n$$";
    expect(findMath(doc).map((span) => [span.display, span.tex])).toEqual([
      [false, "E=mc^2"],
      [true, "x^2"],
    ]);
  });

  it("skips dollars inside code and escaped dollars", () => {
    const doc = "Use \\$5 or `$not math$`.";
    const codeStart = doc.indexOf("`$");
    expect(findMath(doc, [[codeStart, doc.length]])).toEqual([]);
  });
});
