import type { Note, SearchHit } from "./types";

export type ParsedQuery = {
  text: string[];
  file?: string;
  path?: string;
  tag?: string;
};

export function parseQuery(input: string): ParsedQuery {
  const text: string[] = [];
  let file: string | undefined;
  let path: string | undefined;
  let tag: string | undefined;
  const pattern = /(file|path|tag):(\S+)|(\S+)/gi;
  let match = pattern.exec(input);
  while (match) {
    if (match[1]) {
      const key = match[1].toLowerCase();
      const value = match[2].toLowerCase().replace(/^#/, "");
      if (key === "file") file = value;
      else if (key === "path") path = value;
      else tag = value;
    } else if (match[3]) text.push(match[3].toLowerCase());
    match = pattern.exec(input);
  }
  return { text, file, path, tag };
}

export function searchNotes(notes: Iterable<Note>, query: string): SearchHit[] {
  const trimmed = query.trim();
  if (!trimmed) return [];
  const parsed = parseQuery(trimmed);
  const hits: SearchHit[] = [];
  for (const note of notes) {
    const fileName = note.path.split("/").pop()!.toLowerCase();
    if (parsed.file && !fileName.includes(parsed.file)) continue;
    if (parsed.path && !note.path.toLowerCase().includes(parsed.path)) continue;
    if (
      parsed.tag &&
      !note.tags.some(
        (tag) => tag.toLowerCase() === parsed.tag || tag.toLowerCase().startsWith(`${parsed.tag}/`),
      )
    ) {
      continue;
    }
    if (parsed.text.length === 0) {
      hits.push({ path: note.path, title: note.title, line: 1, offset: 0, snippet: note.title });
    } else {
      const lines = note.content.split("\n");
      let matched = false;
      let offset = 0;
      for (let index = 0; index < lines.length; index++) {
        const lower = lines[index].toLowerCase();
        if (parsed.text.every((token) => lower.includes(token))) {
          hits.push({
            path: note.path,
            title: note.title,
            line: index + 1,
            offset,
            snippet: lines[index].trim() || note.title,
          });
          matched = true;
          break;
        }
        offset += lines[index].length + 1;
      }
      if (!matched && parsed.text.every((token) => note.title.toLowerCase().includes(token))) {
        hits.push({ path: note.path, title: note.title, line: 1, offset: 0, snippet: note.title });
      }
    }
    if (hits.length >= 200) break;
  }
  return hits;
}
