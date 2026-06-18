import { describe, expect, it } from "vitest";

import type { SpaceTreeNode } from "@/features/page/tree/types";
import { buildTreeWithChildren } from "./utils";

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
