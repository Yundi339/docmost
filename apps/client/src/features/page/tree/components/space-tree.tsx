import { useAtom } from "jotai";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { Text } from "@mantine/core";
import { useDisclosure } from "@mantine/hooks";
import { notifications } from "@mantine/notifications";
import {
  useGetFullSidebarTreeQuery,
  usePageQuery,
  useRemovePageMutation,
} from "@/features/page/queries/page-query.ts";
import classes from "@/features/page/tree/styles/tree.module.css";
import { treeDataAtom } from "@/features/page/tree/atoms/tree-data-atom.ts";
import {
  OpenMap,
  openTreeNodesAtom,
} from "@/features/page/tree/atoms/open-tree-nodes-atom.ts";
import { useTreeMutation } from "@/features/page/tree/hooks/use-tree-mutation.ts";
import { SpaceTreeNode } from "@/features/page/tree/types.ts";
import { treeModel } from "@/features/page/tree/model/tree-model";
import {
  compactTreeOpenState,
  expandOpenStateForPath,
  setTreeNodeOpenState,
} from "@/features/page/tree/utils/utils.ts";
import { extractPageSlugId } from "@/lib";
import { useDeletePageModal } from "@/features/page/hooks/use-delete-page-modal.tsx";
import BulkExportModal from "@/components/common/bulk-export-modal";
import BulkMovePageModal from "@/features/page/components/bulk-move-page-modal.tsx";
import { DocTree } from "./doc-tree";
import { SpaceTreeRow } from "./space-tree-row";

type SpaceSelectionState = {
  selectionMode: boolean;
  selectedCount: number;
  selectedIds: string[];
  clearSelection: () => void;
  toggleSelectionMode: () => void;
  selectAllVisible: () => void;
  deleteSelected: () => void;
  exportSelected: () => void;
  openMoveSelected: () => void;
};

interface SpaceTreeProps {
  spaceId: string;
  readOnly: boolean;
  onSelectionStateChange?: (state: SpaceSelectionState) => void;
}

const STORAGE_KEY_PREFIX = "docmost:tree-open:";

function loadOpenState(spaceId: string): OpenMap {
  try {
    if (typeof localStorage === "undefined") return {};
    const stored = localStorage.getItem(STORAGE_KEY_PREFIX + spaceId);
    return stored ? compactTreeOpenState(JSON.parse(stored)) : {};
  } catch {
    return {};
  }
}

function saveOpenState(spaceId: string, openState: OpenMap): void {
  try {
    if (typeof localStorage === "undefined") return;
    localStorage.setItem(STORAGE_KEY_PREFIX + spaceId, JSON.stringify(openState));
  } catch {
    // localStorage may be unavailable or full.
  }
}

function collectNodeAndDescendantIds(node: SpaceTreeNode): string[] {
  const ids = [node.id];
  for (const child of node.children ?? []) {
    ids.push(...collectNodeAndDescendantIds(child));
  }
  return ids;
}

function flattenLoadedIds(nodes: SpaceTreeNode[]): string[] {
  const ids: string[] = [];
  const walk = (items: SpaceTreeNode[]) => {
    for (const node of items) {
      ids.push(node.id);
      if (node.children?.length) walk(node.children);
    }
  };
  walk(nodes);
  return ids;
}

export default function SpaceTree({
  spaceId,
  readOnly,
  onSelectionStateChange,
}: SpaceTreeProps) {
  const { t } = useTranslation();
  const { pageSlug, spaceSlug } = useParams();
  const [data, setData] = useAtom(treeDataAtom);
  const { handleMove } = useTreeMutation(spaceId);
  const { data: fullTreeData } = useGetFullSidebarTreeQuery({ spaceId });
  const [openTreeNodes, setOpenTreeNodes] = useAtom(openTreeNodesAtom);
  const [isDataLoaded, setIsDataLoaded] = useState(false);
  const [selectionMode, setSelectionMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const selectionModeRef = useRef(selectionMode);
  const selectedIdsRef = useRef(selectedIds);
  const selectionAnchorIdRef = useRef<string | null>(null);
  const removePageMutation = useRemovePageMutation();
  const { openDeleteModal: openBulkDeleteModal } = useDeletePageModal();
  const [bulkExportOpened, { open: openBulkExport, close: closeBulkExport }] =
    useDisclosure(false);
  const [bulkMoveOpened, { open: openBulkMove, close: closeBulkMove }] =
    useDisclosure(false);
  selectionModeRef.current = selectionMode;
  selectedIdsRef.current = selectedIds;
  const { data: currentPage } = usePageQuery({
    pageId: extractPageSlugId(pageSlug),
  });

  useEffect(() => {
    setIsDataLoaded(false);
    setSelectedIds([]);
    setSelectionMode(false);
    selectionAnchorIdRef.current = null;
    setOpenTreeNodes((prev) => ({ ...prev, ...loadOpenState(spaceId) }));
  }, [spaceId]);

  useEffect(() => {
    if (!fullTreeData) return;

    setData((prev) => {
      const otherSpaces = prev.filter((n) => n?.spaceId !== spaceId);
      return [...otherSpaces, ...fullTreeData];
    });
    setIsDataLoaded(true);
  }, [fullTreeData, setData, spaceId]);

  useEffect(() => {
    if (!isDataLoaded || !currentPage?.id) return;
    const path = treeModel.path(
      data.filter((node) => node?.spaceId === spaceId),
      currentPage.id,
    );
    if (!path) return;

    setOpenTreeNodes((prev) => {
      const next = expandOpenStateForPath(prev, path);
      if (next === prev) return prev;
      saveOpenState(spaceId, next);
      return next;
    });
  }, [data, isDataLoaded, currentPage?.id, setOpenTreeNodes, spaceId]);

  const openIds = useMemo(
    () => new Set(Object.keys(openTreeNodes).filter((k) => openTreeNodes[k])),
    [openTreeNodes],
  );

  const handleToggle = useCallback(
    (id: string, isOpen: boolean) => {
      setOpenTreeNodes((prev) => {
        const next = setTreeNodeOpenState(prev, id, isOpen);
        saveOpenState(spaceId, next);
        return next;
      });
    },
    [setOpenTreeNodes, spaceId],
  );

  const filteredData = useMemo(
    () => data.filter((node) => node?.spaceId === spaceId),
    [data, spaceId],
  );
  const selectedIdsSet = useMemo(() => new Set(selectedIds), [selectedIds]);

  const clearSelectionMode = useCallback(() => {
    setSelectedIds([]);
    setSelectionMode(false);
    selectionAnchorIdRef.current = null;
  }, []);

  const toggleSelectionMode = useCallback(() => {
    if (selectionModeRef.current) {
      clearSelectionMode();
    } else {
      setSelectionMode(true);
    }
  }, [clearSelectionMode]);

  const selectAllVisible = useCallback(() => {
    const visibleIds = treeModel.visible(filteredData, openIds).map((n) => n.id);
    setSelectedIds(visibleIds);
    setSelectionMode(true);
    selectionAnchorIdRef.current = visibleIds[0] ?? null;
  }, [filteredData, openIds]);

  const selectNodeWithDescendants = useCallback((node: SpaceTreeNode) => {
    const ids = collectNodeAndDescendantIds(node);
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(node.id)) {
        ids.forEach((id) => next.delete(id));
      } else {
        ids.forEach((id) => next.add(id));
      }
      return Array.from(next);
    });
    selectionAnchorIdRef.current = node.id;
  }, []);

  const toggleNodeOnly = useCallback((node: SpaceTreeNode) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(node.id)) {
        next.delete(node.id);
      } else {
        next.add(node.id);
      }
      return Array.from(next);
    });
    selectionAnchorIdRef.current = node.id;
  }, []);

  const selectRangeTo = useCallback(
    (node: SpaceTreeNode) => {
      const anchorId = selectionAnchorIdRef.current ?? node.id;
      if (anchorId === node.id) {
        selectNodeWithDescendants(node);
        return;
      }

      const flatIds = flattenLoadedIds(filteredData);
      const anchorIndex = flatIds.indexOf(anchorId);
      const targetIndex = flatIds.indexOf(node.id);
      if (anchorIndex === -1 || targetIndex === -1) {
        selectNodeWithDescendants(node);
        return;
      }

      const [start, end] =
        anchorIndex <= targetIndex
          ? [anchorIndex, targetIndex]
          : [targetIndex, anchorIndex];
      const rangeIds = flatIds.slice(start, end + 1);
      setSelectedIds((prev) => Array.from(new Set([...prev, ...rangeIds])));
    },
    [filteredData, selectNodeWithDescendants],
  );

  const handleSelectionChange = useCallback(
    (node: SpaceTreeNode, event: React.MouseEvent<HTMLElement>) => {
      setSelectionMode(true);
      if (event.shiftKey) {
        selectRangeTo(node);
      } else if (event.ctrlKey || event.metaKey) {
        toggleNodeOnly(node);
      } else {
        selectNodeWithDescendants(node);
      }
    },
    [selectNodeWithDescendants, selectRangeTo, toggleNodeOnly],
  );

  const deleteSelected = useCallback(() => {
    const ids = selectedIdsRef.current;
    if (ids.length === 0) return;
    openBulkDeleteModal({
      onConfirm: async () => {
        let failed = 0;
        for (const id of ids) {
          try {
            await removePageMutation.mutateAsync(id);
          } catch (err) {
            failed++;
            console.error("Bulk delete failed for", id, err);
          }
        }

        if (failed > 0) {
          notifications.show({
            message: t("{{ok}} deleted, {{failed}} failed", {
              ok: ids.length - failed,
              failed,
            }),
            color: "orange",
          });
        } else {
          notifications.show({ message: t("Pages moved to trash") });
        }

        setData((prev) =>
          ids.reduce((next, id) => treeModel.remove(next, id), prev),
        );
        clearSelectionMode();
      },
    });
  }, [
    clearSelectionMode,
    openBulkDeleteModal,
    removePageMutation,
    setData,
    t,
  ]);

  const exportSelected = useCallback(() => {
    if (selectedIdsRef.current.length === 0) return;
    openBulkExport();
  }, [openBulkExport]);

  const openMoveSelected = useCallback(() => {
    if (selectedIdsRef.current.length === 0) return;
    openBulkMove();
  }, [openBulkMove]);

  const selectionCallbacksRef = useRef({
    clearSelectionMode,
    toggleSelectionMode,
    selectAllVisible,
    deleteSelected,
    exportSelected,
    openMoveSelected,
  });
  selectionCallbacksRef.current = {
    clearSelectionMode,
    toggleSelectionMode,
    selectAllVisible,
    deleteSelected,
    exportSelected,
    openMoveSelected,
  };

  useEffect(() => {
    if (!onSelectionStateChange) return;
    const cb = selectionCallbacksRef.current;
    onSelectionStateChange({
      selectionMode,
      selectedCount: selectedIds.length,
      selectedIds,
      clearSelection: cb.clearSelectionMode,
      toggleSelectionMode: cb.toggleSelectionMode,
      selectAllVisible: cb.selectAllVisible,
      deleteSelected: cb.deleteSelected,
      exportSelected: cb.exportSelected,
      openMoveSelected: cb.openMoveSelected,
    });
  }, [selectionMode, selectedIds, onSelectionStateChange]);

  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (
        target &&
        (target.tagName === "INPUT" ||
          target.tagName === "TEXTAREA" ||
          target.isContentEditable)
      ) {
        return;
      }

      if (event.key === "Escape" && selectionModeRef.current) {
        event.preventDefault();
        clearSelectionMode();
        return;
      }

      if (
        (event.ctrlKey || event.metaKey) &&
        event.key.toLowerCase() === "a" &&
        selectionModeRef.current
      ) {
        event.preventDefault();
        selectAllVisible();
        return;
      }

      if (
        (event.key === "Delete" || event.key === "Backspace") &&
        selectionModeRef.current &&
        selectedIdsRef.current.length > 0
      ) {
        event.preventDefault();
        deleteSelected();
      }
    };

    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [clearSelectionMode, deleteSelected, selectAllVisible]);

  // Stable callbacks for DocTree. Without these, every parent render recreates
  // the props and tears down every row's draggable/dropTarget subscription,
  // defeating memo(DocTreeRow).
  const renderRow = useCallback(
    (rowProps: Parameters<typeof SpaceTreeRow>[0]) => (
      <SpaceTreeRow
        {...rowProps}
        readOnly={readOnly}
        selectionMode={selectionMode}
        selectedIds={selectedIdsSet}
        onEnterSelectionMode={() => setSelectionMode(true)}
        onSelectionChange={handleSelectionChange}
      />
    ),
    [handleSelectionChange, readOnly, selectedIdsSet, selectionMode],
  );
  const disableDragDrop = useCallback(
    (n: SpaceTreeNode) => n.canEdit === false,
    [],
  );
  const getDragLabel = useCallback(
    (n: SpaceTreeNode) => n.name || t("untitled"),
    [t],
  );

  return (
    <div className={classes.treeContainer}>
      {isDataLoaded && filteredData.length === 0 && (
        <Text size="xs" c="dimmed" py="xs" px="sm">
          {t("No pages yet")}
        </Text>
      )}
      {isDataLoaded && filteredData.length > 0 && (
        <DocTree<SpaceTreeNode>
          data={filteredData}
          openIds={openIds}
          selectedId={currentPage?.id}
          renderRow={renderRow}
          onMove={handleMove}
          onToggle={handleToggle}
          readOnly={readOnly}
          disableDrag={disableDragDrop}
          disableDrop={disableDragDrop}
          getDragLabel={getDragLabel}
          aria-label={t("Pages")}
        />
      )}

      <BulkExportModal
        pageIds={selectedIds}
        open={bulkExportOpened}
        onClose={closeBulkExport}
      />

      <BulkMovePageModal
        pageIds={selectedIds}
        currentSpaceSlug={spaceSlug ?? ""}
        open={bulkMoveOpened}
        onClose={closeBulkMove}
        onMoved={clearSelectionMode}
      />
    </div>
  );
}
