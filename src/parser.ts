import { propertiesOf, splitFrontmatter } from "./frontmatter";
import type { BlockRef, Heading, LinkRef, Note } from "./types";

const TAG = /(^|[\s(])#([\p{L}_][\p{L}\p{N}_/-]*)/gu;
const WIKI = /(!?)\[\[([^\]]+)\]\]/g;
const MD_LINK = /\[([^\]]*)\]\(([^)\s]+)\)/g;

export function fileTitle(path: string): string {
  const name = path.split("/").pop() ?? path;
  return name.replace(/\.markdown$/i, "").replace(/\.md$/i, "");
}

export function parseWikiTarget(inner: string): Omit<LinkRef, "embed" | "offset"> {
  let body = inner.trim();
  let alias: string | null = null;
  const pipe = body.indexOf("|");
  if (pipe !== -1) {
    alias = body.slice(pipe + 1).trim() || null;
    body = body.slice(0, pipe).trim();
  }
  let target = body;
  let heading: string | null = null;
  let blockId: string | null = null;
  const hash = body.indexOf("#");
  if (hash !== -1) {
    target = body.slice(0, hash).trim();
    const rest = body.slice(hash + 1).trim();
    if (rest.startsWith("^")) blockId = rest.slice(1).trim() || null;
    else heading = rest || null;
  }
  target = stripMarkdownExt(target);
  return { target, alias, heading, blockId };
}

export function stripMarkdownExt(target: string): string {
  if (/\.markdown$/i.test(target)) return target.slice(0, -9);
  if (/\.md$/i.test(target)) return target.slice(0, -3);
  return target;
}

export function normalizeHeading(text: string): string {
  return text.trim().toLowerCase().replace(/\s+/g, " ");
}

function addTag(raw: string, tags: Set<string>) {
  const tag = raw.trim().replace(/^#/, "");
  if (/^[\p{L}_][\p{L}\p{N}_/-]*$/u.test(tag)) tags.add(tag);
}

function tagsFromProperties(value: unknown, tags: Set<string>) {
  if (typeof value === "string") addTag(value, tags);
  else if (Array.isArray(value)) {
    for (const item of value) {
      if (typeof item === "string") addTag(item, tags);
    }
  }
}

function maskInlineCode(line: string): string {
  return line.replace(/``[\s\S]*?``|`[^`\n]*`/g, (match) => " ".repeat(match.length));
}

function linesOf(content: string, startAt: number) {
  const lines: { text: string; start: number }[] = [];
  let cursor = startAt;
  const body = content.slice(startAt);
  let index = 0;
  while (index <= body.length) {
    const newline = body.indexOf("\n", index);
    const end = newline === -1 ? body.length : newline;
    lines.push({ text: body.slice(index, end).replace(/\r$/, ""), start: cursor });
    if (newline === -1) break;
    const next = newline + 1;
    cursor += next - index;
    index = next;
  }
  return lines;
}

export function parseNote(path: string, content: string, mtime = 0): Note {
  const front = splitFrontmatter(content);
  const properties = propertiesOf(front.data);
  const tags = new Set<string>();
  tagsFromProperties(front.data.tags, tags);
  tagsFromProperties(front.data.tag, tags);

  const headings: Heading[] = [];
  const links: LinkRef[] = [];
  const blocks: BlockRef[] = [];
  const bodyStart = content.length - front.body.length;
  const lines = linesOf(content, bodyStart);
  let inFence = false;
  let fenceChar = "";

  for (let lineIndex = 0; lineIndex < lines.length; lineIndex++) {
    const line = lines[lineIndex];
    const fence = /^(```+|~~~+)/.exec(line.text.trimStart());
    const leading = line.text.length - line.text.trimStart().length;
    if (fence && leading < 4) {
      const marker = fence[1][0];
      if (!inFence) {
        inFence = true;
        fenceChar = marker;
      } else if (marker === fenceChar) {
        inFence = false;
        fenceChar = "";
      }
      continue;
    }
    if (inFence) continue;

    const heading = /^(#{1,6})[ \t]+(.+?)\s*#*\s*$/.exec(line.text);
    if (heading) {
      headings.push({
        level: heading[1].length,
        text: heading[2].trim(),
        offset: line.start,
      });
    }

    const block = /(?:^|\s)\^([A-Za-z0-9-]+)\s*$/.exec(line.text);
    if (block) {
      let startLine = lineIndex;
      while (startLine > 0 && lines[startLine - 1].text.trim() !== "") startLine -= 1;
      blocks.push({
        id: block[1],
        start: lines[startLine].start,
        end: line.start + line.text.length,
      });
    }

    const masked = maskInlineCode(line.text);
    WIKI.lastIndex = 0;
    let wiki = WIKI.exec(masked);
    while (wiki) {
      const parsed = parseWikiTarget(wiki[2]);
      links.push({
        ...parsed,
        embed: wiki[1] === "!",
        offset: line.start + wiki.index,
      });
      wiki = WIKI.exec(masked);
    }

    MD_LINK.lastIndex = 0;
    let md = MD_LINK.exec(masked);
    while (md) {
      const rawTarget = md[2];
      if (!/^[a-z]+:/i.test(rawTarget) && !rawTarget.startsWith("//")) {
        const hash = rawTarget.indexOf("#");
        const filePart = hash === -1 ? rawTarget : rawTarget.slice(0, hash);
        const headingPart = hash === -1 ? null : rawTarget.slice(hash + 1);
        const blockId = headingPart?.startsWith("^") ? headingPart.slice(1) : null;
        links.push({
          target: stripMarkdownExt(decodeURIComponentSafe(filePart)),
          alias: md[1] || null,
          heading: blockId ? null : headingPart,
          blockId,
          embed: false,
          offset: line.start + md.index,
        });
      }
      md = MD_LINK.exec(masked);
    }

    TAG.lastIndex = 0;
    let tag = TAG.exec(masked);
    while (tag) {
      addTag(tag[2], tags);
      tag = TAG.exec(masked);
    }
  }

  const titleHeading = headings.find((item) => item.level === 1);
  return {
    path,
    title: titleHeading?.text || fileTitle(path),
    headings,
    tags: [...tags].sort((a, b) => a.localeCompare(b)),
    properties,
    links,
    blocks,
    content,
    mtime,
  };
}

function decodeURIComponentSafe(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

export function sectionRange(note: Note, heading: string | null, blockId: string | null) {
  if (blockId) {
    const block = note.blocks.find((item) => item.id === blockId);
    if (block) return { start: block.start, end: block.end };
  }
  if (heading) {
    const index = note.headings.findIndex(
      (item) => normalizeHeading(item.text) === normalizeHeading(heading),
    );
    if (index !== -1) {
      const current = note.headings[index];
      const next = note.headings.slice(index + 1).find((item) => item.level <= current.level);
      return { start: current.offset, end: next ? next.offset : note.content.length };
    }
  }
  return { start: 0, end: note.content.length };
}
