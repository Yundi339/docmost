import { describe, expect, it } from "vitest";
import type { SpaceTreeNode } from "@/features/page/tree/types";
import { canApplyPageTreeDrop } from "./page-tree-capabilities";

function node(
  id: string,
  parentPageId: string | null = null,
  capabilities?: SpaceTreeNode["capabilities"],
): SpaceTreeNode {
  return {
    id,
    slugId: id,
    name: id,
    position: id,
    spaceId: "space-1",
    parentPageId,
    hasChildren: false,
    capabilities,
    children: [],
  };
}

describe("canApplyPageTreeDrop", () => {
  it("rejects dragging a node whose move capability is disabled", () => {
    const tree = [node("board"), node("item", "board", { move: false })];

    expect(
      canApplyPageTreeDrop(tree, "item", {
        kind: "reorder-after",
        targetId: "board",
      }),
    ).toBe(false);
  });

  it("allows same-parent reorder but rejects reparenting a managed node", () => {
    const tree = [
      {
        ...node("board", null, { createChild: false }),
        children: [
          node("item", "board", { reparent: false }),
          node("sibling", "board"),
        ],
      },
      node("other"),
    ];

    expect(
      canApplyPageTreeDrop(tree, "item", {
        kind: "reorder-after",
        targetId: "sibling",
      }),
    ).toBe(true);
    expect(
      canApplyPageTreeDrop(tree, "item", {
        kind: "make-child",
        targetId: "other",
      }),
    ).toBe(false);
  });

  it("rejects a drop that would create a child under a restricted parent", () => {
    const tree = [node("page"), node("board", null, { createChild: false })];

    expect(
      canApplyPageTreeDrop(tree, "page", {
        kind: "make-child",
        targetId: "board",
      }),
    ).toBe(false);
  });

  it("allows reordering next to a restricted parent", () => {
    const tree = [node("page"), node("board", null, { createChild: false })];

    expect(
      canApplyPageTreeDrop(tree, "page", {
        kind: "reorder-after",
        targetId: "board",
      }),
    ).toBe(true);
  });
});
