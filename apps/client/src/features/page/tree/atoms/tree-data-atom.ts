import { atom } from "jotai";
import { SpaceTreeNode } from "@/features/page/tree/types";
import { appendNodeChildren } from "../utils";

const _treeDataAtom = atom<SpaceTreeNode[]>([]);

// Debug wrapper to trace all writes to treeDataAtom
export const treeDataAtom = atom(
  (get) => get(_treeDataAtom),
  (get, set, update: SpaceTreeNode[] | ((prev: SpaceTreeNode[]) => SpaceTreeNode[])) => {
    const newValue = typeof update === 'function' ? update(get(_treeDataAtom)) : update;
    console.trace("[treeDataAtom SET] root count:", newValue.length);
    set(_treeDataAtom, newValue);
  }
);

// Atom
export const appendNodeChildrenAtom = atom(
  null,
  (
    get,
    set,
    { parentId, children }: { parentId: string; children: SpaceTreeNode[] }
  ) => {
    const currentTree = get(treeDataAtom);
    const updatedTree = appendNodeChildren(currentTree, parentId, children);
    set(treeDataAtom, updatedTree);
  }
);
