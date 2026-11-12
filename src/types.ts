export type PropertyValue = string | number | boolean | string[];

export type Heading = {
  text: string;
  level: number;
  offset: number;
};

export type LinkRef = {
  target: string;
  alias: string | null;
  heading: string | null;
  blockId: string | null;
  embed: boolean;
  offset: number;
};

export type BlockRef = {
  id: string;
  start: number;
  end: number;
};

export type Note = {
  path: string;
  title: string;
  headings: Heading[];
  tags: string[];
  properties: Record<string, PropertyValue>;
  links: LinkRef[];
  blocks: BlockRef[];
  content: string;
  mtime: number;
};

export type FsEntry = {
  path: string;
  name: string;
  isDir: boolean;
  mtimeMs: number;
};

export type NoteFile = {
  path: string;
  content: string;
  mtimeMs: number;
};

export type SearchHit = {
  path: string;
  title: string;
  line: number;
  offset: number;
  snippet: string;
};

export type Tab =
  | { id: string; kind: "note"; path: string }
  | { id: string; kind: "pdf"; path: string }
  | { id: string; kind: "graph" };

export type TabsNode = {
  type: "tabs";
  id: string;
  active: string;
  tabs: Tab[];
};

export type SplitNode = {
  type: "split";
  id: string;
  direction: "horizontal" | "vertical";
  ratio: number;
  first: LayoutNode;
  second: LayoutNode;
};

export type LayoutNode = TabsNode | SplitNode;

export type LeftTab = "files" | "search" | "tags";
export type GraphMode = "global" | "local";

export type VaultPrefs = {
  layout: LayoutNode;
  activeLeaf: string;
  leftOpen: boolean;
  leftWidth: number;
  rightOpen: boolean;
  leftTab: LeftTab;
  dailyFolder: string;
  templatePath: string | null;
  preview: boolean;
  graphMode: GraphMode;
  graphOrphans: boolean;
  graphTag: string;
  expanded: Record<string, boolean>;
};

export type PersistedSettings = {
  lastVault: string | null;
  vaults: Record<string, VaultPrefs>;
};
