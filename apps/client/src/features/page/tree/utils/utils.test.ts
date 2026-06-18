import { describe, expect, it } from "vitest";

import type { SpaceTreeNode } from "@/features/page/tree/types";
import {
  buildTreeWithChildren,
  expandOpenStateForPath,
  setTreeNodeOpenState,
} from "./utils";

function node(
  id: string,
  position: string,
  parentPageId: string | null = null,
): SpaceTreeNode {
  return {
    id,
    slugId: id,
    name: id,
    position,
    spaceId: "space-1",
    parentPageId,
    hasChildren: false,
    children: [],
  };
}

describe("buildTreeWithChildren", () => {
  it("builds nested children and sorts each sibling group", () => {
    const tree = buildTreeWithChildren([
      node("child-b", "B", "root"),
      node("root", "B"),
      node("child-a", "A", "root"),
      node("other-root", "A"),
    ]);

    expect(tree.map((n) => n.id)).toEqual(["other-root", "root"]);
    expect(tree[1].children.map((n) => n.id)).toEqual(["child-a", "child-b"]);
    expect(tree[1].hasChildren).toBe(true);
  });

  it("keeps pages with missing parents visible at root level", () => {
    const tree = buildTreeWithChildren([
      node("orphan", "A", "missing-parent"),
      node("orphan-child", "A", "orphan"),
      node("root", "B"),
    ]);

    expect(tree.map((n) => n.id)).toEqual(["orphan", "root"]);
    expect(tree[0].children.map((n) => n.id)).toEqual(["orphan-child"]);
  });
});

describe("tree open state", () => {
  it("stores only open nodes when toggling", () => {
    expect(
      setTreeNodeOpenState(
        { alreadyOpen: true, staleClosed: false },
        "alreadyOpen",
        false,
      ),
    ).toEqual({});

    expect(
      setTreeNodeOpenState({ staleClosed: false }, "newOpen", true),
    ).toEqual({ newOpen: true });
  });

  it("expands the current page path including the selected node itself", () => {
    const leaf = node("leaf", "A", "current");
    const current = {
      ...node("current", "A", "root"),
      hasChildren: true,
      children: [leaf],
    };
    const root = {
      ...node("root", "A"),
      hasChildren: true,
      children: [current],
    };

    expect(
      expandOpenStateForPath(
        { root: false, unrelated: true },
        [root, current],
      ),
    ).toEqual({
      root: true,
      current: true,
      unrelated: true,
    });
  });

  it("does not open leaf pages or allocate when nothing changes", () => {
    const root = {
      ...node("root", "A"),
      hasChildren: true,
      children: [node("leaf", "A", "root")],
    };
    const openState = { root: true };

    expect(expandOpenStateForPath(openState, [root])).toBe(openState);
    expect(expandOpenStateForPath(openState, [root.children[0]])).toBe(
      openState,
    );
  });
});
