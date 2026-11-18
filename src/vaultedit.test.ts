import { describe, expect, it } from "vitest";
import { headingRenames, linkTextFor, replaceLiteral, rewriteHeadingLinks, rewriteMovedLinks, trashDestination } from "./vaultedit";

describe("moved links", () => {
  const next = (target: string) => (target.toLowerCase() === "old" ? "New Name" : null);

  it("keeps the heading and alias on a wikilink", () => {
    expect(rewriteMovedLinks("See [[Old#Plan|the plan]] today", next)).toBe("See [[New Name#Plan|the plan]] today");
  });

  it("updates a markdown link and keeps its extension", () => {
    expect(rewriteMovedLinks("[plan](Old.md#Plan)", next)).toBe("[plan](New Name.md#Plan)");
  });

  it("leaves links inside code alone", () => {
    const source = "```\n[[Old]]\n```\n`[[Old]]`\n[[Old]]\n";
    expect(rewriteMovedLinks(source, next)).toBe("```\n[[Old]]\n```\n`[[Old]]`\n[[New Name]]\n");
  });
});

describe("link text", () => {
  it("uses the file name when it is unique and the path when it is not", () => {
    expect(linkTextFor("work/Plan.md", ["work/Plan.md", "Atlas.md"])).toBe("Plan");
    expect(linkTextFor("work/Atlas.md", ["Atlas.md", "work/Atlas.md"])).toBe("work/Atlas");
  });
});

describe("renamed headings", () => {
  it("treats one changed heading as a rename and ignores an inserted heading", () => {
    expect(headingRenames("# Old\n\n## Keep\n", "# New\n\n## Keep\n")).toEqual([{ from: "Old", to: "New" }]);
    expect(headingRenames("# A\n# B\n", "# A\n# Inserted\n# B\n")).toEqual([]);
  });

  it("updates heading links for that note and leaves other notes alone", () => {
    const source = "[[Plan#Old|see]] [[Other#Old]] [[#Old]]\n`[[Plan#Old]]`\n";
    expect(rewriteHeadingLinks(source, ["Plan"], [{ from: "Old", to: "New" }], true)).toBe(
      "[[Plan#New|see]] [[Other#Old]] [[#New]]\n`[[Plan#Old]]`\n",
    );
  });
});

describe("trash", () => {
  it("keeps the original path under a hidden trash folder", () => {
    expect(trashDestination("notes/Today.md", 5)).toBe(".trash/5/notes/Today.md");
  });
});

describe("replace", () => {
  it("replaces every literal match in one pass", () => {
    expect(replaceLiteral("a-a-a", "a", "b")).toEqual({ content: "b-b-b", count: 3 });
    expect(replaceLiteral("alpha", "", "x")).toEqual({ content: "alpha", count: 0 });
  });
});
