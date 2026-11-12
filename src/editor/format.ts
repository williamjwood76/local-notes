export type FormatKind =
  | "bullet"
  | "number"
  | "bold"
  | "italic"
  | "underline"
  | "h1"
  | "h2"
  | "h3"
  | "quote"
  | "code"
  | "link"
  | "image"
  | "table";

export type FormatEdit = {
  from: number;
  to: number;
  insert: string;
  anchor: number;
  head: number;
};

export function applyFormat(doc: string, from: number, to: number, kind: FormatKind): FormatEdit {
  if (kind === "bold") return wrap(doc, from, to, "**", "**", "bold");
  if (kind === "italic") return wrap(doc, from, to, "*", "*", "italic", "**");
  if (kind === "underline") return wrap(doc, from, to, "<u>", "</u>", "underline");
  if (kind === "h1" || kind === "h2" || kind === "h3") return heading(doc, from, to, Number(kind.slice(1)));
  if (kind === "bullet") return lines(doc, from, to, /^[-*+] /, () => "- ");
  if (kind === "number") return lines(doc, from, to, /^\d+\. /, (_line, index) => `${index + 1}. `);
  if (kind === "quote") return lines(doc, from, to, /^> /, () => "> ");
  if (kind === "code") return code(doc, from, to);
  if (kind === "link") return link(doc, from, to);
  if (kind === "image") return image(doc, from, to);
  return table(doc, from, to);
}

function wrap(doc: string, from: number, to: number, open: string, close: string, placeholder: string, guard?: string): FormatEdit {
  const selected = doc.slice(from, to);
  const before = doc.slice(Math.max(0, from - open.length), from);
  const after = doc.slice(to, to + close.length);
  const guarded = guard && doc.slice(Math.max(0, from - guard.length), from) === guard && doc.slice(to, to + guard.length) === guard;
  if (!guarded && before === open && after === close) {
    return edit(from - open.length, to + close.length, selected, from - open.length, to - open.length);
  }
  if (selected.startsWith(open) && selected.endsWith(close) && selected.length >= open.length + close.length) {
    const inner = selected.slice(open.length, selected.length - close.length);
    return edit(from, to, inner, from, from + inner.length);
  }
  const inner = selected || placeholder;
  return edit(from, to, open + inner + close, from + open.length, from + open.length + inner.length);
}

function heading(doc: string, from: number, to: number, level: number): FormatEdit {
  const mark = `${"#".repeat(level)} `;
  const exact = new RegExp(`^#{${level}} `);
  return rewriteLines(doc, from, to, (block) => {
    const active = block.filter((line) => line.length > 0);
    const remove = active.length > 0 && active.every((line) => exact.test(line));
    return block.map((line) => {
      if (!line) return line;
      const stripped = line.replace(/^#{1,6} /, "");
      return remove ? stripped : `${mark}${stripped}`;
    });
  });
}

function lines(
  doc: string,
  from: number,
  to: number,
  pattern: RegExp,
  prefix: (line: string, index: number) => string,
): FormatEdit {
  return rewriteLines(doc, from, to, (block) => {
    const active = block.filter((line) => line.length > 0);
    const remove = active.length > 0 && active.every((line) => pattern.test(line));
    let number = 0;
    return block.map((line) => {
      if (!line) return line;
      const index = number++;
      if (remove) return line.replace(pattern, "");
      if (pattern.test(line)) return line;
      return prefix(line, index) + line;
    });
  });
}

function rewriteLines(doc: string, from: number, to: number, rewrite: (lines: string[]) => string[]): FormatEdit {
  const start = doc.lastIndexOf("\n", Math.max(0, from - 1)) + 1;
  const last = to > from ? to - 1 : from;
  let end = doc.indexOf("\n", last);
  if (end === -1) end = doc.length;
  const next = rewrite(doc.slice(start, end).split("\n"));
  const insert = next.join("\n");
  const collapsed = from === to;
  const head = collapsed ? start + next[0].length : start + insert.length;
  return edit(start, end, insert, collapsed ? head : start, head);
}

function code(doc: string, from: number, to: number): FormatEdit {
  const selected = doc.slice(from, to);
  if (selected.includes("\n")) {
    const open = "```\n";
    const close = "\n```";
    if (selected.startsWith(open) && selected.endsWith(close)) {
      const inner = selected.slice(open.length, selected.length - close.length);
      return edit(from, to, inner, from, from + inner.length);
    }
    return edit(from, to, `${open}${selected}${close}`, from + open.length, from + open.length + selected.length);
  }
  return wrap(doc, from, to, "`", "`", "code");
}

function link(doc: string, from: number, to: number): FormatEdit {
  const selected = doc.slice(from, to);
  const label = selected || "text";
  const url = "https://";
  const insert = `[${label}](${url})`;
  const urlStart = from + label.length + 3;
  return edit(from, to, insert, urlStart, urlStart + url.length);
}

function image(doc: string, from: number, to: number): FormatEdit {
  const selected = doc.slice(from, to);
  const label = selected || "image";
  const insert = `![${label}]()`;
  const at = from + insert.length - 1;
  return edit(from, to, insert, at, at);
}

function table(doc: string, from: number, to: number): FormatEdit {
  const lead = from > 0 && doc[from - 1] !== "\n" ? "\n" : "";
  const insert = `${lead}| Column | Column |\n| --- | --- |\n|  |  |\n`;
  const at = from + insert.length;
  return edit(from, to, insert, at, at);
}

function edit(from: number, to: number, insert: string, anchor: number, head: number): FormatEdit {
  return { from, to, insert, anchor, head };
}
