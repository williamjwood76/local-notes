import type { Note } from "./types";
import type { ResolveResult } from "./resolve";

export type OpenSpec = {
  target: string;
  heading: string | null;
  blockId: string | null;
};

export const bridge = {
  notes: new Map<string, Note>(),
  files: [] as string[],
  resolve: (_target: string): ResolveResult => ({ status: "missing" }),
  openLink: (_spec: OpenSpec) => {},
};
