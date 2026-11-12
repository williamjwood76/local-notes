import type { FsEntry } from "./types";

export type TreeNode = {
  path: string;
  name: string;
  isDir: boolean;
  children: TreeNode[];
};

export function buildTree(entries: FsEntry[]): TreeNode[] {
  const root: TreeNode[] = [];
  const index = new Map<string, TreeNode>();
  const sorted = [...entries].sort((a, b) => a.path.localeCompare(b.path));
  for (const entry of sorted) {
    if (entry.name.endsWith(".annotations.json")) continue;
    const parts = entry.path.split("/");
    let children = root;
    let path = "";
    for (let i = 0; i < parts.length; i++) {
      path = path ? `${path}/${parts[i]}` : parts[i];
      let node = index.get(path);
      if (!node) {
        node = {
          path,
          name: parts[i],
          isDir: i === parts.length - 1 ? entry.isDir : true,
          children: [],
        };
        index.set(path, node);
        children.push(node);
      }
      children = node.children;
    }
  }
  const sortLevel = (nodes: TreeNode[]) => {
    nodes.sort(
      (a, b) => Number(b.isDir) - Number(a.isDir) || a.name.localeCompare(b.name, undefined, { sensitivity: "base" }),
    );
    for (const node of nodes) sortLevel(node.children);
  };
  sortLevel(root);
  return root;
}
