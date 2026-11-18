import { normalizeHeading, parseNote, parseWikiTarget, stripMarkdownExt } from "./parser";
import type { Heading } from "./types";

export function linkTextFor(path: string, paths: Iterable<string>): string {
  const stem = stripMarkdownExt(path);
  const base = stem.split("/").pop() ?? stem;
  const lower = base.toLowerCase();
  let count = 0;
  for (const other of paths) {
    const otherBase = (stripMarkdownExt(other).split("/").pop() ?? "").toLowerCase();
    if (otherBase === lower) count += 1;
  }
  return count === 1 ? base : stem;
}

export function replaceLiteral(content: string, find: string, replacement: string): { content: string; count: number } {
  if (!find) return { content, count: 0 };
  const parts = content.split(find);
  return { content: parts.join(replacement), count: parts.length - 1 };
}

export function rewriteMovedLinks(content: string, nextTarget: (target: string) => string | null): string {
  const blocked = protectedRanges(content);
  const edits: { start: number; end: number; text: string }[] = [];
  const wiki = /(!?)\[\[([^\]]+)\]\]/g;
  let match: RegExpExecArray | null;
  while ((match = wiki.exec(content))) {
    if (inside(blocked, match.index)) continue;
    const parsed = parseWikiTarget(match[2]);
    const next = parsed.target ? nextTarget(parsed.target) : null;
    if (!next) continue;
    let body = next;
    if (parsed.blockId) body += `#^${parsed.blockId}`;
    else if (parsed.heading) body += `#${parsed.heading}`;
    if (parsed.alias) body += `|${parsed.alias}`;
    const text = `${match[1]}[[${body}]]`;
    if (text !== match[0]) edits.push({ start: match.index, end: match.index + match[0].length, text });
  }
  const markdown = /\[([^\]]*)\]\(([^)\s]+)\)/g;
  while ((match = markdown.exec(content))) {
    if (inside(blocked, match.index)) continue;
    const raw = match[2];
    if (/^[a-z]+:/i.test(raw) || raw.startsWith("//")) continue;
    const hash = raw.indexOf("#");
    const filePart = hash === -1 ? raw : raw.slice(0, hash);
    const suffix = hash === -1 ? "" : raw.slice(hash);
    const next = nextTarget(stripMarkdownExt(decode(filePart)));
    if (!next) continue;
    const ext = /\.markdown$/i.test(filePart) ? ".markdown" : /\.md$/i.test(filePart) ? ".md" : "";
    const text = `[${match[1]}](${next}${ext}${suffix})`;
    if (text !== match[0]) edits.push({ start: match.index, end: match.index + match[0].length, text });
  }
  edits.sort((a, b) => b.start - a.start);
  let out = content;
  for (const edit of edits) out = out.slice(0, edit.start) + edit.text + out.slice(edit.end);
  return out;
}

export function headingRenames(before: string, after: string): { from: string; to: string }[] {
  const oldHeadings = parseNote("note.md", before).headings;
  const newHeadings = parseNote("note.md", after).headings;
  const pairs: { from: string; to: string }[] = [];
  let oldIndex = 0;
  let newIndex = 0;
  while (oldIndex < oldHeadings.length && newIndex < newHeadings.length) {
    if (sameHeading(oldHeadings[oldIndex], newHeadings[newIndex])) {
      oldIndex += 1;
      newIndex += 1;
      continue;
    }
    const inserted = newHeadings.slice(newIndex + 1).findIndex((item) => sameHeading(item, oldHeadings[oldIndex]));
    const removed = oldHeadings.slice(oldIndex + 1).findIndex((item) => sameHeading(item, newHeadings[newIndex]));
    if (inserted !== -1 && (removed === -1 || inserted <= removed)) {
      newIndex += 1;
      continue;
    }
    if (removed !== -1 && (inserted === -1 || removed < inserted)) {
      oldIndex += 1;
      continue;
    }
    if (oldHeadings[oldIndex].level === newHeadings[newIndex].level) {
      pairs.push({ from: oldHeadings[oldIndex].text, to: newHeadings[newIndex].text });
      oldIndex += 1;
      newIndex += 1;
      continue;
    }
    break;
  }
  const seen = new Set<string>();
  return pairs.filter((pair) => {
    const key = normalizeHeading(pair.from);
    if (!key || key === normalizeHeading(pair.to) || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export function rewriteHeadingLinks(
  content: string,
  names: string[],
  renames: { from: string; to: string }[],
  sameNote: boolean,
): string {
  if (renames.length === 0) return content;
  const nextHeading = new Map(renames.map((item) => [normalizeHeading(item.from), item.to]));
  const nameSet = new Set(names.map((name) => name.trim().toLowerCase()).filter(Boolean));
  const blocked = protectedRanges(content);
  const edits: { start: number; end: number; text: string }[] = [];
  const wiki = /(!?)\[\[([^\]]+)\]\]/g;
  let match: RegExpExecArray | null;
  while ((match = wiki.exec(content))) {
    if (inside(blocked, match.index)) continue;
    const parsed = parseWikiTarget(match[2]);
    if (!parsed.heading) continue;
    const next = nextHeading.get(normalizeHeading(parsed.heading));
    if (!next || !headingOwned(parsed.target, nameSet, sameNote)) continue;
    let body = parsed.target;
    body += `#${next}`;
    if (parsed.alias) body += `|${parsed.alias}`;
    const text = `${match[1]}[[${body}]]`;
    if (text !== match[0]) edits.push({ start: match.index, end: match.index + match[0].length, text });
  }
  const markdown = /\[([^\]]*)\]\(([^)\s]+)\)/g;
  while ((match = markdown.exec(content))) {
    if (inside(blocked, match.index)) continue;
    const raw = match[2];
    if (/^[a-z]+:/i.test(raw) || raw.startsWith("//")) continue;
    const hash = raw.indexOf("#");
    if (hash === -1) continue;
    const heading = decode(raw.slice(hash + 1));
    if (heading.startsWith("^")) continue;
    const next = nextHeading.get(normalizeHeading(heading));
    if (!next || !headingOwned(stripMarkdownExt(decode(raw.slice(0, hash))), nameSet, sameNote)) continue;
    const text = `[${match[1]}](${raw.slice(0, hash)}#${next})`;
    if (text !== match[0]) edits.push({ start: match.index, end: match.index + match[0].length, text });
  }
  edits.sort((a, b) => b.start - a.start);
  let out = content;
  for (const edit of edits) out = out.slice(0, edit.start) + edit.text + out.slice(edit.end);
  return out;
}

export function trashDestination(original: string, stamp: number): string {
  return `.trash/${stamp}/${original}`;
}

function sameHeading(left: Heading, right: Heading): boolean {
  return left.level === right.level && normalizeHeading(left.text) === normalizeHeading(right.text);
}

function headingOwned(target: string, names: Set<string>, sameNote: boolean): boolean {
  const name = target.trim().toLowerCase();
  if (!name) return sameNote;
  return names.has(name);
}

function protectedRanges(content: string): [number, number][] {
  const ranges: [number, number][] = [];
  let inFence = false;
  let fenceChar = "";
  let fenceStart = 0;
  let offset = 0;
  const lines = content.split("\n");
  for (const line of lines) {
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
      const inline = /``[\s\S]*?``|`[^`\n]*`/g;
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

function inside(ranges: [number, number][], index: number): boolean {
  return ranges.some(([start, end]) => index >= start && index < end);
}

function decode(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}
