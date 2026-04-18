import { useMemo } from "react";
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

export function useTreeMutation<T>(spaceId: string) {
  const [data, setData] = useAtom(treeDataAtom);
  const tree = useMemo(() => new SimpleTree<SpaceTreeNode>(data), [data]);
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

    let lastIndex: number;
    if (parentId === null) {
      lastIndex = tree.data.length;
    } else {
      lastIndex = tree.find(parentId).children.length;
    }
    // to place the newly created node at the bottom
    index = lastIndex;

    tree.create({ parentId, index, data });
    setData(tree.data);

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
    const { dragIds, dragNodes, parentId } = args;

    // Collect previous parents before any moves (for hasChildren updates)
    const previousParents = new Map<string, NodeApi<T>>();
    for (const dragNode of dragNodes) {
      const prev = dragNode.parent;
      if (
        prev.id !== parentId &&
        prev.id !== "__REACT_ARBORIST_INTERNAL_ROOT__"
      ) {
        previousParents.set(prev.id, prev);
      }
    }

    // Move each dragged node into the target parent at consecutive indices
    const moveResults: {
      nodeId: string;
      position: string;
      dragNode: NodeApi<T>;
      oldParentId: string | null;
    }[] = [];

    for (let i = 0; i < dragIds.length; i++) {
      const draggedNodeId = dragIds[i];

      tree.move({
        id: draggedNodeId,
        parentId: parentId,
        index: args.index + i,
      });

      const newDragIndex = tree.find(draggedNodeId)?.childIndex;

      const currentTreeData = parentId
        ? tree.find(parentId).children
        : tree.data;

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

      tree.update({
        id: draggedNodeId,
        changes: { position: newPosition } as any,
      });

      const nodeData = dragNodes[i].data as unknown as SpaceTreeNode;
      moveResults.push({
        nodeId: draggedNodeId,
        position: newPosition,
        dragNode: dragNodes[i],
        oldParentId: nodeData.parentPageId ?? null,
      });
    }

    // Update hasChildren for previous parents that lost all dragged children
    for (const [prevParentId, prevParent] of previousParents) {
      const remainingChildren = prevParent.children.filter(
        (child) => !dragIds.includes(child.id)
      ).length;
      if (remainingChildren === 0) {
        tree.update({
          id: prevParentId,
          changes: { ...prevParent.data, hasChildren: false } as any,
        });
      }
    }

    setData(tree.data);

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

        updateCacheOnMovePage(
          spaceId,
          result.nodeId,
          result.oldParentId,
          parentId,
          pageData
        );

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
  };

  const onRename: RenameHandler<T> = ({ name, id }) => {
    tree.update({ id, changes: { name } as any });
    setData(tree.data);

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

      const node = tree.find(args.ids[0]);
      if (!node) {
        return;
      }

      tree.drop({ id: args.ids[0] });
      setData(tree.data);

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
