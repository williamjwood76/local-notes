import type { LinkRef, Note, PropertyValue } from "./types";

export function aliasesOf(note: Note): string[] {
  return [...aliasValues(note.properties.aliases), ...aliasValues(note.properties.alias)];
}

function aliasValues(value: PropertyValue | undefined): string[] {
  if (typeof value === "string" && value.trim()) return [value.trim()];
  if (Array.isArray(value)) return value.filter((item) => item.trim());
  return [];
}

export type ResolveResult =
  | { status: "ok"; path: string }
  | { status: "ambiguous"; paths: string[] }
  | { status: "missing" };

function stemOf(path: string): string {
  return path.replace(/\.markdown$/i, "").replace(/\.md$/i, "");
}

function addName(map: Map<string, string[]>, name: string, path: string) {
  const key = name.toLowerCase();
  const list = map.get(key) ?? [];
  if (!list.includes(path)) list.push(path);
  map.set(key, list);
}

export function makeResolver(notes: Iterable<Note>) {
  const byBase = new Map<string, string[]>();
  const byStem = new Map<string, string>();
  const byAlias = new Map<string, string[]>();
  for (const note of notes) {
    const stem = stemOf(note.path);
    byStem.set(stem.toLowerCase(), note.path);
    addName(byBase, stem.split("/").pop()!, note.path);
    for (const alias of aliasesOf(note)) addName(byAlias, alias, note.path);
  }

  return function resolve(target: string): ResolveResult {
    const cleaned = stemOf(target.trim().replace(/\\/g, "/")).replace(/^\/+/, "");
    if (!cleaned) return { status: "missing" };
    if (cleaned.includes("/")) {
      const exact = byStem.get(cleaned.toLowerCase());
      if (exact) return { status: "ok", path: exact };
      const matches = [...byStem.entries()].filter(
        ([stem]) => stem.endsWith(`/${cleaned.toLowerCase()}`),
      );
      if (matches.length === 1) return { status: "ok", path: matches[0][1] };
      if (matches.length > 1) return { status: "ambiguous", paths: matches.map((item) => item[1]) };
      const alias = byAlias.get(cleaned.toLowerCase()) ?? [];
      if (alias.length === 1) return { status: "ok", path: alias[0] };
      if (alias.length > 1) return { status: "ambiguous", paths: [...alias] };
      return { status: "missing" };
    }
    const matches = unique([...(byBase.get(cleaned.toLowerCase()) ?? []), ...(byAlias.get(cleaned.toLowerCase()) ?? [])]);
    if (matches.length === 1) return { status: "ok", path: matches[0] };
    if (matches.length > 1) return { status: "ambiguous", paths: matches };
    return { status: "missing" };
  };
}

function unique(paths: string[]): string[] {
  return [...new Set(paths)];
}

const IMAGE = /\.(png|jpe?g|gif|webp|svg)$/i;

export function lineText(content: string, offset: number): string {
  const start = content.lastIndexOf("\n", Math.max(0, offset - 1)) + 1;
  let end = content.indexOf("\n", offset);
  if (end === -1) end = content.length;
  return content.slice(start, end).trim();
}

export type Backlink = {
  from: string;
  title: string;
  offset: number;
  line: string;
};

export function backlinksFor(
  notes: Iterable<Note>,
  path: string,
  resolve: (target: string) => ResolveResult,
): Backlink[] {
  const found: Backlink[] = [];
  for (const note of notes) {
    for (const link of note.links) {
      const hit = resolve(link.target);
      if (hit.status === "ok" && hit.path === path) {
        found.push({
          from: note.path,
          title: note.title,
          offset: link.offset,
          line: lineText(note.content, link.offset),
        });
      }
    }
  }
  return found;
}

export type Outgoing = {
  link: LinkRef;
  hit: ResolveResult;
};

export function outgoingFor(note: Note, resolve: (target: string) => ResolveResult): Outgoing[] {
  const seen = new Set<string>();
  const found: Outgoing[] = [];
  for (const link of note.links) {
    if (isImagePath(link.target)) continue;
    const hit = resolve(link.target);
    const key = hit.status === "ok" ? hit.path : `missing:${link.target}`;
    if (seen.has(key)) continue;
    seen.add(key);
    found.push({ link, hit });
  }
  return found;
}

export function isImagePath(path: string): boolean {
  return IMAGE.test(path);
}

export function resolveAttachment(paths: Iterable<string>, target: string): string | null {
  const cleaned = target.trim().replace(/\\/g, "/").replace(/^\/+/, "");
  if (!cleaned) return null;
  const lower = cleaned.toLowerCase();
  const all = [...paths];
  const exact = all.find((path) => path.toLowerCase() === lower);
  if (exact) return exact;
  if (lower.includes("/")) {
    const hits = all.filter((path) => path.toLowerCase().endsWith(`/${lower}`));
    return hits.length === 1 ? hits[0] : null;
  }
  const hits = all.filter((path) => path.split("/").pop()!.toLowerCase() === lower);
  return hits.length === 1 ? hits[0] : null;
}
