import { ActionIcon, Box, Group, Menu, Slider, Text, Tooltip } from "@mantine/core";
import {
  IconArrowRight,
  IconArrowsHorizontal,
  IconAlignLeft,
  IconAlignCenter,
  IconDots,
  IconEye,
  IconEyeOff,
  IconFileExport,
  IconLetterCase,
  IconMinus,
  IconHistory,
  IconPlus,
  IconUsers,
  IconLink,
  IconList,
  IconMarkdown,
  IconMessage,
  IconPrinter,
  IconSearch,
  IconStar,
  IconStarFilled,
  IconTrash,
  IconWifiOff,
} from "@tabler/icons-react";
import React, { useEffect, useRef, useState } from "react";
import useToggleAside from "@/hooks/use-toggle-aside.tsx";
import { useAtom, useAtomValue } from "jotai";
import { historyAtoms } from "@/features/page-history/atoms/history-atoms.ts";
import { visitorsModalAtom } from "@/features/page-visitors/atoms/visitors-atoms.ts";
import { useDisclosure, useHotkeys } from "@mantine/hooks";
import { useClipboard } from "@/hooks/use-clipboard";
import { useParams } from "react-router-dom";
import { usePageQuery } from "@/features/page/queries/page-query.ts";
import { buildPageUrl } from "@/features/page/page.utils.ts";
import { notifications } from "@mantine/notifications";
import { getAppUrl } from "@/lib/config.ts";
import { extractPageSlugId } from "@/lib";
import { treeApiAtom } from "@/features/page/tree/atoms/tree-api-atom.ts";
import { useDeletePageModal } from "@/features/page/hooks/use-delete-page-modal.tsx";
import { PageWidthToggle } from "@/features/user/components/page-width-pref.tsx";
import {
  pageMaxWidthAtom,
  pageAlignAtom,
  pageFontScaleAtom,
  PAGE_FONT_SCALE_DEFAULT,
  PAGE_FONT_SCALE_MAX,
  PAGE_FONT_SCALE_MIN,
  PAGE_WIDTH_MAX,
  PAGE_WIDTH_MIN,
} from "@/features/user/atoms/page-width-atom.ts";
import { Trans, useTranslation } from "react-i18next";
import ExportModal from "@/components/common/export-modal";
import { htmlToMarkdown } from "@docmost/editor-ext";
import {
  pageEditorAtom,
  yjsConnectionStatusAtom,
} from "@/features/editor/atoms/editor-atoms.ts";
import { formattedDate } from "@/lib/time.ts";
import { PageEditModeToggle } from "@/features/user/components/page-state-pref.tsx";
import MovePageModal from "@/features/page/components/move-page-modal.tsx";
import { useTimeAgo } from "@/hooks/use-time-ago.tsx";
import { PageShareModal } from "@/ee/page-permission";
import {
  PageVerificationMenuItem,
  PageVerificationModal,
} from "@/ee/page-verification";
import {
  useFavoriteIds,
  useAddFavoriteMutation,
  useRemoveFavoriteMutation,
} from "@/features/favorite/queries/favorite-query";
import {
  useWatchStatusQuery,
  useWatchPageMutation,
  useUnwatchPageMutation,
} from "@/features/page/queries/watcher-query";
import useUserRole from "@/hooks/use-user-role";

interface PageHeaderMenuProps {
  readOnly?: boolean;
}
export default function PageHeaderMenu({ readOnly }: PageHeaderMenuProps) {
  const { t } = useTranslation();
  const toggleAside = useToggleAside();
  const [pageAlign, setPageAlign] = useAtom(pageAlignAtom);

  useHotkeys(
    [
      [
        "mod+F",
        () => {
          const event = new CustomEvent("openFindDialogFromEditor", {});
          document.dispatchEvent(event);
        },
      ],
      [
        "Escape",
        () => {
          const event = new CustomEvent("closeFindDialogFromEditor", {});
          document.dispatchEvent(event);
        },
        { preventDefault: false },
      ],
    ],
    [],
  );

  return (
    <>
      <ConnectionWarning />

      {!readOnly && <PageEditModeToggle size="xs" />}

      <PageShareModal readOnly={readOnly} />

      <Tooltip label={t("Comments")} openDelay={250} withArrow>
        <ActionIcon
          variant="subtle"
          color="dark"
          onClick={() => toggleAside("comments")}
        >
          <IconMessage size={20} stroke={2} />
        </ActionIcon>
      </Tooltip>

      <Tooltip label={t("Table of contents")} openDelay={250} withArrow>
        <ActionIcon
          variant="subtle"
          color="dark"
          onClick={() => toggleAside("toc")}
        >
          <IconList size={20} stroke={2} />
        </ActionIcon>
      </Tooltip>

      <Tooltip
        label={pageAlign === "left" ? t("Center page") : t("Align page left")}
        openDelay={250}
        withArrow
      >
        <ActionIcon
          variant="subtle"
          color="dark"
          onClick={() =>
            setPageAlign(pageAlign === "left" ? "center" : "left")
          }
        >
          {pageAlign === "left" ? (
            <IconAlignCenter size={20} stroke={2} />
          ) : (
            <IconAlignLeft size={20} stroke={2} />
          )}
        </ActionIcon>
      </Tooltip>

      <PageActionMenu readOnly={readOnly} />
    </>
  );
}

interface PageActionMenuProps {
  readOnly?: boolean;
}
function PageActionMenu({ readOnly }: PageActionMenuProps) {
  const { t } = useTranslation();
  const [, setHistoryModalOpen] = useAtom(historyAtoms);
  const [, setVisitorsModalOpen] = useAtom(visitorsModalAtom);
  const clipboard = useClipboard({ timeout: 500 });
  const { pageSlug, spaceSlug } = useParams();
  const { data: page, isLoading } = usePageQuery({
    pageId: extractPageSlugId(pageSlug),
  });
  const { openDeleteModal } = useDeletePageModal();
  const [tree] = useAtom(treeApiAtom);
  const [exportOpened, { open: openExportModal, close: closeExportModal }] =
    useDisclosure(false);
  const [
    movePageModalOpened,
    { open: openMovePageModal, close: closeMoveSpaceModal },
  ] = useDisclosure(false);
  const [
    verificationOpened,
    { open: openVerificationModal, close: closeVerificationModal },
  ] = useDisclosure(false);
  const [pageEditor] = useAtom(pageEditorAtom);
  const [pageMaxWidth, setPageMaxWidth] = useAtom(pageMaxWidthAtom);
  const [pageFontScale, setPageFontScale] = useAtom(pageFontScaleAtom);
  const pageUpdatedAt = useTimeAgo(page?.updatedAt);
  const favoriteIds = useFavoriteIds("page", page?.spaceId);
  const addFavoriteMutation = useAddFavoriteMutation();
  const removeFavoriteMutation = useRemoveFavoriteMutation();
  const isFavorited = page?.id ? favoriteIds.has(page.id) : false;
  const { data: watchStatus } = useWatchStatusQuery(page?.id);
  const watchPage = useWatchPageMutation();
  const unwatchPage = useUnwatchPageMutation();

  const handleCopyLink = () => {
    const pageUrl =
      getAppUrl() + buildPageUrl(spaceSlug, page.slugId, page.title);

    clipboard.copy(pageUrl);
    notifications.show({ message: t("Link copied") });
  };

  const handleCopyAsMarkdown = () => {
    if (!pageEditor) return;
    const html = pageEditor.getHTML();
    const markdown = htmlToMarkdown(html);
    const title = page?.title ? `# ${page.title}\n\n` : "";
    clipboard.copy(`${title}${markdown}`);
    notifications.show({ message: t("Copied") });
  };

  const handlePrint = () => {
    setTimeout(() => {
      window.print();
    }, 250);
  };

  const openHistoryModal = () => {
    setHistoryModalOpen(true);
  };

  const handleDeletePage = () => {
    openDeleteModal({ onConfirm: () => tree?.delete(page.id) });
  };

  const handleToggleFavorite = () => {
    if (!page?.id) return;
    const params = { type: "page" as const, pageId: page.id };
    if (isFavorited) {
      removeFavoriteMutation.mutate(params);
    } else {
      addFavoriteMutation.mutate(params);
    }
  };

  const changePageFontScale = (delta: number) => {
    setPageFontScale((value) =>
      Math.min(PAGE_FONT_SCALE_MAX, Math.max(PAGE_FONT_SCALE_MIN, value + delta)),
    );
  };

  return (
    <>
      <Menu
        shadow="xl"
        position="bottom-end"
        offset={20}
        width={230}
        withArrow
        arrowPosition="center"
      >
        <Menu.Target>
          <ActionIcon variant="subtle" color="dark">
            <IconDots size={20} />
          </ActionIcon>
        </Menu.Target>

        <Menu.Dropdown>
          <Menu.Item
            leftSection={<IconSearch size={16} />}
            onClick={() => {
              const event = new CustomEvent("openFindDialogFromEditor", {});
              document.dispatchEvent(event);
            }}
          >
            {t("Find in page")}
          </Menu.Item>

          <Menu.Item
            leftSection={<IconLink size={16} />}
            onClick={handleCopyLink}
          >
            {t("Copy link")}
          </Menu.Item>

          <Menu.Item
            leftSection={<IconMarkdown size={16} />}
            onClick={handleCopyAsMarkdown}
          >
            {t("Copy as Markdown")}
          </Menu.Item>

          <Menu.Item
            leftSection={
              isFavorited ? (
                <IconStarFilled size={16} color="var(--mantine-color-yellow-5)" />
              ) : (
                <IconStar size={16} />
              )
            }
            onClick={handleToggleFavorite}
          >
            {isFavorited ? t("Remove from favorites") : t("Add to favorites")}
          </Menu.Item>

          {watchStatus?.watching ? (
            <Menu.Item
              leftSection={<IconEyeOff size={16} />}
              onClick={() => unwatchPage.mutate(page.id)}
            >
              {t("Stop watching")}
            </Menu.Item>
          ) : (
            <Menu.Item
              leftSection={<IconEye size={16} />}
              onClick={() => watchPage.mutate(page.id)}
            >
              {t("Watch page")}
            </Menu.Item>
          )}

          <Menu.Divider />

          <Menu.Item leftSection={<IconArrowsHorizontal size={16} />}>
            <Group wrap="nowrap">
              <PageWidthToggle label={t("Full width")} />
            </Group>
          </Menu.Item>

          <Box px="sm" py={6} onClick={(e) => e.stopPropagation()}>
            <Text size="sm" mb={4}>
              {t("Page width")}: {pageMaxWidth}px
            </Text>
            <Slider
              min={PAGE_WIDTH_MIN}
              max={PAGE_WIDTH_MAX}
              step={50}
              value={pageMaxWidth}
              onChange={setPageMaxWidth}
              label={(v) => `${v}px`}
            />
          </Box>

          <Box px="sm" py={6} onClick={(e) => e.stopPropagation()}>
            <Group justify="space-between" wrap="nowrap" mb={6}>
              <Group gap={6} wrap="nowrap">
                <IconLetterCase size={16} />
                <Text size="sm">{t("Font size")}</Text>
              </Group>
              <Text size="sm" c="dimmed">
                {pageFontScale}%
              </Text>
            </Group>
            <Group gap="xs" wrap="nowrap">
              <ActionIcon
                variant="default"
                size="sm"
                onClick={() => changePageFontScale(-5)}
                disabled={pageFontScale <= PAGE_FONT_SCALE_MIN}
                aria-label={t("Decrease font size")}
              >
                <IconMinus size={14} />
              </ActionIcon>
              <Slider
                min={PAGE_FONT_SCALE_MIN}
                max={PAGE_FONT_SCALE_MAX}
                step={5}
                value={pageFontScale}
                onChange={setPageFontScale}
                label={(v) => `${v}%`}
                style={{ flex: 1 }}
              />
              <ActionIcon
                variant="default"
                size="sm"
                onClick={() => changePageFontScale(5)}
                disabled={pageFontScale >= PAGE_FONT_SCALE_MAX}
                aria-label={t("Increase font size")}
              >
                <IconPlus size={14} />
              </ActionIcon>
              <ActionIcon
                variant="subtle"
                size="sm"
                onClick={() => setPageFontScale(PAGE_FONT_SCALE_DEFAULT)}
                disabled={pageFontScale === PAGE_FONT_SCALE_DEFAULT}
                aria-label={t("Reset font size")}
              >
                <IconLetterCase size={14} />
              </ActionIcon>
            </Group>
          </Box>

          <Menu.Item
            leftSection={<IconHistory size={16} />}
            onClick={openHistoryModal}
          >
            {t("Page history")}
          </Menu.Item>

          <VisitorRecordsMenuItem
            onClick={() => setVisitorsModalOpen(true)}
          />

          {!readOnly && (
            <PageVerificationMenuItem
              pageId={page?.id}
              onClick={openVerificationModal}
            />
          )}

          <Menu.Divider />

          {!readOnly && (
            <Menu.Item
              leftSection={<IconArrowRight size={16} />}
              onClick={openMovePageModal}
            >
              {t("Move")}
            </Menu.Item>
          )}

          <Menu.Item
            leftSection={<IconFileExport size={16} />}
            onClick={openExportModal}
          >
            {t("Export")}
          </Menu.Item>

          <Menu.Item
            leftSection={<IconPrinter size={16} />}
            onClick={handlePrint}
          >
            {t("Print PDF")}
          </Menu.Item>

          {!readOnly && (
            <>
              <Menu.Divider />
              <Menu.Item
                color={"red"}
                leftSection={<IconTrash size={16} />}
                onClick={handleDeletePage}
              >
                {t("Move to trash")}
              </Menu.Item>
            </>
          )}

          <Menu.Divider />

          <>
            <Group px="sm" wrap="nowrap" style={{ cursor: "pointer" }}>
              <Tooltip
                label={t("Edited by {{name}} {{time}}", {
                  name: page.lastUpdatedBy.name,
                  time: pageUpdatedAt,
                })}
                position="left-start"
              >
                <div style={{ width: 210 }}>
                  <Text size="xs" c="dimmed" truncate="end">
                    {t("Word count: {{wordCount}}", {
                      wordCount: pageEditor?.storage?.characterCount?.words(),
                    })}
                  </Text>

                  <Text size="xs" c="dimmed" lineClamp={1}>
                    <Trans
                      defaults="Created by: <b>{{creatorName}}</b>"
                      values={{ creatorName: page?.creator?.name }}
                      components={{ b: <Text span fw={500} /> }}
                    />
                  </Text>
                  <Text size="xs" c="dimmed" truncate="end">
                    {t("Created at: {{time}}", {
                      time: formattedDate(page.createdAt),
                    })}
                  </Text>
                </div>
              </Tooltip>
            </Group>
          </>
        </Menu.Dropdown>
      </Menu>

      <ExportModal
        type="page"
        id={page.id}
        open={exportOpened}
        onClose={closeExportModal}
      />

      <MovePageModal
        pageId={page.id}
        slugId={page.slugId}
        currentSpaceSlug={spaceSlug}
        onClose={closeMoveSpaceModal}
        open={movePageModalOpened}
      />

      <PageVerificationModal
        pageId={page.id}
        opened={verificationOpened}
        onClose={closeVerificationModal}
      />
    </>
  );
}

interface VisitorRecordsMenuItemProps {
  onClick: () => void;
}
function VisitorRecordsMenuItem({ onClick }: VisitorRecordsMenuItemProps) {
  const { t } = useTranslation();
  const { isOwner } = useUserRole();
  if (!isOwner) return null;
  return (
    <Menu.Item leftSection={<IconUsers size={16} />} onClick={onClick}>
      {t("Visitor records")}
    </Menu.Item>
  );
}

function ConnectionWarning() {
  const { t } = useTranslation();
  const yjsConnectionStatus = useAtomValue(yjsConnectionStatusAtom);
  const [showWarning, setShowWarning] = useState(false);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const isDisconnected = ["disconnected", "connecting"].includes(
      yjsConnectionStatus,
    );

    if (isDisconnected) {
      if (!timeoutRef.current) {
        timeoutRef.current = setTimeout(() => setShowWarning(true), 5000);
      }
    } else {
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
        timeoutRef.current = null;
      }
      setShowWarning(false);
    }
  }, [yjsConnectionStatus]);

  // Cleanup only on unmount
  useEffect(() => {
    return () => {
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
      }
    };
  }, []);

  if (!showWarning) return null;

  return (
    <Tooltip
      label={t("Real-time editor connection lost. Retrying...")}
      openDelay={250}
      withArrow
    >
      <ActionIcon variant="default" c="red" style={{ border: "none" }}>
        <IconWifiOff size={20} stroke={2} />
      </ActionIcon>
    </Tooltip>
  );
}
