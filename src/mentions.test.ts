import { describe, expect, it } from "vitest";
import { parseNote } from "./parser";
import { makeResolver } from "./resolve";
import { keepTask, mentionHits, taskItems, unlinkedMentions, wikiChoices, wikiQuery, wrapMention } from "./mentions";

describe("wiki suggestions", () => {
  it("reads the text after an unclosed wikilink", () => {
    expect(wikiQuery("See [[pla", 9)).toEqual({ from: 6, query: "pla" });
    expect(wikiQuery("[[done]]", 4)).toEqual({ from: 2, query: "do" });
    expect(wikiQuery("[[done]]", 8)).toBeNull();
    expect(wikiQuery("[[Plan#Head", 11)).toBeNull();
  });

  it("ranks titles and aliases that match", () => {
    const choices = wikiChoices(
      [
        { title: "Planning", path: "Planning.md", aliases: [] },
        { title: "Atlas", path: "Atlas.md", aliases: ["Map"] },
      ],
      "map",
    );
    expect(choices).toEqual([{ label: "Map", detail: "Atlas.md" }]);
  });
});

describe("tasks", () => {
  it("lists open and checked tasks and skips fenced ones", () => {
    const items = taskItems("- [ ] Ship\n- [x] Done\n```\n- [ ] Hidden\n```\n");
    expect(items.map((item) => [item.checked, item.text])).toEqual([
      [false, "Ship"],
      [true, "Done"],
    ]);
  });

  it("keeps today's note or a matching tag", () => {
    expect(keepTask("2026-11-18.md", "Ship", [], true, "2026-11-18.md", "")).toBe(true);
    expect(keepTask("other.md", "Ship", [], true, "2026-11-18.md", "")).toBe(false);
    expect(keepTask("other.md", "Ship #focus", ["focus"], false, "2026-11-18.md", "focus")).toBe(true);
    expect(keepTask("other.md", "Ship", ["home"], false, "2026-11-18.md", "focus")).toBe(false);
  });
});

describe("unlinked mentions", () => {
  it("matches a whole title and wraps that occurrence", () => {
    const content = "See Atlas today.\n`Atlas`\n[[Atlas]]\nPlanning\n";
    const hits = mentionHits(content, "Atlas");
    expect(hits).toEqual([{ offset: 4, length: 5 }]);
    expect(wrapMention(content, hits[0].offset, hits[0].length)).toContain("[[Atlas]] today");
  });

  it("skips a note that already links to the title", () => {
    const notes = [
      parseNote("Atlas.md", "# Atlas"),
      parseNote("linked.md", "See [[Atlas]]"),
      parseNote("plain.md", "See Atlas"),
    ];
    const resolve = makeResolver(notes);
    const hits = unlinkedMentions(notes, "Atlas.md", (path) => notes.find((note) => note.path === path)!.content, resolve);
    expect(hits.map((hit) => hit.path)).toEqual(["plain.md"]);
  });
});
