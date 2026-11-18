import { fileTitle } from "./parser";
import { lineText } from "./resolve";
import type { Note } from "./types";

export type WikiChoice = { label: string; detail: string };

export function wikiQuery(line: string, index: number): { from: number; query: string } | null {
  const before = line.slice(0, index);
  const open = before.lastIndexOf("[[");
  if (open === -1) return null;
  const query = before.slice(open + 2);
  if (query.includes("]") || query.includes("|") || query.includes("#")) return null;
  return { from: open + 2, query };
}

export function wikiChoices(
  notes: Iterable<{ title: string; path: string; aliases?: string[] }>,
  query: string,
): WikiChoice[] {
  const needle = query.trim().toLowerCase();
  const ranked: { label: string; detail: string; score: number }[] = [];
  for (const note of notes) {
    const names = [note.title, fileTitle(note.path), ...(note.aliases ?? [])];
    const match = names.find((name) => name.toLowerCase().includes(needle));
    if (needle && !match) continue;
    const label = (match ?? note.title).trim();
    if (!label) continue;
    const score = !needle ? 1 : label.toLowerCase().startsWith(needle) ? 0 : 2;
    ranked.push({ label, detail: note.path, score });
  }
  ranked.sort((a, b) => a.score - b.score || a.label.localeCompare(b.label) || a.detail.localeCompare(b.detail));
  const seen = new Set<string>();
  const choices: WikiChoice[] = [];
  for (const item of ranked) {
    const key = `${item.detail}\n${item.label}`;
    if (seen.has(key)) continue;
    seen.add(key);
    choices.push({ label: item.label, detail: item.detail });
    if (choices.length === 8) break;
  }
  return choices;
}

export type TaskItem = { offset: number; line: number; checked: boolean; text: string };

export function keepTask(path: string, text: string, noteTags: string[], todayOnly: boolean, todayPath: string, tag: string): boolean {
  if (todayOnly && path !== todayPath) return false;
  const clean = tag.trim().replace(/^#/, "").toLowerCase();
  if (!clean) return true;
  if (noteTags.some((item) => item.toLowerCase() === clean)) return true;
  return new RegExp(`(^|\\s)#${clean.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?![\\p{L}\\p{N}_/-])`, "iu").test(text);
}

export function taskItems(content: string): TaskItem[] {
  const items: TaskItem[] = [];
  let inFence = false;
  let fenceChar = "";
  let offset = 0;
  let lineNumber = 1;
  for (const line of content.split("\n")) {
    const fence = /^(```+|~~~+)/.exec(line.trimStart());
    const leading = line.length - line.trimStart().length;
    if (fence && leading < 4) {
      const marker = fence[1][0];
      if (!inFence) {
        inFence = true;
        fenceChar = marker;
      } else if (marker === fenceChar) {
        inFence = false;
        fenceChar = "";
      }
    } else if (!inFence) {
      const task = /^(\s*(?:[-*+]|\d+\.)\s+)\[([ xX])\]\s*(.*)$/.exec(line);
      if (task) {
        items.push({
          offset,
          line: lineNumber,
          checked: task[2].toLowerCase() === "x",
          text: task[3],
        });
      }
    }
    offset += line.length + 1;
    lineNumber += 1;
  }
  return items;
}

export function mentionHits(content: string, phrase: string): { offset: number; length: number }[] {
  const needle = phrase.trim();
  if (needle.length < 3) return [];
  const lower = content.toLowerCase();
  const target = needle.toLowerCase();
  const blocked = blockedRanges(content);
  const hits: { offset: number; length: number }[] = [];
  let from = 0;
  while (from <= lower.length - target.length) {
    const at = lower.indexOf(target, from);
    if (at === -1) break;
    from = at + target.length;
    if (!bounded(content, at, target.length) || overlaps(blocked, at, at + target.length)) continue;
    hits.push({ offset: at, length: target.length });
  }
  return hits;
}

export type Mention = { path: string; title: string; offset: number; length: number; line: string };

export function unlinkedMentions(
  notes: Iterable<Note>,
  path: string,
  contentOf: (path: string) => string,
  resolve: (target: string) => { status: string; path?: string },
): Mention[] {
  const list = [...notes];
  const note = list.find((item) => item.path === path);
  if (!note) return [];
  const title = note.title.trim();
  const stem = fileTitle(note.path);
  const phrases = [title, stem].filter((phrase, index, all) => phrase.length >= 3 && all.findIndex((item) => item.toLowerCase() === phrase.toLowerCase()) === index);
  const rows: Mention[] = [];
  for (const other of list) {
    if (other.path === path) continue;
    const linked = other.links.some((link) => {
      const hit = resolve(link.target);
      return hit.status === "ok" && hit.path === path;
    });
    if (linked) continue;
    const content = contentOf(other.path);
    const seen = new Set<number>();
    for (const phrase of phrases) {
      for (const hit of mentionHits(content, phrase)) {
        if (seen.has(hit.offset)) continue;
        seen.add(hit.offset);
        rows.push({ path: other.path, title: other.title, offset: hit.offset, length: hit.length, line: lineText(content, hit.offset) });
        if (rows.length === 30) return rows;
      }
    }
  }
  return rows;
}

export function wrapMention(content: string, offset: number, length: number): string {
  const text = content.slice(offset, offset + length);
  return `${content.slice(0, offset)}[[${text}]]${content.slice(offset + length)}`;
}

function bounded(content: string, start: number, length: number): boolean {
  const before = start === 0 ? "" : content[start - 1];
  const after = content[start + length] ?? "";
  return !isWord(before) && !isWord(after);
}

function isWord(char: string): boolean {
  return /[\p{L}\p{N}_]/u.test(char);
}

function overlaps(ranges: [number, number][], start: number, end: number): boolean {
  return ranges.some(([from, to]) => start < to && end > from);
}

function blockedRanges(content: string): [number, number][] {
  const ranges: [number, number][] = [];
  const front = /^---[ \t]*\r?\n[\s\S]*?\r?\n---[ \t]*(?:\r?\n|$)/.exec(content);
  if (front) ranges.push([0, front[0].length]);
  let inFence = false;
  let fenceChar = "";
  let fenceStart = 0;
  let offset = 0;
  for (const line of content.split("\n")) {
    const fence = /^(```+|~~~+)/.exec(line.trimStart());
    const leading = line.length - line.trimStart().length;
    if (fence && leading < 4) {
      const marker = fence[1][0];
      if (!inFence) {
        inFence = true;
        fenceChar = marker;
        fenceStart = offset;
      } else if (marker === fenceChar) {
        inFence = false;
        ranges.push([fenceStart, offset + line.length]);
      }
    } else if (!inFence) {
      const inline = /``[\s\S]*?``|`[^`\n]*`|\[\[[^\]]*\]\]/g;
      let code: RegExpExecArray | null;
      while ((code = inline.exec(line))) {
        ranges.push([offset + code.index, offset + code.index + code[0].length]);
      }
    }
    offset += line.length + 1;
  }
  if (inFence) ranges.push([fenceStart, content.length]);
  return ranges;
}
