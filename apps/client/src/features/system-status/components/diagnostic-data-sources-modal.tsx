import {
  ActionIcon,
  Alert,
  Anchor,
  Badge,
  Box,
  Button,
  Code,
  Group,
  Loader,
  Modal,
  SegmentedControl,
  Stack,
  Table,
  Text,
  Tooltip,
} from "@mantine/core";
import {
  IconAlertTriangle,
  IconDatabase,
  IconRefresh,
} from "@tabler/icons-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";
import { buildPageUrl } from "@/features/page/page.utils";
import { useSystemDiagnosticDataSourcesQuery } from "@/features/system-status/queries/system-status-query";
import {
  ISystemDiagnosticDataSource,
  SystemDiagnosticDataSourceIssue,
  SystemDiagnosticDataSourceState,
} from "@/features/system-status/types/system-status.types";

const stateLabels: Record<SystemDiagnosticDataSourceState, string> = {
  healthy: "Healthy",
  pending: "Awaiting attachment",
  orphaned: "Orphaned",
  trashed: "In trash",
};

const issueLabels: Record<SystemDiagnosticDataSourceIssue, string> = {
  missing_host_page: "Host page is missing",
  workspace_mismatch: "Host page belongs to another workspace",
  space_mismatch: "Host page belongs to another space",
  database_block_missing: "Database block is missing from the page",
};

function DataSourceStateBadge({
  state,
}: {
  state: SystemDiagnosticDataSourceState;
}) {
  const { t } = useTranslation();
  const color =
    state === "healthy"
      ? "green"
      : state === "orphaned"
        ? "yellow"
        : state === "pending"
          ? "blue"
          : "gray";
  return (
    <Badge color={color} variant="light">
      {t(stateLabels[state])}
    </Badge>
  );
}

function PageCell({ item }: { item: ISystemDiagnosticDataSource }) {
  const { t } = useTranslation();
  const page = item.hostPage;
  if (!page)
    return (
      <Text size="sm" c="dimmed">
        {t("Missing page")}
      </Text>
    );

  const title = page.title || t("Untitled");
  if (page.deletedAt || !item.space) {
    return (
      <Stack gap={2}>
        <Text size="sm" fw={500} lineClamp={1}>
          {title}
        </Text>
        {page.deletedAt && (
          <Text size="xs" c="dimmed">
            {t("In trash")}
          </Text>
        )}
      </Stack>
    );
  }

  return (
    <Anchor
      component={Link}
      to={buildPageUrl(item.space.slug, page.slugId, page.title ?? undefined)}
      size="sm"
      fw={500}
      underline="hover"
    >
      {title}
    </Anchor>
  );
}

function formatDateTime(value: string): string {
  return new Date(value).toLocaleString(undefined, {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });
}

export default function DiagnosticDataSourcesModal({
  opened,
  onClose,
}: {
  opened: boolean;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const [filter, setFilter] = useState<"issues" | "all">("issues");
  const query = useSystemDiagnosticDataSourcesQuery(filter, opened);
  const items = query.data?.pages.flatMap((page) => page.items) ?? [];

  return (
    <Modal
      opened={opened}
      onClose={onClose}
      title={t("Data sources")}
      size="xl"
      centered
    >
      <Stack gap="md">
        <Group justify="space-between" gap="sm">
          <SegmentedControl
            value={filter}
            onChange={(value) => setFilter(value as "issues" | "all")}
            data={[
              { value: "issues", label: t("Needs attention") },
              { value: "all", label: t("All data sources") },
            ]}
          />
          <Tooltip label={t("Refresh")}>
            <ActionIcon
              variant="subtle"
              aria-label={t("Refresh")}
              onClick={() => void query.refetch()}
              loading={query.isFetching}
            >
              <IconRefresh size={17} />
            </ActionIcon>
          </Tooltip>
        </Group>

        {query.isError ? (
          <Alert color="red" icon={<IconAlertTriangle size={18} />}>
            {t("Failed to load data sources.")}
          </Alert>
        ) : query.isLoading ? (
          <Group justify="center" py="xl">
            <Loader size="sm" />
          </Group>
        ) : items.length === 0 ? (
          <Box py="xl">
            <Text ta="center" size="sm" c="dimmed">
              {filter === "issues"
                ? t("No data sources need attention.")
                : t("No data sources found.")}
            </Text>
          </Box>
        ) : (
          <>
            <Table.ScrollContainer minWidth={900} maxHeight={520}>
              <Table verticalSpacing="sm" highlightOnHover stickyHeader>
                <Table.Thead>
                  <Table.Tr>
                    <Table.Th w={130}>{t("Status")}</Table.Th>
                    <Table.Th>{t("Data source")}</Table.Th>
                    <Table.Th>{t("Host page")}</Table.Th>
                    <Table.Th>{t("Space")}</Table.Th>
                    <Table.Th w={90}>{t("Work items")}</Table.Th>
                    <Table.Th w={180}>{t("Created")}</Table.Th>
                  </Table.Tr>
                </Table.Thead>
                <Table.Tbody>
                  {items.map((item) => (
                    <Table.Tr key={item.id}>
                      <Table.Td>
                        <DataSourceStateBadge state={item.state} />
                      </Table.Td>
                      <Table.Td>
                        <Stack gap={3}>
                          <Group gap="xs" wrap="nowrap">
                            <IconDatabase size={15} />
                            <Text size="sm" fw={500} lineClamp={1}>
                              {item.title || t("Restricted data source")}
                            </Text>
                          </Group>
                          <Group gap="xs">
                            <Code fz={11}>{item.id.slice(0, 12)}</Code>
                            <Text size="xs" c="dimmed">
                              {item.provider}
                            </Text>
                          </Group>
                          {item.issue && (
                            <Text size="xs" c="yellow.8">
                              {t(issueLabels[item.issue])}
                            </Text>
                          )}
                        </Stack>
                      </Table.Td>
                      <Table.Td>
                        <PageCell item={item} />
                      </Table.Td>
                      <Table.Td>
                        <Text size="sm">
                          {item.space?.name || t("Unknown")}
                        </Text>
                      </Table.Td>
                      <Table.Td>
                        <Text size="sm">{item.recordCount ?? "-"}</Text>
                      </Table.Td>
                      <Table.Td>
                        <Text size="sm">{formatDateTime(item.createdAt)}</Text>
                      </Table.Td>
                    </Table.Tr>
                  ))}
                </Table.Tbody>
              </Table>
            </Table.ScrollContainer>
            {query.hasNextPage && (
              <Group justify="center">
                <Button
                  variant="subtle"
                  size="xs"
                  loading={query.isFetchingNextPage}
                  onClick={() => void query.fetchNextPage()}
                >
                  {t("Load more")}
                </Button>
              </Group>
            )}
          </>
        )}
      </Stack>
    </Modal>
  );
}
