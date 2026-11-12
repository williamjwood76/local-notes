import { markdown, markdownLanguage } from "@codemirror/lang-markdown";
import type { MarkdownConfig } from "@lezer/markdown";

const wiki: MarkdownConfig = {
  defineNodes: ["WikiLink", "Embed", "HashTag"],
  parseInline: [
    {
      name: "WikiLink",
      before: "Link",
      parse(cx, next, pos) {
        let cursor = pos;
        let embed = false;
        if (next === 33 && cx.char(pos + 1) === 91 && cx.char(pos + 2) === 91) {
          embed = true;
          cursor = pos + 3;
        } else if (next === 91 && cx.char(pos + 1) === 91) {
          cursor = pos + 2;
        } else {
          return -1;
        }
        for (let index = cursor; index < cx.end - 1; index++) {
          if (cx.char(index) === 10) return -1;
          if (cx.char(index) === 93 && cx.char(index + 1) === 93) {
            return cx.addElement(cx.elt(embed ? "Embed" : "WikiLink", pos, index + 2));
          }
        }
        return -1;
      },
    },
    {
      name: "HashTag",
      parse(cx, next, pos) {
        if (next !== 35) return -1;
        const previous = pos === 0 ? -1 : cx.char(pos - 1);
        if (previous >= 0 && !isTagBoundary(previous)) return -1;
        const rest = cx.slice(pos + 1, Math.min(cx.end, pos + 80));
        const match = /^[\p{L}_][\p{L}\p{N}_/-]*/u.exec(rest);
        if (!match?.[0]) return -1;
        const body = match[0].replace(/\/+$/u, "");
        if (!body) return -1;
        return cx.addElement(cx.elt("HashTag", pos, pos + 1 + body.length));
      },
    },
  ],
};

function isTagBoundary(code: number): boolean {
  return code === 32 || code === 9 || code === 10 || code === 13 || code === 40 || code === 91;
}

export const notesLanguage = markdown({
  base: markdownLanguage,
  extensions: wiki,
  completeHTMLTags: false,
});
