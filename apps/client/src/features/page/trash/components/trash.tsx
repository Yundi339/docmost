import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import {
  ActionIcon,
  Button,
  Checkbox,
  Container,
  Group,
  Menu,
  Stack,
  Table,
  Text,
  Title,
} from "@mantine/core";
import {
  IconDots,
  IconFileDescription,
  IconRestore,
  IconTrash,
} from "@tabler/icons-react";
import { modals } from "@mantine/modals";
import { useTranslation } from "react-i18next";
import { useGetSpaceBySlugQuery } from "@/features/space/queries/space-query";
import { TrashBanner } from "@/features/page/trash/components/trash-banner.tsx";
import {
  useBatchDeletePagesMutation,
  useBatchRestorePagesMutation,
  useDeletedPagesQuery,
  useDeletePageMutation,
  useRestorePageMutation,
} from "@/features/page/queries/page-query";
import { formattedDate } from "@/lib/time";
import TrashPageContentModal from "@/features/page/trash/components/trash-page-content-modal";
import { UserInfo } from "@/components/common/user-info.tsx";
import Paginate from "@/components/common/paginate.tsx";
import { useCursorPaginate } from "@/hooks/use-cursor-paginate";
import { useRestorePageModal } from "@/features/page/hooks/use-restore-page-modal.tsx";
import { IPage } from "@/features/page/types/page.types.ts";
import { useSpaceAbility } from "@/features/space/permissions/use-space-ability.ts";
import {
  SpaceCaslAction,
  SpaceCaslSubject,
} from "@/features/space/permissions/permissions.type.ts";

export default function Trash() {
  const { t } = useTranslation();
  const { spaceSlug } = useParams();
  const { cursor, goNext, goPrev } = useCursorPaginate();
  const { data: space } = useGetSpaceBySlugQuery(spaceSlug);
  const spaceAbility = useSpaceAbility(space?.membership?.permissions);
  const canManageSettings = spaceAbility.can(
    SpaceCaslAction.Manage,
    SpaceCaslSubject.Settings,
  );
  const { data: deletedPages, isLoading } = useDeletedPagesQuery(space?.id, {
    cursor,
    limit: 50,
  });
  const restorePageMutation = useRestorePageMutation();
  const deletePageMutation = useDeletePageMutation();
  const batchRestoreMutation = useBatchRestorePagesMutation();
  const batchDeleteMutation = useBatchDeletePagesMutation();
  const { openRestoreModal } = useRestorePageModal();

  const [selectedPageIds, setSelectedPageIds] = useState<Set<string>>(
    new Set(),
  );
  const [selectedPage, setSelectedPage] = useState<{
    title: string;
    content: any;
  } | null>(null);
  const [modalOpened, setModalOpened] = useState(false);

  const canRestorePage = (page: IPage) =>
    page.trashCapabilities?.canRestore ?? true;
  const canPermanentlyDeletePage = (page: IPage) =>
    canManageSettings && (page.trashCapabilities?.canPermanentlyDelete ?? true);
  const isPageSelectable = (page: IPage) =>
    canRestorePage(page) || canPermanentlyDeletePage(page);

  const selectedPages = (deletedPages?.items ?? []).filter((page) =>
    selectedPageIds.has(page.id),
  );
  const selectablePageIds = (deletedPages?.items ?? [])
    .filter(isPageSelectable)
    .map((page) => page.id);
  const allPagesSelected =
    selectablePageIds.length > 0 &&
    selectablePageIds.every((pageId) => selectedPageIds.has(pageId));
  const somePagesSelected = selectablePageIds.some((pageId) =>
    selectedPageIds.has(pageId),
  );
  const canRestoreSelection =
    selectedPages.length > 0 && selectedPages.every(canRestorePage);
  const canDeleteSelection =
    selectedPages.length > 0 && selectedPages.every(canPermanentlyDeletePage);
  const batchPending =
    batchRestoreMutation.isPending || batchDeleteMutation.isPending;

  useEffect(() => {
    const visiblePageIds = new Set(
      (deletedPages?.items ?? []).map((page) => page.id),
    );
    setSelectedPageIds(
      (current) =>
        new Set([...current].filter((pageId) => visiblePageIds.has(pageId))),
    );
  }, [deletedPages?.items]);

  const removePageFromSelection = (pageId: string) => {
    setSelectedPageIds((current) => {
      const next = new Set(current);
      next.delete(pageId);
      return next;
    });
  };

  const handleRestorePage = async (pageId: string) => {
    await restorePageMutation.mutateAsync(pageId);
    removePageFromSelection(pageId);
  };

  const handleDeletePage = async (pageId: string) => {
    await deletePageMutation.mutateAsync(pageId);
    removePageFromSelection(pageId);
  };

  const handleBatchRestore = async () => {
    if (!space || !canRestoreSelection) return;
    const result = await batchRestoreMutation.mutateAsync({
      pageIds: selectedPages.map((page) => page.id),
      spaceId: space.id,
    });
    setSelectedPageIds(new Set(result.failedPageIds));
  };

  const handleBatchDelete = async () => {
    if (!space || !canDeleteSelection) return;
    const result = await batchDeleteMutation.mutateAsync({
      pageIds: selectedPages.map((page) => page.id),
      spaceId: space.id,
    });
    setSelectedPageIds(new Set(result.failedPageIds));
  };

  const openDeleteModal = (pageId: string, pageTitle: string) => {
    modals.openConfirmModal({
      title: t("Are you sure you want to delete this page?"),
      children: (
        <Text size="sm">
          {t(
            "Are you sure you want to permanently delete '{{title}}'? This action cannot be undone.",
            { title: pageTitle || t("Untitled") },
          )}
        </Text>
      ),
      centered: true,
      labels: { confirm: t("Delete"), cancel: t("Cancel") },
      confirmProps: { color: "red" },
      onConfirm: () => handleDeletePage(pageId),
    });
  };

  const openBatchRestoreModal = () => {
    modals.openConfirmModal({
      title: t("Restore selected pages?"),
      children: (
        <Text size="sm">
          {t("Restore {{count}} selected pages?", {
            count: selectedPages.length,
          })}
        </Text>
      ),
      centered: true,
      labels: { confirm: t("Restore"), cancel: t("Cancel") },
      onConfirm: handleBatchRestore,
    });
  };

  const openBatchDeleteModal = () => {
    modals.openConfirmModal({
      title: t("Permanently delete selected pages?"),
      children: (
        <Text size="sm">
          {t(
            "Are you sure you want to permanently delete {{count}} selected pages? This action cannot be undone.",
            { count: selectedPages.length },
          )}
        </Text>
      ),
      centered: true,
      labels: { confirm: t("Delete"), cancel: t("Cancel") },
      confirmProps: { color: "red" },
      onConfirm: handleBatchDelete,
    });
  };

  const togglePageSelection = (pageId: string, checked: boolean) => {
    setSelectedPageIds((current) => {
      const next = new Set(current);
      if (checked) {
        next.add(pageId);
      } else {
        next.delete(pageId);
      }
      return next;
    });
  };

  const toggleAllPages = (checked: boolean) => {
    setSelectedPageIds((current) => {
      const next = new Set(current);
      for (const pageId of selectablePageIds) {
        if (checked) {
          next.add(pageId);
        } else {
          next.delete(pageId);
        }
      }
      return next;
    });
  };

  const hasPages = deletedPages && deletedPages.items.length > 0;

  const handlePageClick = (page: IPage) => {
    setSelectedPage({ title: page.title, content: page.content });
    setModalOpened(true);
  };

  return (
    <Container size="lg" py="lg">
      <Stack gap="md">
        <Group justify="space-between" mb="md">
          <Title order={2}>{t("Trash")}</Title>
        </Group>

        <TrashBanner />

        {selectedPageIds.size > 0 && (
          <Group justify="space-between" gap="sm" wrap="wrap">
            <Text size="sm" fw={500}>
              {t("{{count}} selected", { count: selectedPageIds.size })}
            </Text>
            <Group gap="xs">
              <Button
                size="xs"
                variant="default"
                leftSection={<IconRestore size={16} />}
                disabled={!canRestoreSelection || batchPending}
                loading={batchRestoreMutation.isPending}
                onClick={openBatchRestoreModal}
              >
                {t("Restore selected")}
              </Button>
              {canManageSettings && (
                <Button
                  size="xs"
                  variant="light"
                  color="red"
                  leftSection={<IconTrash size={16} />}
                  disabled={!canDeleteSelection || batchPending}
                  loading={batchDeleteMutation.isPending}
                  onClick={openBatchDeleteModal}
                >
                  {t("Delete selected")}
                </Button>
              )}
            </Group>
          </Group>
        )}

        {isLoading || !deletedPages ? (
          <></>
        ) : hasPages ? (
          <Table.ScrollContainer minWidth={620}>
            <Table highlightOnHover verticalSpacing="sm">
              <Table.Thead>
                <Table.Tr>
                  <Table.Th w={44}>
                    <Checkbox
                      aria-label={t("Select all")}
                      checked={allPagesSelected}
                      indeterminate={!allPagesSelected && somePagesSelected}
                      disabled={selectablePageIds.length === 0 || batchPending}
                      onChange={(event) =>
                        toggleAllPages(event.currentTarget.checked)
                      }
                    />
                  </Table.Th>
                  <Table.Th>{t("Page")}</Table.Th>
                  <Table.Th style={{ whiteSpace: "nowrap" }}>
                    {t("Deleted by")}
                  </Table.Th>
                  <Table.Th style={{ whiteSpace: "nowrap" }}>
                    {t("Deleted at")}
                  </Table.Th>
                  <Table.Th aria-label={t("Action")} />
                </Table.Tr>
              </Table.Thead>
              <Table.Tbody>
                {deletedPages.items.map((page) => {
                  const canRestore = canRestorePage(page);
                  const canDelete = canPermanentlyDeletePage(page);
                  const selectable = canRestore || canDelete;

                  return (
                    <Table.Tr key={page.id}>
                      <Table.Td>
                        <Checkbox
                          aria-label={t("Select page")}
                          checked={selectedPageIds.has(page.id)}
                          disabled={!selectable || batchPending}
                          onChange={(event) =>
                            togglePageSelection(
                              page.id,
                              event.currentTarget.checked,
                            )
                          }
                        />
                      </Table.Td>
                      <Table.Td>
                        <Group
                          wrap="nowrap"
                          style={{ cursor: "pointer" }}
                          onClick={() => handlePageClick(page)}
                        >
                          {page.icon || (
                            <ActionIcon
                              variant="transparent"
                              color="gray"
                              size={18}
                            >
                              <IconFileDescription size={18} />
                            </ActionIcon>
                          )}
                          <Text fw={500} size="sm" lineClamp={1}>
                            {page.title || t("Untitled")}
                          </Text>
                        </Group>
                      </Table.Td>
                      <Table.Td>
                        <UserInfo user={page.deletedBy} size="sm" />
                      </Table.Td>
                      <Table.Td>
                        <Text
                          c="dimmed"
                          style={{ whiteSpace: "nowrap" }}
                          size="xs"
                          fw={500}
                        >
                          {formattedDate(page.deletedAt)}
                        </Text>
                      </Table.Td>
                      <Table.Td>
                        {(canRestore || canDelete) && (
                          <Menu>
                            <Menu.Target>
                              <ActionIcon
                                variant="subtle"
                                color="gray"
                                aria-label={t("Page actions")}
                              >
                                <IconDots size={20} stroke={1.5} />
                              </ActionIcon>
                            </Menu.Target>
                            <Menu.Dropdown>
                              {canRestore && (
                                <Menu.Item
                                  leftSection={<IconRestore size={16} />}
                                  onClick={() =>
                                    openRestoreModal({
                                      title: page.title,
                                      onConfirm: () =>
                                        handleRestorePage(page.id),
                                    })
                                  }
                                >
                                  {t("Restore")}
                                </Menu.Item>
                              )}
                              {canDelete && (
                                <Menu.Item
                                  color="red"
                                  leftSection={<IconTrash size={16} />}
                                  onClick={() =>
                                    openDeleteModal(page.id, page.title)
                                  }
                                >
                                  {t("Delete")}
                                </Menu.Item>
                              )}
                            </Menu.Dropdown>
                          </Menu>
                        )}
                      </Table.Td>
                    </Table.Tr>
                  );
                })}
              </Table.Tbody>
            </Table>
          </Table.ScrollContainer>
        ) : (
          <Text ta="center" py="xl" c="dimmed">
            {t("No pages in trash")}
          </Text>
        )}

        {deletedPages && deletedPages.items.length > 0 && (
          <Paginate
            hasPrevPage={deletedPages.meta?.hasPrevPage}
            hasNextPage={deletedPages.meta?.hasNextPage}
            onNext={() => goNext(deletedPages.meta?.nextCursor)}
            onPrev={goPrev}
          />
        )}
      </Stack>

      {selectedPage && (
        <TrashPageContentModal
          opened={modalOpened}
          onClose={() => setModalOpened(false)}
          pageTitle={selectedPage.title}
          pageContent={selectedPage.content}
        />
      )}
    </Container>
  );
}
