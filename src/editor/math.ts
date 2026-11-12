export type MathSpan = {
  from: number;
  to: number;
  tex: string;
  display: boolean;
};

export function findMath(doc: string, blocked: Array<[number, number]> = []): MathSpan[] {
  const spans: MathSpan[] = [];
  const covered = (index: number) => blocked.some(([from, to]) => index >= from && index < to);
  let index = 0;
  while (index < doc.length) {
    if (doc[index] === "\\" && doc[index + 1] === "$") {
      index += 2;
      continue;
    }
    if (doc.startsWith("$$", index)) {
      const end = doc.indexOf("$$", index + 2);
      if (end === -1) break;
      const tex = doc.slice(index + 2, end).trim();
      if (tex && !covered(index)) spans.push({ from: index, to: end + 2, tex, display: true });
      index = end + 2;
      continue;
    }
    if (doc[index] === "$") {
      const end = doc.indexOf("$", index + 1);
      const tex = end === -1 ? "" : doc.slice(index + 1, end);
      if (end === -1 || tex.includes("\n") || !tex.trim() || tex.startsWith(" ") || tex.endsWith(" ")) {
        index += 1;
        continue;
      }
      if (!covered(index)) spans.push({ from: index, to: end + 1, tex: tex.trim(), display: false });
      index = end + 1;
      continue;
    }
    index += 1;
  }
  return spans;
}
