export type PdfColor = "yellow" | "green" | "blue" | "pink";

export type PdfRect = { x: number; y: number; w: number; h: number };

export type PdfMark = {
  id: string;
  page: number;
  text: string;
  note: string;
  color: PdfColor;
  rects: PdfRect[];
};

const colors = new Set<PdfColor>(["yellow", "green", "blue", "pink"]);

export function annotationPath(pdfPath: string): string {
  return `${pdfPath}.annotations.json`;
}

export function parseMarks(raw: string): PdfMark[] {
  try {
    const value = JSON.parse(raw) as { marks?: unknown };
    if (!value || !Array.isArray(value.marks)) return [];
    return value.marks.filter(isMark);
  } catch {
    return [];
  }
}

function isMark(value: unknown): value is PdfMark {
  if (!value || typeof value !== "object") return false;
  const mark = value as PdfMark;
  return (
    typeof mark.id === "string" &&
    Number.isInteger(mark.page) &&
    mark.page > 0 &&
    typeof mark.text === "string" &&
    typeof mark.note === "string" &&
    colors.has(mark.color) &&
    Array.isArray(mark.rects) &&
    mark.rects.every(isRect)
  );
}

function isRect(value: unknown): value is PdfRect {
  if (!value || typeof value !== "object") return false;
  const rect = value as PdfRect;
  return [rect.x, rect.y, rect.w, rect.h].every((item) => typeof item === "number" && Number.isFinite(item));
}
