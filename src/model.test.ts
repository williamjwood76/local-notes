import { describe, expect, it } from "vitest";
import { writeProperty } from "./frontmatter";
import { closeLeaf, closeTab, emptyLayout, findTabs, splitLeaf } from "./layout";
import { parseNote, parseWikiTarget, sectionRange } from "./parser";
import { makeResolver } from "./resolve";
import { searchNotes } from "./search";
import type { Note } from "./types";
import { expandTemplate } from "./template";

const note = (path: string, content: string): Note => parseNote(path, content, 0);

describe("parser", () => {
  it("reads frontmatter, headings, tags, links, embeds, and block ids", () => {
    const parsed = parseNote(
      "journal/Today.md",
      `---
tags: [daily, planning]
status: open
count: 2
done: false
---
# Today

See [[Projects/Atlas|Atlas]] and [[Missing#Heading]].
![[Projects/Atlas#^ship]]
A paragraph about #focus.
^ship

\`[[not a link]]\`

\`\`\`
#not-a-tag
[[hidden]]
\`\`\`

[local](Projects/Atlas.md#Heading)
`,
    );

    expect(parsed.title).toBe("Today");
    expect(parsed.properties).toEqual({
      tags: ["daily", "planning"],
      status: "open",
      count: 2,
      done: false,
    });
    expect(parsed.tags).toEqual(["daily", "focus", "planning"]);
    expect(parsed.headings).toEqual([{ text: "Today", level: 1, offset: expect.any(Number) }]);
    expect(parsed.links.map((link) => [link.embed, link.target, link.alias, link.heading, link.blockId])).toEqual([
      [false, "Projects/Atlas", "Atlas", null, null],
      [false, "Missing", null, "Heading", null],
      [true, "Projects/Atlas", null, null, "ship"],
      [false, "Projects/Atlas", "local", "Heading", null],
    ]);
    expect(parsed.blocks).toHaveLength(1);
    expect(parsed.blocks[0].id).toBe("ship");
    expect(parsed.content.slice(parsed.blocks[0].start, parsed.blocks[0].end)).toContain("A paragraph");
  });

  it("parses wiki targets", () => {
    expect(parseWikiTarget("Note#^block|alias")).toEqual({
      target: "Note",
      alias: "alias",
      heading: null,
      blockId: "block",
    });
  });

  it("slices a heading section", () => {
    const parsed = note(
      "a.md",
      `# One

body

## Nested

inner

# Two
`,
    );
    const range = sectionRange(parsed, "One", null);
    expect(parsed.content.slice(range.start, range.end)).toContain("Nested");
    expect(parsed.content.slice(range.start, range.end)).not.toContain("# Two");
  });
});

describe("frontmatter writes", () => {
  it("updates one property and leaves the body untouched", () => {
    const original = "---\nstatus: open\n---\n# Hello\n\nBody stays.\n";
    const next = writeProperty(original, "status", "closed");
    expect(next).toContain("status: closed");
    expect(next.endsWith("# Hello\n\nBody stays.\n")).toBe(true);
    expect(writeProperty(next, "count", 3)).toContain("count: 3");
  });

  it("removes the frontmatter block when the last property is cleared", () => {
    const next = writeProperty("---\nstatus: open\n---\n# Hello\n", "status", null);
    expect(next).toBe("# Hello\n");
  });
});

describe("link resolution", () => {
  const notes = [
    note("Atlas.md", "# Atlas"),
    note("work/Atlas.md", "# Work Atlas"),
    note("work/Plan.md", "# Plan\n\n[[Atlas]]"),
  ];
  const resolve = makeResolver(notes);

  it("matches a unique filename and reports ambiguous names", () => {
    expect(resolve("Plan")).toEqual({ status: "ok", path: "work/Plan.md" });
    expect(resolve("atlas")).toEqual({
      status: "ambiguous",
      paths: ["Atlas.md", "work/Atlas.md"],
    });
  });

  it("matches a path when the link contains a slash", () => {
    expect(resolve("work/Atlas")).toEqual({ status: "ok", path: "work/Atlas.md" });
    expect(resolve("missing")).toEqual({ status: "missing" });
  });
});

describe("search", () => {
  it("filters by tag and jumps to the matching line", () => {
    const notes = [
      note("a.md", "---\ntags: [project]\n---\n# Alpha\n\nShip the graph\n"),
      note("b.md", "# Beta\n\nNothing here\n"),
    ];
    const hits = searchNotes(notes, "tag:project graph");
    expect(hits).toHaveLength(1);
    expect(hits[0].path).toBe("a.md");
    expect(hits[0].snippet.toLowerCase()).toContain("graph");
    expect(hits[0].line).toBeGreaterThan(1);
  });
});

describe("templates and layout", () => {
  it("expands template tokens", () => {
    const date = new Date(2026, 10, 11, 9, 5);
    expect(expandTemplate("# {{title}}\n{{date}} {{time}}", "Standup", date)).toBe(
      "# Standup\n2026-11-11 09:05",
    );
  });

  it("splits, closes a tab, and collapses an empty pane", () => {
    const root = emptyLayout();
    const split = splitLeaf(root, root.id, "horizontal");
    expect(split.type).toBe("split");
    if (split.type !== "split" || split.first.type !== "tabs") throw new Error("expected split");
    const withTab = {
      ...split,
      first: {
        ...split.first,
        active: "t1",
        tabs: [{ id: "t1", kind: "note" as const, path: "a.md" }],
      },
    };
    const closed = closeTab(withTab, split.first.id, "t1");
    const leaf = findTabs(closed, split.first.id);
    expect(leaf?.tabs).toHaveLength(0);
    const collapsed = closeLeaf(closed, split.second.type === "tabs" ? split.second.id : "");
    expect(collapsed.type).toBe("tabs");
  });
});
