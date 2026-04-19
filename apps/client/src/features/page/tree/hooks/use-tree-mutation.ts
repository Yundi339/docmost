import {
  CreateHandler,
  DeleteHandler,
  MoveHandler,
  NodeApi,
  RenameHandler,
  SimpleTree,
} from "react-arborist";
import { useAtom } from "jotai";
import { treeDataAtom } from "@/features/page/tree/atoms/tree-data-atom.ts";
import { IMovePage, IPage } from "@/features/page/types/page.types.ts";
import { useNavigate, useParams } from "react-router-dom";
import {
  useCreatePageMutation,
  useRemovePageMutation,
  useMovePageMutation,
  useUpdatePageMutation,
  updateCacheOnMovePage,
} from "@/features/page/queries/page-query.ts";
import { generateJitteredKeyBetween } from "fractional-indexing-jittered";
import { SpaceTreeNode } from "@/features/page/tree/types.ts";
import { buildPageUrl } from "@/features/page/page.utils.ts";
import { getSpaceUrl } from "@/lib/config.ts";
import { useQueryEmit } from "@/features/websocket/use-query-emit.ts";

// Module-level flag to suppress handleLoadChildren during move operations.
// When a move is in progress, async child-loading from the server may return
// stale data that conflicts with the optimistic tree update.
let _moveInProgress = false;
export function isTreeMoveInProgress() {
  return _moveInProgress;
}

export function useTreeMutation<T>(spaceId: string) {
  const [data, setData] = useAtom(treeDataAtom);
  const createPageMutation = useCreatePageMutation();
  const updatePageMutation = useUpdatePageMutation();
  const removePageMutation = useRemovePageMutation();
  const movePageMutation = useMovePageMutation();
  const navigate = useNavigate();
  const { spaceSlug } = useParams();
  const { pageSlug } = useParams();
  const emit = useQueryEmit();

  const onCreate: CreateHandler<T> = async ({ parentId, index, type }) => {
    const payload: { spaceId: string; parentPageId?: string } = {
      spaceId: spaceId,
    };
    if (parentId) {
      payload.parentPageId = parentId;
    }

    let createdPage: IPage;
    try {
      createdPage = await createPageMutation.mutateAsync(payload);
    } catch (err) {
      throw new Error("Failed to create page");
    }

    const data = {
      id: createdPage.id,
      slugId: createdPage.slugId,
      name: "",
      position: createdPage.position,
      spaceId: createdPage.spaceId,
      parentPageId: createdPage.parentPageId,
      children: [],
    } as any;

    // Use a fresh deep clone to avoid directly mutating Jotai atom value
    const freshCreate = new SimpleTree<SpaceTreeNode>(structuredClone(data));

    let lastIndex: number;
    if (parentId === null) {
      lastIndex = freshCreate.data.length;
    } else {
      lastIndex = freshCreate.find(parentId).children.length;
    }
    // to place the newly created node at the bottom
    index = lastIndex;

    freshCreate.create({ parentId, index, data });
    setData(freshCreate.data);

    setTimeout(() => {
      emit({
        operation: "addTreeNode",
        spaceId: spaceId,
        payload: {
          parentId,
          index,
          data,
        },
      });
    }, 50);

    const pageUrl = buildPageUrl(
      spaceSlug,
      createdPage.slugId,
      createdPage.title
    );
    navigate(pageUrl);
    return data;
  };

  const onMove: MoveHandler<T> = async (args: {
    dragIds: string[];
    dragNodes: NodeApi<T>[];
    parentId: string | null;
    parentNode: NodeApi<T> | null;
    index: number;
  }) => {
    const { dragNodes, parentId } = args;

    // Filter out nodes that are descendants of other dragged nodes.
    // Moving a parent already moves its entire subtree, so descendants
    // in the selection are redundant and would break nesting.
    const dragIdSet = new Set(args.dragIds);
    const filteredDragNodes = dragNodes.filter((node) => {
      let ancestor = node.parent;
      while (ancestor && !ancestor.isRoot) {
        if (dragIdSet.has(ancestor.id)) return false;
        ancestor = ancestor.parent;
      }
      return true;
    });
    const dragIds = filteredDragNodes.map((n) => n.id);

    // Suppress handleLoadChildren while move is in progress to prevent
    // stale server data from overwriting our optimistic tree update.
    _moveInProgress = true;

    // Create a fresh SimpleTree from a deep clone so we don't mutate Jotai atom value
    const dataCopy = structuredClone(data);
    const freshTree = new SimpleTree<SpaceTreeNode>(dataCopy);

    // Move and calculate position for each node one at a time
    const moveResults: {
      nodeId: string;
      position: string;
      dragNode: NodeApi<T>;
      oldParentId: string | null;
    }[] = [];

    for (let i = 0; i < dragIds.length; i++) {
      const draggedNodeId = dragIds[i];

      // For the first node, use args.index from react-arborist.
      // For subsequent nodes, place them right after the previously moved node
      // to ensure they stay consecutive. Using args.index + i doesn't work
      // because each move shifts the array indices.
      let targetIndex: number;
      if (i === 0) {
        targetIndex = args.index;
      } else {
        const prevMovedIndex = freshTree.find(dragIds[i - 1])?.childIndex;
        targetIndex = (prevMovedIndex ?? args.index) + 1;
      }

      freshTree.move({
        id: draggedNodeId,
        parentId: parentId,
        index: targetIndex,
      });

      const newDragIndex = freshTree.find(draggedNodeId)?.childIndex;

      const currentTreeData = parentId
        ? freshTree.find(parentId).children
        : freshTree.data;

      const afterPosition =
        // @ts-ignore
        currentTreeData[newDragIndex - 1]?.position ||
        // @ts-ignore
        currentTreeData[newDragIndex - 1]?.data?.position ||
        null;

      const beforePosition =
        // @ts-ignore
        currentTreeData[newDragIndex + 1]?.position ||
        // @ts-ignore
        currentTreeData[newDragIndex + 1]?.data?.position ||
        null;

      let newPosition: string;

      if (afterPosition && beforePosition && afterPosition === beforePosition) {
        newPosition = generateJitteredKeyBetween(afterPosition, null);
      } else {
        newPosition = generateJitteredKeyBetween(afterPosition, beforePosition);
      }

      freshTree.update({
        id: draggedNodeId,
        changes: { position: newPosition } as any,
      });

      const nodeData = filteredDragNodes[i].data as unknown as SpaceTreeNode;
      moveResults.push({
        nodeId: draggedNodeId,
        position: newPosition,
        dragNode: filteredDragNodes[i],
        oldParentId: nodeData.parentPageId ?? null,
      });
    }

    // Update hasChildren for previous parents that lost all dragged children
    for (const dragNode of filteredDragNodes) {
      const previousParent = dragNode.parent;
      if (
        previousParent.id !== parentId &&
        previousParent.id !== "__REACT_ARBORIST_INTERNAL_ROOT__"
      ) {
        const childrenCount = previousParent.children.filter(
          (child) => !dragIds.includes(child.id)
        ).length;
        if (childrenCount === 0) {
          freshTree.update({
            id: previousParent.id,
            changes: { hasChildren: false } as any,
          });
        }
      }
    }

    const newData = freshTree.data;

    // Optimistically update react-query cache BEFORE setData to prevent
    // mergeRootTrees from re-adding moved nodes when pagesData effect fires
    for (const result of moveResults) {
      const nodeData = result.dragNode.data as unknown as SpaceTreeNode;
      const pageData = {
        id: nodeData.id,
        slugId: nodeData.slugId,
        title: nodeData.name,
        icon: nodeData.icon,
        position: result.position,
        spaceId: nodeData.spaceId,
        parentPageId: parentId,
        hasChildren: nodeData.hasChildren,
      };

      updateCacheOnMovePage(
        spaceId,
        result.nodeId,
        result.oldParentId,
        parentId,
        pageData
      );
    }

    setData(newData);

    // Call API and emit WebSocket for each moved node
    for (const result of moveResults) {
      const nodeData = result.dragNode.data as unknown as SpaceTreeNode;
      const payload: IMovePage = {
        pageId: result.nodeId,
        position: result.position,
        parentPageId: parentId,
      };

      const pageData = {
        id: nodeData.id,
        slugId: nodeData.slugId,
        title: nodeData.name,
        icon: nodeData.icon,
        position: result.position,
        spaceId: nodeData.spaceId,
        parentPageId: parentId,
        hasChildren: nodeData.hasChildren,
      };

      try {
        await movePageMutation.mutateAsync(payload);

        setTimeout(() => {
          emit({
            operation: "moveTreeNode",
            spaceId: spaceId,
            payload: {
              id: result.nodeId,
              parentId: parentId,
              oldParentId: result.oldParentId,
              index: args.index,
              position: result.position,
              pageData,
            },
          });
        }, 50);
      } catch (error) {
        console.error("Error moving page:", error);
      }
    }

    // Allow handleLoadChildren to run again now that API calls are done
    _moveInProgress = false;
  };

  const onRename: RenameHandler<T> = ({ name, id }) => {
    const freshRename = new SimpleTree<SpaceTreeNode>(structuredClone(data));
    freshRename.update({ id, changes: { name } as any });
    setData(freshRename.data);

    try {
      updatePageMutation.mutateAsync({ pageId: id, title: name });
    } catch (error) {
      console.error("Error updating page title:", error);
    }
  };

  const isPageInNode = (
    node: { data: SpaceTreeNode; children?: any[] },
    pageSlug: string
  ): boolean => {
    if (node.data.slugId === pageSlug) {
      return true;
    }
    for (const item of node.children) {
      if (item.data.slugId === pageSlug) {
        return true;
      } else {
        return isPageInNode(item, pageSlug);
      }
    }
    return false;
  };

  const onDelete: DeleteHandler<T> = async (args: { ids: string[] }) => {
    try {
      await removePageMutation.mutateAsync(args.ids[0]);

      const freshDelete = new SimpleTree<SpaceTreeNode>(structuredClone(data));
      const node = freshDelete.find(args.ids[0]);
      if (!node) {
        return;
      }

      freshDelete.drop({ id: args.ids[0] });
      setData(freshDelete.data);

      if (pageSlug && isPageInNode(node, pageSlug.split("-")[1])) {
        navigate(getSpaceUrl(spaceSlug));
      }

      setTimeout(() => {
        emit({
          operation: "deleteTreeNode",
          spaceId: spaceId,
          payload: { node: node.data },
        });
      }, 50);
    } catch (error) {
      console.error("Failed to delete page:", error);
    }
  };

  const controllers = { onMove, onRename, onCreate, onDelete };
  return { data, setData, controllers } as const;
}
