import type { LayoutNode, SplitNode, Tab, TabsNode } from "./types";

let counter = 0;

export function uid(prefix = "id"): string {
  counter += 1;
  return `${prefix}${Date.now().toString(36)}${counter.toString(36)}`;
}

export function emptyLayout(): TabsNode {
  return { type: "tabs", id: uid("leaf"), active: "", tabs: [] };
}

export function isTabs(node: LayoutNode): node is TabsNode {
  return node.type === "tabs";
}

export function firstLeaf(node: LayoutNode): TabsNode {
  return isTabs(node) ? node : firstLeaf(node.first);
}

export function allLeaves(node: LayoutNode): TabsNode[] {
  return isTabs(node) ? [node] : [...allLeaves(node.first), ...allLeaves(node.second)];
}

export function findTabs(node: LayoutNode, id: string): TabsNode | null {
  if (isTabs(node)) return node.id === id ? node : null;
  return findTabs(node.first, id) ?? findTabs(node.second, id);
}

export function mapLayout(node: LayoutNode, visit: (node: LayoutNode) => LayoutNode | null): LayoutNode {
  const replaced = visit(node);
  if (replaced) return replaced;
  if (isTabs(node)) return node;
  return {
    ...node,
    first: mapLayout(node.first, visit),
    second: mapLayout(node.second, visit),
  };
}

export function updateTabs(node: LayoutNode, id: string, update: (tabs: TabsNode) => TabsNode): LayoutNode {
  return mapLayout(node, (current) => (isTabs(current) && current.id === id ? update(current) : null));
}

function sameTab(tab: Tab, next: Tab): boolean {
  if (tab.kind !== next.kind) return false;
  if (tab.kind === "graph" || next.kind === "graph") return true;
  return tab.path === next.path;
}

export function openTab(node: TabsNode, tab: Tab): TabsNode {
  const existing = node.tabs.find((item) => sameTab(item, tab));
  if (existing) return { ...node, active: existing.id };
  return { ...node, active: tab.id, tabs: [...node.tabs, tab] };
}

export function findNoteTab(node: LayoutNode, path: string): { leaf: string; tab: string } | null {
  if (isTabs(node)) {
    const found = node.tabs.find((tab) => tab.kind === "note" && tab.path === path);
    return found ? { leaf: node.id, tab: found.id } : null;
  }
  return findNoteTab(node.first, path) ?? findNoteTab(node.second, path);
}

export function findGraphTab(node: LayoutNode): { leaf: string; tab: string } | null {
  if (isTabs(node)) {
    const found = node.tabs.find((tab) => tab.kind === "graph");
    return found ? { leaf: node.id, tab: found.id } : null;
  }
  return findGraphTab(node.first) ?? findGraphTab(node.second);
}

export function closeTab(node: LayoutNode, leafId: string, tabId: string): LayoutNode {
  return updateTabs(node, leafId, (leaf) => {
    const tabs = leaf.tabs.filter((tab) => tab.id !== tabId);
    const active = leaf.active === tabId ? tabs[tabs.length - 1]?.id ?? "" : leaf.active;
    return { ...leaf, tabs, active };
  });
}

export function splitLeaf(
  node: LayoutNode,
  leafId: string,
  direction: "horizontal" | "vertical",
): LayoutNode {
  return mapLayout(node, (current) => {
    if (!isTabs(current) || current.id !== leafId) return null;
    const sibling: TabsNode = { type: "tabs", id: uid("leaf"), active: "", tabs: [] };
    const split: SplitNode = {
      type: "split",
      id: uid("split"),
      direction,
      ratio: 0.5,
      first: current,
      second: sibling,
    };
    return split;
  });
}

export function closeLeaf(node: LayoutNode, leafId: string): LayoutNode {
  if (isTabs(node)) {
    if (node.id !== leafId) return node;
    return { ...node, tabs: [], active: "" };
  }
  if (isTabs(node.first) && node.first.id === leafId) return node.second;
  if (isTabs(node.second) && node.second.id === leafId) return node.first;
  return {
    ...node,
    first: closeLeaf(node.first, leafId),
    second: closeLeaf(node.second, leafId),
  };
}

export function setRatio(node: LayoutNode, splitId: string, ratio: number): LayoutNode {
  return mapLayout(node, (current) => {
    if (current.type !== "split" || current.id !== splitId) return null;
    return { ...current, ratio: Math.min(0.8, Math.max(0.2, ratio)) };
  });
}

export function activeTab(node: TabsNode): Tab | null {
  return node.tabs.find((tab) => tab.id === node.active) ?? null;
}

export function renameLayoutPaths(node: LayoutNode, from: string, to: string, isDir: boolean): LayoutNode {
  const mapPath = (path: string) => {
    if (path === from) return to;
    if (isDir && (path === from || path.startsWith(`${from}/`))) {
      return `${to}${path.slice(from.length)}`;
    }
    return path;
  };
  if (isTabs(node)) {
    return {
      ...node,
      tabs: node.tabs.map((tab) => (tab.kind === "graph" ? tab : { ...tab, path: mapPath(tab.path) })),
    };
  }
  return {
    ...node,
    first: renameLayoutPaths(node.first, from, to, isDir),
    second: renameLayoutPaths(node.second, from, to, isDir),
  };
}

export function isLayoutNode(value: unknown): value is LayoutNode {
  if (!value || typeof value !== "object") return false;
  const node = value as LayoutNode;
  if (node.type === "tabs") {
    return typeof node.id === "string" && typeof node.active === "string" && Array.isArray(node.tabs);
  }
  if (node.type === "split") {
    return (
      typeof node.id === "string" &&
      (node.direction === "horizontal" || node.direction === "vertical") &&
      typeof node.ratio === "number" &&
      isLayoutNode(node.first) &&
      isLayoutNode(node.second)
    );
  }
  return false;
}
