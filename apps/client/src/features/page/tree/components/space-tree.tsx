import {
  NodeApi,
  NodeRendererProps,
  Tree,
  TreeApi,
  SimpleTree,
} from "react-arborist";
import { atom, useAtom } from "jotai";
import { treeApiAtom } from "@/features/page/tree/atoms/tree-api-atom.ts";
import {
  fetchAllAncestorChildren,
  useGetRootSidebarPagesQuery,
  usePageQuery,
  useRemovePageMutation,
  useUpdatePageMutation,
} from "@/features/page/queries/page-query.ts";
import { useCallback, useEffect, useRef, useState } from "react";
import { Link, useParams } from "react-router-dom";
import classes from "@/features/page/tree/styles/tree.module.css";
import { ActionIcon, Box, Menu, rem, Text } from "@mantine/core";
import {
  IconArrowRight,
  IconChevronDown,
  IconChevronRight,
  IconCopy,
  IconDotsVertical,
  IconFileExport,
  IconLink,
  IconPlus,
  IconPointFilled,
  IconSquare,
  IconSquareCheckFilled,
  IconSquareMinusFilled,
  IconStar,
  IconStarFilled,
  IconTrash,
} from "@tabler/icons-react";
import {
  appendNodeChildrenAtom,
  treeDataAtom,
} from "@/features/page/tree/atoms/tree-data-atom.ts";
import clsx from "clsx";
import { useTreeMutation, isTreeMoveInProgress } from "@/features/page/tree/hooks/use-tree-mutation.ts";
import {
  appendNodeChildren,
  buildTree,
  buildTreeWithChildren,
  mergeRootTrees,
} from "@/features/page/tree/utils/utils.ts";
import { SpaceTreeNode } from "@/features/page/tree/types.ts";
import {
  exportPage,
  getPageById,
} from "@/features/page/services/page-service.ts";
import { ExportFormat } from "@/features/page/types/page.types.ts";
import { SidebarPagesParams } from "@/features/page/types/page.types.ts";
import { queryClient } from "@/main.tsx";
import { OpenMap } from "react-arborist/dist/main/state/open-slice";
import { useDisclosure, useElementSize, useMergedRef } from "@mantine/hooks";
import { useClipboard } from "@/hooks/use-clipboard";
import { useQueryEmit } from "@/features/websocket/use-query-emit.ts";
import { buildPageUrl } from "@/features/page/page.utils.ts";
import { notifications } from "@mantine/notifications";
import { getAppUrl } from "@/lib/config.ts";
import { extractPageSlugId } from "@/lib";
import { useDeletePageModal } from "@/features/page/hooks/use-delete-page-modal.tsx";
import { useTranslation } from "react-i18next";
import { modals } from "@mantine/modals";
import ExportModal from "@/components/common/export-modal";
import BulkExportModal from "@/components/common/bulk-export-modal";
import BulkMovePageModal from "../../components/bulk-move-page-modal.tsx";
import MovePageModal from "../../components/move-page-modal.tsx";
import { mobileSidebarAtom } from "@/components/layouts/global/hooks/atoms/sidebar-atom.ts";
import { useToggleSidebar } from "@/components/layouts/global/hooks/hooks/use-toggle-sidebar.ts";
import CopyPageModal from "../../components/copy-page-modal.tsx";
import { duplicatePage } from "../../services/page-service.ts";
import { useFavoriteIds, useAddFavoriteMutation, useRemoveFavoriteMutation } from "@/features/favorite/queries/favorite-query";

interface SpaceTreeProps {
  spaceId: string;
  readOnly: boolean;
  onSelectionStateChange?: (state: {
    selectionMode: boolean;
    selectedCount: number;
    selectedIds: string[];
    clearSelection: () => void;
    toggleSelectionMode: () => void;
    selectAllVisible: () => void;
    deleteSelected: () => void;
    exportSelected: () => void;
    openMoveSelected: () => void;
  }) => void;
}

const STORAGE_KEY_PREFIX = "docmost:tree-open:";

function loadOpenState(spaceId: string): OpenMap {
  try {
    const stored = localStorage.getItem(STORAGE_KEY_PREFIX + spaceId);
    return stored ? JSON.parse(stored) : {};
  } catch {
    return {};
  }
}

function saveOpenState(spaceId: string, openState: OpenMap | undefined): void {
  if (!openState) return;
  try {
    localStorage.setItem(
      STORAGE_KEY_PREFIX + spaceId,
      JSON.stringify(openState),
    );
  } catch {
    // localStorage full or unavailable
  }
}

const openTreeNodesAtom = atom<OpenMap>({});

export default function SpaceTree({
  spaceId,
  readOnly,
  onSelectionStateChange,
}: SpaceTreeProps) {
  const { t } = useTranslation();
  const { pageSlug, spaceSlug } = useParams();
  const { data, setData, controllers } =
    useTreeMutation<SpaceTreeNode>(spaceId);
  const {
    data: pagesData,
    hasNextPage,
    fetchNextPage,
    isFetching,
  } = useGetRootSidebarPagesQuery({
    spaceId,
  });
  const [, setTreeApi] = useAtom<TreeApi<SpaceTreeNode>>(treeApiAtom);
  const treeApiRef = useRef<TreeApi<SpaceTreeNode>>();
  const [openTreeNodes, setOpenTreeNodes] = useAtom<OpenMap>(openTreeNodesAtom);
  const [, appendChildren] = useAtom(appendNodeChildrenAtom);
  const treeElement = useRef<HTMLDivElement>();
  const [isRootReady, setIsRootReady] = useState(false);
  const { ref: sizeRef, width, height } = useElementSize();
  const mergedRef = useMergedRef((element) => {
    treeElement.current = element;
    if (element && !isRootReady) {
      setIsRootReady(true);
    }
  }, sizeRef);
  const [isDataLoaded, setIsDataLoaded] = useState(false);
  const [selectionMode, setSelectionMode] = useState(false);
  const [selectedCount, setSelectedCount] = useState(0);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const selectionModeRef = useRef(selectionMode);
  selectionModeRef.current = selectionMode;
  const spaceIdRef = useRef(spaceId);
  spaceIdRef.current = spaceId;
  const removePageMutation = useRemovePageMutation();
  const { openDeleteModal: openBulkDeleteModal } = useDeletePageModal();
  const [bulkExportOpened, { open: openBulkExport, close: closeBulkExport }] =
    useDisclosure(false);
  const [bulkMoveOpened, { open: openBulkMove, close: closeBulkMove }] =
    useDisclosure(false);
  const { data: currentPage } = usePageQuery({
    pageId: extractPageSlugId(pageSlug),
  });

  useEffect(() => {
    setIsDataLoaded(false);
  }, [spaceId]);

  useEffect(() => {
    if (hasNextPage && !isFetching) {
      fetchNextPage();
    }
  }, [hasNextPage, fetchNextPage, isFetching, spaceId]);

  const pagesCount = pagesData?.pages?.length ?? 0;
  useEffect(() => {
    if (pagesData?.pages && !hasNextPage) {
      const allItems = pagesData.pages.flatMap((page) => page.items);
      const flatNodes = buildTree(allItems);
      const treeData = buildTreeWithChildren(flatNodes);

      setData((prev) => {
        // fresh space; full reset
        if (prev.length === 0 || prev[0]?.spaceId !== spaceId) {
          setIsDataLoaded(true);
          setOpenTreeNodes({});
          return treeData;
        }

        // same space; append only missing roots
        setIsDataLoaded(true);
        const merged = mergeRootTrees(prev, treeData);
        return merged;
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pagesCount, hasNextPage, spaceId]);

  // Restore persisted open state after tree data loads
  const hasRestoredOpenState = useRef(false);
  useEffect(() => {
    // Reset restore flag when switching spaces
    hasRestoredOpenState.current = false;
  }, [spaceId]);

  useEffect(() => {
    if (!isDataLoaded || hasRestoredOpenState.current) return;
    const api = treeApiRef.current;
    if (!api) return;

    hasRestoredOpenState.current = true;
    const saved = loadOpenState(spaceId);
    const nodeIds = Object.keys(saved).filter((id) => saved[id]);
    if (nodeIds.length === 0) return;

    for (const id of nodeIds) {
      const node = api.get(id);
      if (!node) continue;
      api.open(id);
      if (node.data.hasChildren) {
        fetchAllAncestorChildren({
          pageId: node.data.id,
          spaceId: node.data.spaceId,
        })
          .then((childrenTree) => {
            appendChildren({
              parentId: node.data.id,
              children: childrenTree,
            });
          })
          .catch((error) => {
            console.error("Failed to restore expanded node children:", error);
          });
      }
    }
    setOpenTreeNodes(api.openState);
  }, [isDataLoaded, spaceId, appendChildren, setOpenTreeNodes]);

  // Select and reveal current page in tree (all data already loaded)
  useEffect(() => {
    let selectTimer: ReturnType<typeof setTimeout>;

    if (isDataLoaded && currentPage?.id) {
      selectTimer = setTimeout(() => {
        treeApiRef.current?.select(currentPage.id);
      }, 100);
    }

    return () => {
      clearTimeout(selectTimer);
    };
  }, [isDataLoaded, currentPage?.id]);

  // Auto-expand current page to show its children
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>;

    if (isDataLoaded && currentPage?.id) {
      timer = setTimeout(() => {
        const node = treeApiRef.current?.get(currentPage.id);
        if (node && node.data.hasChildren && node.isClosed) {
          node.open();
        }
      }, 200);
    } else if (!currentPage?.id) {
      treeApiRef.current?.deselectAll();
    }

    return () => {
      clearTimeout(timer);
    };
  }, [isDataLoaded, currentPage?.id]);

  // Clean up tree API on unmount
  useEffect(() => {
    return () => {
      // @ts-ignore
      setTreeApi(null);
    };
  }, [setTreeApi]);

  const filteredData = data.filter((node) => node?.spaceId === spaceId);

  const refreshSelectedIds = useCallback(() => {
    const api = treeApiRef.current;
    if (!api) return;
    const ids = Array.from(api.selectedIds);
    setSelectedIds(ids);
    setSelectedCount(ids.length);
  }, []);

  const clearSelectionMode = useCallback(() => {
    treeApiRef.current?.deselectAll();
    setSelectedIds([]);
    setSelectedCount(0);
    setSelectionMode(false);
  }, []);

  const toggleSelectionMode = useCallback(() => {
    if (selectionMode) {
      clearSelectionMode();
    } else {
      setSelectionMode(true);
    }
  }, [clearSelectionMode, selectionMode]);

  const selectAllVisible = useCallback(() => {
    const api = treeApiRef.current;
    if (!api) return;
    setSelectionMode(true);
    api.selectAll();
    refreshSelectedIds();
  }, [refreshSelectedIds]);

  const deleteSelected = useCallback(() => {
    const ids = Array.from(treeApiRef.current?.selectedIds ?? []);
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
          notifications.show({
            message: t("Pages moved to trash"),
          });
        }
        clearSelectionMode();
      },
    });
  }, [clearSelectionMode, openBulkDeleteModal, removePageMutation, t]);

  const exportSelected = useCallback(() => {
    if (treeApiRef.current?.selectedIds.size === 0) return;
    openBulkExport();
  }, [openBulkExport]);

  const openMoveSelected = useCallback(() => {
    if (treeApiRef.current?.selectedIds.size === 0) return;
    openBulkMove();
  }, [openBulkMove]);

  // Keep latest callbacks in a ref so we can push selection changes without
  // depending on the callback identities (which would re-fire this effect on
  // every render and risk infinite update loops via the parent's setState).
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
      selectedCount,
      selectedIds,
      clearSelection: cb.clearSelectionMode,
      toggleSelectionMode: cb.toggleSelectionMode,
      selectAllVisible: cb.selectAllVisible,
      deleteSelected: cb.deleteSelected,
      exportSelected: cb.exportSelected,
      openMoveSelected: cb.openMoveSelected,
    });
  }, [selectionMode, selectedCount, selectedIds, onSelectionStateChange]);

  // Suppress the native long-press context menu on touch devices at the
  // capture phase so the browser's anchor menu (Open / Copy link / Share)
  // never appears for tree links.
  useEffect(() => {
    const el = treeElement.current;
    if (!el) return;
    const onCtx = (e: Event) => {
      e.preventDefault();
    };
    el.addEventListener("contextmenu", onCtx, { capture: true });
    return () => {
      el.removeEventListener("contextmenu", onCtx, { capture: true } as any);
    };
  }, [isRootReady]);

  // Keyboard shortcuts: Esc clears selection, Ctrl/Meta+A selects all visible,
  // Delete triggers bulk delete (only when selection mode is active).
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      // Skip if focus is in an input/textarea/contenteditable
      const target = e.target as HTMLElement | null;
      if (
        target &&
        (target.tagName === "INPUT" ||
          target.tagName === "TEXTAREA" ||
          target.isContentEditable)
      ) {
        return;
      }
      if (e.key === "Escape" && selectionModeRef.current) {
        e.preventDefault();
        clearSelectionMode();
        return;
      }
      if (
        (e.ctrlKey || e.metaKey) &&
        e.key.toLowerCase() === "a" &&
        selectionModeRef.current
      ) {
        e.preventDefault();
        selectAllVisible();
        return;
      }
      if (
        (e.key === "Delete" || e.key === "Backspace") &&
        selectionModeRef.current &&
        (treeApiRef.current?.selectedIds.size ?? 0) > 0
      ) {
        e.preventDefault();
        deleteSelected();
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [clearSelectionMode, selectAllVisible, deleteSelected]);

  return (
    <div className={classes.treeContainer}>
      {isDataLoaded && filteredData.length === 0 && (
        <Text size="xs" c="dimmed" py="xs" px="sm">
          {t("No pages yet")}
        </Text>
      )}
      <div ref={mergedRef} className={classes.treeViewport}>
        {isRootReady && treeElement.current && height > 0 && (
          <Tree
            data={filteredData}
            disableDrag={
              readOnly
                ? true
                : (data) => {
                    return data.canEdit === false;
                  }
            }
            disableDrop={
              readOnly
                ? true
                : ({ parentNode }) => parentNode?.data?.canEdit === false
            }
            disableEdit={readOnly ? true : (data) => data.canEdit === false}
            {...controllers}
            width={width}
            height={height}
            ref={(ref) => {
              treeApiRef.current = ref;
              if (ref) {
                //@ts-ignore
                setTreeApi(ref);
              }
            }}
            openByDefault={false}
            disableMultiSelection={false}
            className={classes.tree}
            rowClassName={classes.row}
            rowHeight={30}
            paddingBottom={80}
            overscanCount={10}
            dndRootElement={treeElement.current}
            onToggle={() => {
              const openState = treeApiRef.current?.openState;
              setOpenTreeNodes(openState);
              saveOpenState(spaceId, openState);
            }}
            initialOpenState={openTreeNodes}
          >
            {(props) => (
              <Node
                {...props}
                selectionMode={selectionMode}
                onEnterSelectionMode={() => setSelectionMode(true)}
                onSelectionChange={refreshSelectedIds}
              />
            )}
          </Tree>
        )}
      </div>

      <BulkExportModal
        pageIds={selectedIds}
        open={bulkExportOpened}
        onClose={closeBulkExport}
      />

      <BulkMovePageModal
        pageIds={selectedIds}
        currentSpaceSlug={spaceSlug}
        open={bulkMoveOpened}
        onClose={closeBulkMove}
        onMoved={clearSelectionMode}
      />
    </div>
  );
}

function Node({
  node,
  style,
  dragHandle,
  tree,
  selectionMode,
  onEnterSelectionMode,
  onSelectionChange,
}: NodeRendererProps<any> & {
  selectionMode?: boolean;
  onEnterSelectionMode?: () => void;
  onSelectionChange?: () => void;
}) {
  const { t } = useTranslation();
  const [, appendChildren] = useAtom(appendNodeChildrenAtom);
  const { spaceSlug } = useParams();
  const timerRef = useRef(null);
  const [mobileSidebarOpened] = useAtom(mobileSidebarAtom);
  const toggleMobileSidebar = useToggleSidebar(mobileSidebarAtom);
  const longPressTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const touchMovedRef = useRef(false);
  const longPressActivatedRef = useRef(false);
  const touchStartPosRef = useRef<{ x: number; y: number } | null>(null);

  const prefetchPage = () => {
    timerRef.current = setTimeout(async () => {
      const page = await queryClient.fetchQuery({
        queryKey: ["pages", node.data.id],
        queryFn: () => getPageById({ pageId: node.data.id }),
        staleTime: 5 * 60 * 1000,
      });
      if (page?.slugId) {
        queryClient.setQueryData(["pages", page.slugId], page);
      }
    }, 150);
  };

  const cancelPagePrefetch = () => {
    if (timerRef.current) {
      window.clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  };

  async function handleLoadChildren(node: NodeApi<SpaceTreeNode>) {
    if (!node.data.hasChildren) return;
    // Skip if children already loaded (from full tree data)
    if (node.children?.length > 0) return;
    // Skip loading during move operations to prevent stale server data
    // from overwriting optimistic tree updates
    if (isTreeMoveInProgress()) return;

    try {
      const params: SidebarPagesParams = {
        pageId: node.data.id,
        spaceId: node.data.spaceId,
      };

      const childrenTree = await fetchAllAncestorChildren(params);

      // Re-check after await: a move may have started while we were fetching
      if (isTreeMoveInProgress()) return;

      appendChildren({
        parentId: node.data.id,
        children: childrenTree,
      });
    } catch (error) {
      console.error("Failed to fetch children:", error);
    }
  }

  if (
    node.willReceiveDrop &&
    node.isClosed &&
    (node.children.length > 0 || node.data.hasChildren)
  ) {
    handleLoadChildren(node);
    setTimeout(() => {
      if (node.state.willReceiveDrop) {
        node.open();
      }
    }, 650);
  }

  const pageUrl = buildPageUrl(spaceSlug, node.data.slugId, node.data.name);

  // Walk all loaded descendants of a node (children may be null for leaves
  // or empty arrays for unloaded subtrees). We can only act on what's loaded.
  const collectDescendantIds = (
    n: NodeApi<SpaceTreeNode>,
    acc: string[] = [],
  ): string[] => {
    const kids = n.children;
    if (kids && kids.length > 0) {
      for (const c of kids) {
        acc.push(c.id);
        collectDescendantIds(c, acc);
      }
    }
    return acc;
  };

  // Select the node itself plus all of its loaded descendants.
  // If there are unloaded children (hasChildren but no loaded kids),
  // we still mark the node selected — bulk operations on the server side
  // will respect subtrees via includeSubpages where applicable.
  const selectNodeWithDescendants = () => {
    const api = tree;
    const ids = [node.id, ...collectDescendantIds(node)];
    const current = new Set(api.selectedIds);
    for (const id of ids) current.add(id);
    api.setSelection({
      ids: Array.from(current),
      anchor: node.id,
      mostRecent: node.id,
    });
  };

  const deselectNodeWithDescendants = () => {
    const api = tree;
    const ids = new Set([node.id, ...collectDescendantIds(node)]);
    const remaining = Array.from(api.selectedIds).filter((id) => !ids.has(id));
    api.setSelection({
      ids: remaining,
      anchor: remaining[remaining.length - 1] ?? null,
      mostRecent: remaining[remaining.length - 1] ?? null,
    });
  };

  const toggleNodeSelection = () => {
    if (node.isSelected) {
      deselectNodeWithDescendants();
    } else {
      selectNodeWithDescendants();
    }
    onSelectionChange?.();
  };

  // Contiguous range that crosses collapsed levels: walk the underlying
  // tree (data) in DFS order between anchor and target, collecting every id.
  const selectRangeAcrossLevels = (targetNode: NodeApi<SpaceTreeNode>) => {
    const api = tree;
    const anchorId =
      (api as any).state?.nodes?.selection?.anchor ?? targetNode.id;
    if (anchorId === targetNode.id) {
      // No anchor: just select target + descendants
      selectNodeWithDescendants();
      return;
    }
    // Build a flat DFS list of ALL loaded nodes in tree order.
    const flat: string[] = [];
    const walk = (nodes: NodeApi<SpaceTreeNode>[] | null) => {
      if (!nodes) return;
      for (const n of nodes) {
        flat.push(n.id);
        walk(n.children);
      }
    };
    walk(api.root.children);
    const i1 = flat.indexOf(anchorId);
    const i2 = flat.indexOf(targetNode.id);
    if (i1 === -1 || i2 === -1) {
      selectNodeWithDescendants();
      return;
    }
    const [lo, hi] = i1 <= i2 ? [i1, i2] : [i2, i1];
    const rangeIds = flat.slice(lo, hi + 1);
    const current = new Set(api.selectedIds);
    for (const id of rangeIds) current.add(id);
    api.setSelection({
      ids: Array.from(current),
      anchor: anchorId,
      mostRecent: targetNode.id,
    });
  };

  const clearLongPressTimer = () => {
    if (longPressTimerRef.current) {
      window.clearTimeout(longPressTimerRef.current);
      longPressTimerRef.current = null;
    }
  };

  return (
    <>
      <Box
        style={style}
        className={clsx(classes.node, node.state)}
        component={Link}
        to={pageUrl}
        // @ts-ignore
        ref={dragHandle}
        onClick={(e) => {
          if (longPressActivatedRef.current) {
            e.preventDefault();
            longPressActivatedRef.current = false;
            return;
          }

          if (selectionMode) {
            e.preventDefault();
            // Stop propagation: react-arborist's row onClick would otherwise
            // call node.handleClick → node.select() and replace our multi-selection.
            e.stopPropagation();
            if (e.shiftKey) {
              selectRangeAcrossLevels(node);
              onSelectionChange?.();
            } else if (e.ctrlKey || e.metaKey) {
              // Ctrl/Cmd+Click in selection mode: toggle ONLY this node
              if (node.isSelected) node.deselect();
              else node.selectMulti();
              onSelectionChange?.();
            } else {
              // Plain click in selection mode: toggle node + descendants
              toggleNodeSelection();
            }
            return;
          }

          // Ctrl/Cmd+Click: enter selection mode, toggle ONLY this node
          if (e.ctrlKey || e.metaKey) {
            e.preventDefault();
            e.stopPropagation();
            onEnterSelectionMode?.();
            if (node.isSelected) node.deselect();
            else node.selectMulti();
            onSelectionChange?.();
            return;
          }
          // Shift+Click: enter selection mode, select contiguous range across levels
          if (e.shiftKey) {
            e.preventDefault();
            e.stopPropagation();
            onEnterSelectionMode?.();
            selectRangeAcrossLevels(node);
            onSelectionChange?.();
            return;
          }
          if (mobileSidebarOpened) {
            toggleMobileSidebar();
          }
        }}
        onContextMenu={(e) => {
          // Always prevent native context menu (long-press on Android, right-click on desktop)
          e.preventDefault();
          e.stopPropagation();
          // If a touch long-press already handled selection, don't double-toggle
          if (longPressActivatedRef.current) {
            return;
          }
          if (!selectionMode) {
            // Just enter selection mode, do NOT auto-select the right-clicked node
            onEnterSelectionMode?.();
            return;
          }
          toggleNodeSelection();
        }}
        onTouchStart={(e) => {
          touchMovedRef.current = false;
          longPressActivatedRef.current = false;
          clearLongPressTimer();
          // Track initial touch position to differentiate scroll from press
          const touch = e.touches[0];
          touchStartPosRef.current = touch
            ? { x: touch.clientX, y: touch.clientY }
            : null;
          longPressTimerRef.current = setTimeout(() => {
            longPressActivatedRef.current = true;
            // Provide haptic feedback if available
            try {
              (navigator as any).vibrate?.(10);
            } catch {}
            // Long-press: only enter selection mode; do NOT auto-select the
            // pressed node (user explicitly asked for this behavior).
            onEnterSelectionMode?.();
          }, 500);
        }}
        onTouchMove={(e) => {
          // Only cancel long-press if the finger moves beyond a small threshold,
          // to avoid accidental cancellations from minor jitter.
          const start = touchStartPosRef.current;
          const touch = e.touches[0];
          if (!start || !touch) {
            touchMovedRef.current = true;
            clearLongPressTimer();
            return;
          }
          const dx = touch.clientX - start.x;
          const dy = touch.clientY - start.y;
          if (dx * dx + dy * dy > 100 /* 10px */) {
            touchMovedRef.current = true;
            clearLongPressTimer();
          }
        }}
        onTouchEnd={(e) => {
          clearLongPressTimer();
          // Only prevent the synthesized click after a long-press (to suppress
          // accidental navigation). In selection mode we WANT click to fire so
          // taps can toggle selection.
          if (longPressActivatedRef.current && !touchMovedRef.current) {
            e.preventDefault();
          }
        }}
        onTouchCancel={clearLongPressTimer}
        onMouseEnter={prefetchPage}
        onMouseLeave={cancelPagePrefetch}
      >
        {selectionMode && (() => {
          // Determine indeterminate state: node is NOT selected itself but
          // has at least one selected loaded descendant; OR node IS selected
          // but at least one loaded descendant is NOT selected.
          const descendants = collectDescendantIds(node);
          let selectedCount = 0;
          for (const id of descendants) {
            if (tree.isSelected(id)) selectedCount++;
          }
          const allDescSelected =
            descendants.length === 0 || selectedCount === descendants.length;
          const someDescSelected = selectedCount > 0;
          const isIndeterminate = node.isSelected
            ? !allDescSelected
            : someDescSelected;

          return (
            <span
              className={classes.selectionCheckbox}
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                toggleNodeSelection();
              }}
              aria-hidden
            >
              {isIndeterminate ? (
                <IconSquareMinusFilled
                  size={16}
                  style={{ color: "var(--mantine-primary-color-filled)" }}
                />
              ) : node.isSelected ? (
                <IconSquareCheckFilled
                  size={16}
                  style={{ color: "var(--mantine-primary-color-filled)" }}
                />
              ) : (
                <IconSquare size={16} style={{ opacity: 0.5 }} />
              )}
            </span>
          );
        })()}

        <PageArrow node={node} onExpandTree={() => handleLoadChildren(node)} />

        <span className={classes.text}>{node.data.name || t("untitled")}</span>

        {!selectionMode && (
          <div className={classes.actions}>
            <NodeMenu node={node} treeApi={tree} spaceId={node.data.spaceId} />

            {tree.props.disableEdit !== true && node.data.canEdit !== false && (
              <CreateNode
                node={node}
                treeApi={tree}
                onExpandTree={() => handleLoadChildren(node)}
              />
            )}
          </div>
        )}
      </Box>
    </>
  );
}

interface CreateNodeProps {
  node: NodeApi<SpaceTreeNode>;
  treeApi: TreeApi<SpaceTreeNode>;
  onExpandTree?: () => void;
}

function CreateNode({ node, treeApi, onExpandTree }: CreateNodeProps) {
  function handleCreate() {
    if (node.data.hasChildren && node.children.length === 0) {
      node.toggle();
      onExpandTree();

      setTimeout(() => {
        treeApi?.create({ type: "internal", parentId: node.id, index: 0 });
      }, 500);
    } else {
      treeApi?.create({ type: "internal", parentId: node.id });
    }
  }

  return (
    <ActionIcon
      variant="transparent"
      c="gray"
      onClick={(e) => {
        e.preventDefault();
        e.stopPropagation();
        handleCreate();
      }}
    >
      <IconPlus style={{ width: rem(20), height: rem(20) }} stroke={2} />
    </ActionIcon>
  );
}

interface NodeMenuProps {
  node: NodeApi<SpaceTreeNode>;
  treeApi: TreeApi<SpaceTreeNode>;
  spaceId: string;
}

function NodeMenu({ node, treeApi, spaceId }: NodeMenuProps) {
  const { t } = useTranslation();
  const clipboard = useClipboard({ timeout: 500 });
  const { spaceSlug } = useParams();
  const { openDeleteModal } = useDeletePageModal();
  const [data, setData] = useAtom(treeDataAtom);
  const emit = useQueryEmit();
  const [exportOpened, { open: openExportModal, close: closeExportModal }] =
    useDisclosure(false);
  const [
    movePageModalOpened,
    { open: openMovePageModal, close: closeMoveSpaceModal },
  ] = useDisclosure(false);
  const [
    copyPageModalOpened,
    { open: openCopyPageModal, close: closeCopySpaceModal },
  ] = useDisclosure(false);
  const favoriteIds = useFavoriteIds("page", spaceId);
  const addFavorite = useAddFavoriteMutation();
  const removeFavorite = useRemoveFavoriteMutation();
  const isFavorited = favoriteIds.has(node.data.id);

  const handleCopyLink = () => {
    const pageUrl =
      getAppUrl() + buildPageUrl(spaceSlug, node.data.slugId, node.data.name);
    clipboard.copy(pageUrl);
    notifications.show({ message: t("Link copied") });
  };

  const handleDuplicatePage = async () => {
    try {
      const duplicatedPage = await duplicatePage({
        pageId: node.id,
      });

      // Find the index of the current node
      const parentId =
        node.parent?.id === "__REACT_ARBORIST_INTERNAL_ROOT__"
          ? null
          : node.parent?.id;
      const siblings = parentId ? node.parent.children : treeApi?.props.data;
      const currentIndex =
        siblings?.findIndex((sibling) => sibling.id === node.id) || 0;
      const newIndex = currentIndex + 1;

      // Add the duplicated page to the tree
      const treeNodeData: SpaceTreeNode = {
        id: duplicatedPage.id,
        slugId: duplicatedPage.slugId,
        name: duplicatedPage.title,
        position: duplicatedPage.position,
        spaceId: duplicatedPage.spaceId,
        parentPageId: duplicatedPage.parentPageId,
        icon: duplicatedPage.icon,
        hasChildren: duplicatedPage.hasChildren,
        canEdit: true,
        children: [],
      };

      // Update local tree
      const simpleTree = new SimpleTree(data);
      simpleTree.create({
        parentId,
        index: newIndex,
        data: treeNodeData,
      });
      setData(simpleTree.data);

      // Emit socket event
      setTimeout(() => {
        emit({
          operation: "addTreeNode",
          spaceId: spaceId,
          payload: {
            parentId,
            index: newIndex,
            data: treeNodeData,
          },
        });
      }, 50);

      notifications.show({
        message: t("Page duplicated successfully"),
      });
    } catch (err) {
      notifications.show({
        message: err.response?.data.message || "An error occurred",
        color: "red",
      });
    }
  };

  return (
    <>
      <Menu shadow="md" width={200}>
        <Menu.Target>
          <ActionIcon
            variant="transparent"
            c="gray"
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
            }}
          >
            <IconDotsVertical
              style={{ width: rem(20), height: rem(20) }}
              stroke={2}
            />
          </ActionIcon>
        </Menu.Target>

        <Menu.Dropdown>
          <Menu.Item
            leftSection={<IconLink size={16} />}
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              handleCopyLink();
            }}
          >
            {t("Copy link")}
          </Menu.Item>

          <Menu.Item
            leftSection={isFavorited ? <IconStarFilled size={16} /> : <IconStar size={16} />}
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              if (isFavorited) {
                removeFavorite.mutate({ type: "page", pageId: node.data.id });
              } else {
                addFavorite.mutate({ type: "page", pageId: node.data.id });
              }
            }}
          >
            {isFavorited ? t("Remove from favorites") : t("Add to favorites")}
          </Menu.Item>

          <Menu.Item
            leftSection={<IconFileExport size={16} />}
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              openExportModal();
            }}
          >
            {t("Export page")}
          </Menu.Item>

          {treeApi.props.disableEdit !== true &&
            node.data.canEdit !== false && (
              <>
                <Menu.Item
                  leftSection={<IconCopy size={16} />}
                  onClick={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    handleDuplicatePage();
                  }}
                >
                  {t("Duplicate")}
                </Menu.Item>

                <Menu.Item
                  leftSection={<IconArrowRight size={16} />}
                  onClick={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    openMovePageModal();
                  }}
                >
                  {t("Move")}
                </Menu.Item>

                <Menu.Item
                  leftSection={<IconCopy size={16} />}
                  onClick={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    openCopyPageModal();
                  }}
                >
                  {t("Copy to space")}
                </Menu.Item>

                <Menu.Divider />
                <Menu.Item
                  c="red"
                  leftSection={<IconTrash size={16} />}
                  onClick={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    openDeleteModal({ onConfirm: () => treeApi?.delete(node) });
                  }}
                >
                  {t("Move to trash")}
                </Menu.Item>
              </>
            )}
        </Menu.Dropdown>
      </Menu>

      <MovePageModal
        pageId={node.id}
        slugId={node.data.slugId}
        currentSpaceSlug={spaceSlug}
        onClose={closeMoveSpaceModal}
        open={movePageModalOpened}
      />

      <CopyPageModal
        pageId={node.id}
        currentSpaceSlug={spaceSlug}
        onClose={closeCopySpaceModal}
        open={copyPageModalOpened}
      />

      <ExportModal
        type="page"
        id={node.id}
        open={exportOpened}
        onClose={closeExportModal}
      />
    </>
  );
}

interface PageArrowProps {
  node: NodeApi<SpaceTreeNode>;
  onExpandTree?: () => void;
}

function PageArrow({ node, onExpandTree }: PageArrowProps) {
  useEffect(() => {
    if (node.isOpen) {
      onExpandTree();
    }
  }, []);

  return (
    <ActionIcon
      size={20}
      variant="subtle"
      c="gray"
      onClick={(e) => {
        e.preventDefault();
        e.stopPropagation();
        node.toggle();
        onExpandTree();
      }}
    >
      {node.isInternal ? (
        node.children && (node.children.length > 0 || node.data.hasChildren) ? (
          node.isOpen ? (
            <IconChevronDown stroke={2} size={18} />
          ) : (
            <IconChevronRight stroke={2} size={18} />
          )
        ) : (
          <IconPointFilled size={8} />
        )
      ) : null}
    </ActionIcon>
  );
}
