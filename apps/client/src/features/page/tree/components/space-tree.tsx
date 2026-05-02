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
  useUpdatePageMutation,
} from "@/features/page/queries/page-query.ts";
import { useEffect, useRef, useState } from "react";
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
  getPageById,
} from "@/features/page/services/page-service.ts";
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
import ExportModal from "@/components/common/export-modal";
import MovePageModal from "../../components/move-page-modal.tsx";
import { mobileSidebarAtom } from "@/components/layouts/global/hooks/atoms/sidebar-atom.ts";
import { useToggleSidebar } from "@/components/layouts/global/hooks/hooks/use-toggle-sidebar.ts";
import CopyPageModal from "../../components/copy-page-modal.tsx";
import { duplicatePage } from "../../services/page-service.ts";
import { useFavoriteIds, useAddFavoriteMutation, useRemoveFavoriteMutation } from "@/features/favorite/queries/favorite-query";

interface SpaceTreeProps {
  spaceId: string;
  readOnly: boolean;
  onMobileSelectionStateChange?: (state: {
    selectionMode: boolean;
    selectedCount: number;
    clearSelection: () => void;
    toggleSelectionMode: () => void;
    selectAllVisible: () => void;
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
  onMobileSelectionStateChange,
}: SpaceTreeProps) {
  const { t } = useTranslation();
  const { pageSlug } = useParams();
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
  const selectionModeRef = useRef(selectionMode);
  selectionModeRef.current = selectionMode;
  const spaceIdRef = useRef(spaceId);
  spaceIdRef.current = spaceId;
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

  const clearSelectionMode = () => {
    treeApiRef.current?.deselectAll();
    setSelectedCount(0);
    setSelectionMode(false);
  };

  const toggleSelectionMode = () => {
    if (selectionMode) {
      clearSelectionMode();
    } else {
      setSelectionMode(true);
    }
  };

  const selectAllVisible = () => {
    const api = treeApiRef.current;
    if (!api) return;
    api.setSelection({
      ids: api.visibleNodes.map((node) => node.id),
      anchor: api.visibleNodes[0]?.id ?? null,
      mostRecent: api.visibleNodes.at(-1)?.id ?? null,
    });
    setSelectedCount(api.selectedIds.size);
  };

  useEffect(() => {
    onMobileSelectionStateChange?.({
      selectionMode,
      selectedCount,
      clearSelection: clearSelectionMode,
      toggleSelectionMode,
      selectAllVisible,
    });
  }, [selectionMode, selectedCount, onMobileSelectionStateChange]);

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
                onSelectionChange={() =>
                  setSelectedCount(treeApiRef.current?.selectedIds.size ?? 0)
                }
              />
            )}
          </Tree>
        )}
      </div>
    </div>
  );
}

function Node({
  node,
  style,
  dragHandle,
  tree,
  selectionMode,
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

  const toggleNodeSelection = () => {
    if (node.isSelected) {
      node.deselect();
    } else {
      node.selectMulti();
    }
    onSelectionChange?.();
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
          if (selectionMode) {
            e.preventDefault();
            toggleNodeSelection();
            return;
          }

          // Prevent link navigation on multi-select (Ctrl/Meta/Shift+click)
          if (e.ctrlKey || e.metaKey || e.shiftKey) {
            e.preventDefault();
            return;
          }
          if (mobileSidebarOpened) {
            toggleMobileSidebar();
          }
        }}
        onContextMenu={(e) => {
          e.preventDefault();
          if (!selectionMode) return;
          toggleNodeSelection();
        }}
        onTouchStart={() => {
          touchMovedRef.current = false;
          clearLongPressTimer();
          longPressTimerRef.current = setTimeout(() => {
            onEnterSelectionMode?.();
            if (!node.isSelected) {
              node.selectMulti();
              onSelectionChange?.();
            }
          }, 450);
        }}
        onTouchMove={() => {
          touchMovedRef.current = true;
          clearLongPressTimer();
        }}
        onTouchEnd={(e) => {
          clearLongPressTimer();
          if (selectionMode && !touchMovedRef.current) {
            e.preventDefault();
          }
        }}
        onTouchCancel={clearLongPressTimer}
        onMouseEnter={prefetchPage}
        onMouseLeave={cancelPagePrefetch}
      >
        <PageArrow node={node} onExpandTree={() => handleLoadChildren(node)} />

        <span className={classes.text}>{node.data.name || t("untitled")}</span>

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
