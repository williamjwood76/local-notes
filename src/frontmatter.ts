import { parse, stringify } from "yaml";
import type { PropertyValue } from "./types";

export type Frontmatter = {
  data: Record<string, unknown>;
  body: string;
  ok: boolean;
};

export function splitFrontmatter(content: string): Frontmatter {
  const match = /^---[ \t]*\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)/.exec(content);
  if (!match) return { data: {}, body: content, ok: true };
  let parsed: unknown;
  try {
    parsed = parse(match[1]);
  } catch {
    return { data: {}, body: content, ok: false };
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return { data: {}, body: content, ok: false };
  }
  return {
    data: parsed as Record<string, unknown>,
    body: content.slice(match[0].length),
    ok: true,
  };
}

export function composeFrontmatter(data: Record<string, unknown>, body: string): string {
  const cleaned: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(data)) {
    if (value !== undefined && value !== null && value !== "") cleaned[key] = value;
  }
  if (Object.keys(cleaned).length === 0) return body;
  const yaml = stringify(cleaned).trimEnd();
  return `---\n${yaml}\n---\n${body}`;
}

export function writeProperty(content: string, key: string, value: PropertyValue | null): string {
  const current = splitFrontmatter(content);
  if (!current.ok) return content;
  const data = { ...current.data };
  if (value === null || value === "") delete data[key];
  else data[key] = value;
  return composeFrontmatter(data, current.body);
}

export function toProperty(value: unknown): PropertyValue | undefined {
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    return value;
  }
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return value.toISOString().slice(0, 10);
  }
  if (Array.isArray(value)) {
    return value
      .filter((item) => item != null && (typeof item !== "object" || item instanceof Date))
      .map((item) => (item instanceof Date ? item.toISOString().slice(0, 10) : String(item)));
  }
  return undefined;
}

export function propertiesOf(data: Record<string, unknown>): Record<string, PropertyValue> {
  const out: Record<string, PropertyValue> = {};
  for (const [key, value] of Object.entries(data)) {
    const property = toProperty(value);
    if (property !== undefined) out[key] = property;
  }
  return out;
}
