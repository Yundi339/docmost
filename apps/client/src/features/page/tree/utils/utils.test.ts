import { describe, expect, it } from "vitest";

import type { SpaceTreeNode } from "@/features/page/tree/types";
import {
  buildTree,
  buildTreeWithChildren,
  expandOpenStateForPath,
  getSpaceTree,
  replaceSpaceTree,
  setTreeNodeOpenState,
} from "./utils";
import type { IPage } from "@/features/page/types/page.types";

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

describe("buildTree", () => {
  it("preserves runtime extensions and operation capabilities", () => {
    const tree = buildTree([
      {
        id: "work-item",
        slugId: "work-item",
        title: "Work item",
        position: "A",
        spaceId: "space-1",
        parentPageId: "board-page",
        hasChildren: false,
        extensions: [
          { provider: "database", role: "record", resourceId: "record-1" },
        ],
        capabilities: {
          reparent: false,
          moveToSpace: false,
          duplicate: false,
        },
      } as IPage,
    ]);

    expect(tree[0]).toMatchObject({
      extensions: [
        { provider: "database", role: "record", resourceId: "record-1" },
      ],
      capabilities: {
        reparent: false,
        moveToSpace: false,
        duplicate: false,
      },
    });
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
      expandOpenStateForPath({ root: false, unrelated: true }, [root, current]),
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

describe("space tree isolation", () => {
  it("extracts only roots belonging to the requested space", () => {
    const otherSpace = { ...node("other", "A"), spaceId: "space-2" };
    const tree = [otherSpace, node("one", "A"), node("two", "B")];

    expect(getSpaceTree(tree, "space-1").map((item) => item.id)).toEqual([
      "one",
      "two",
    ]);
  });

  it("replaces one space without moving or modifying other spaces", () => {
    const otherBefore = { ...node("other-before", "A"), spaceId: "space-2" };
    const otherAfter = { ...node("other-after", "B"), spaceId: "space-3" };
    const tree = [otherBefore, node("old-one", "A"), node("old-two", "B"), otherAfter];
    const replacement = [node("new-first", "A"), node("new-second", "B")];

    expect(
      replaceSpaceTree(tree, "space-1", replacement).map((item) => item.id),
    ).toEqual(["other-before", "new-first", "new-second", "other-after"]);
  });
});
