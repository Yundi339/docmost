import {
  ActionIcon,
  Alert,
  Box,
  Group,
  Loader,
  SegmentedControl,
  Select,
  Skeleton,
  Stack,
  Table,
  Text,
  TextInput,
  Tooltip,
  UnstyledButton,
} from "@mantine/core";
import { useDebouncedValue } from "@mantine/hooks";
import {
  IconArrowsMaximize,
  IconDownload,
  IconExternalLink,
  IconFocusCentered,
  IconMinus,
  IconPlus,
  IconSearch,
  IconTopologyStar,
} from "@tabler/icons-react";
import { lazy, Suspense, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { notifications } from "@mantine/notifications";
import { useSpaceGraphQuery } from "@/features/space/queries/space-query";
import { exportSpaceGraph } from "@/features/space/services/space-service";
import { ISpace } from "@/features/space/types/space.types";
import { buildPageUrl } from "@/features/page/page.utils";
import { formattedDate } from "@/lib/time";
import { filterGraph, GraphConnectionFilter } from "./space-graph-utils";
import type { SpaceGraphCanvasApi } from "./space-graph-canvas";
import classes from "./space-graph.module.css";

const SpaceGraphCanvas = lazy(() => import("./space-graph-canvas"));

type Props = { space: ISpace };

export default function SpaceGraphView({ space }: Props) {
  const { t } = useTranslation();
  const canvasRef = useRef<SpaceGraphCanvasApi>(null);
  const [mode, setMode] = useState<"graph" | "list">("graph");
  const [layout, setLayout] = useState<"force" | "grid">("force");
  const [filter, setFilter] = useState<GraphConnectionFilter>("all");
  const [search, setSearch] = useState("");
  const [query] = useDebouncedValue(search, 300);
  const [limit, setLimit] = useState("500");
  const [centerPageId, setCenterPageId] = useState<string>();
  const [depth, setDepth] = useState("1");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);

  const params = {
    spaceId: space.id,
    centerPageId,
    depth: centerPageId ? Number(depth) : undefined,
    query: query || undefined,
    limit: Number(limit),
  };
  const graphQuery = useSpaceGraphQuery(params);
  const graph = useMemo(
    () =>
      filterGraph(
        graphQuery.data?.nodes ?? [],
        graphQuery.data?.edges ?? [],
        filter,
      ),
    [filter, graphQuery.data],
  );
  const selected = graph.nodes.find((node) => node.id === selectedId) ?? null;
  const selectedStats = selected
    ? (graph.stats.get(selected.id) ?? { incoming: 0, outgoing: 0 })
    : null;

  const handleExport = async () => {
    setExporting(true);
    try {
      await exportSpaceGraph(params, space.slug);
    } catch {
      notifications.show({
        message: t("Failed to export relationship graph"),
        color: "red",
      });
    } finally {
      setExporting(false);
    }
  };

  return (
    <Stack gap="md">
      <div className={classes.toolbar}>
        <TextInput
          className={classes.search}
          value={search}
          onChange={(event) => setSearch(event.currentTarget.value)}
          placeholder={t("Search pages")}
          leftSection={<IconSearch size={16} />}
        />
        <SegmentedControl
          value={mode}
          onChange={(value) => setMode(value as "graph" | "list")}
          data={[
            { value: "graph", label: t("Graph") },
            { value: "list", label: t("List") },
          ]}
        />
        <Select
          value={filter}
          onChange={(value) =>
            value && setFilter(value as GraphConnectionFilter)
          }
          data={[
            { value: "all", label: t("All pages") },
            { value: "connected", label: t("Connected pages") },
            { value: "unlinked", label: t("No visible links") },
          ]}
          w={170}
          allowDeselect={false}
        />
        <Select
          value={limit}
          onChange={(value) => value && setLimit(value)}
          data={["100", "250", "500"]}
          w={90}
          allowDeselect={false}
        />
        <Tooltip label={t("Export")}>
          <ActionIcon
            variant="default"
            size="lg"
            onClick={handleExport}
            loading={exporting}
            aria-label={t("Export")}
          >
            <IconDownload size={18} />
          </ActionIcon>
        </Tooltip>
      </div>

      {centerPageId && (
        <Group gap="sm">
          <IconFocusCentered size={18} />
          <Text size="sm" fw={500} lineClamp={1}>
            {graphQuery.data?.nodes.find((node) => node.id === centerPageId)
              ?.title || t("Untitled")}
          </Text>
          <Select
            value={depth}
            onChange={(value) => value && setDepth(value)}
            data={[
              { value: "1", label: t("1 hop") },
              { value: "2", label: t("2 hops") },
              { value: "3", label: t("3 hops") },
            ]}
            w={110}
            allowDeselect={false}
          />
          <Tooltip label={t("Clear focus")}>
            <ActionIcon
              variant="subtle"
              color="gray"
              size="lg"
              onClick={() => {
                setCenterPageId(undefined);
                setSelectedId(null);
              }}
              aria-label={t("Clear focus")}
            >
              <IconMinus size={18} />
            </ActionIcon>
          </Tooltip>
        </Group>
      )}

      {graphQuery.data?.meta.truncated && (
        <Alert color="yellow" variant="light">
          {t("Graph data is limited to {{limit}} pages.", {
            limit: graphQuery.data.meta.limit,
          })}
        </Alert>
      )}

      {graphQuery.isLoading ? (
        <Skeleton h={420} />
      ) : graphQuery.isError ? (
        <Alert color="red">{t("Failed to load relationship graph")}</Alert>
      ) : graph.nodes.length === 0 ? (
        <Box py="xl">
          <Text ta="center" c="dimmed">
            {t("No pages match this graph view")}
          </Text>
        </Box>
      ) : mode === "graph" ? (
        <>
          <Group justify="space-between">
            <SegmentedControl
              size="xs"
              value={layout}
              onChange={(value) => setLayout(value as "force" | "grid")}
              data={[
                { value: "force", label: t("Force") },
                { value: "grid", label: t("Grid") },
              ]}
            />
            {graphQuery.isFetching && <Loader size="sm" />}
          </Group>
          <div className={classes.canvasWrap}>
            <Suspense fallback={<Skeleton h="100%" />}>
              <SpaceGraphCanvas
                ref={canvasRef}
                nodes={graph.nodes}
                edges={graph.edges}
                selectedId={selectedId}
                centerPageId={centerPageId}
                layout={layout}
                ariaLabel={t("Relationship graph")}
                onSelect={setSelectedId}
              />
            </Suspense>
            <Group gap={4} className={classes.canvasControls}>
              <Tooltip label={t("Zoom in")}>
                <ActionIcon
                  variant="subtle"
                  color="gray"
                  size="lg"
                  onClick={() => canvasRef.current?.zoomIn()}
                  aria-label={t("Zoom in")}
                >
                  <IconPlus size={18} />
                </ActionIcon>
              </Tooltip>
              <Tooltip label={t("Zoom out")}>
                <ActionIcon
                  variant="subtle"
                  color="gray"
                  size="lg"
                  onClick={() => canvasRef.current?.zoomOut()}
                  aria-label={t("Zoom out")}
                >
                  <IconMinus size={18} />
                </ActionIcon>
              </Tooltip>
              <Tooltip label={t("Fit view")}>
                <ActionIcon
                  variant="subtle"
                  color="gray"
                  size="lg"
                  onClick={() => canvasRef.current?.fit()}
                  aria-label={t("Fit view")}
                >
                  <IconArrowsMaximize size={18} />
                </ActionIcon>
              </Tooltip>
            </Group>
          </div>
          <div className={classes.selection}>
            {selected && selectedStats ? (
              <Group justify="space-between" wrap="wrap">
                <div>
                  <Text fw={600} lineClamp={1}>
                    {selected.icon} {selected.title || t("Untitled")}
                  </Text>
                  <Text size="xs" c="dimmed">
                    {t("Incoming links")}: {selectedStats.incoming} ·{" "}
                    {t("Outgoing links")}: {selectedStats.outgoing}
                  </Text>
                </div>
                <Group gap="xs">
                  <Tooltip label={t("Focus page")}>
                    <ActionIcon
                      variant="default"
                      size="lg"
                      onClick={() => setCenterPageId(selected.id)}
                      aria-label={t("Focus page")}
                    >
                      <IconTopologyStar size={18} />
                    </ActionIcon>
                  </Tooltip>
                  <Tooltip label={t("Open page")}>
                    <ActionIcon
                      component={Link}
                      to={buildPageUrl(
                        space.slug,
                        selected.slugId,
                        selected.title ?? undefined,
                      )}
                      variant="default"
                      size="lg"
                      aria-label={t("Open page")}
                    >
                      <IconExternalLink size={18} />
                    </ActionIcon>
                  </Tooltip>
                </Group>
              </Group>
            ) : null}
          </div>
        </>
      ) : (
        <Table.ScrollContainer minWidth={620}>
          <Table highlightOnHover verticalSpacing="sm">
            <Table.Thead>
              <Table.Tr>
                <Table.Th>{t("Page")}</Table.Th>
                <Table.Th>{t("Incoming links")}</Table.Th>
                <Table.Th>{t("Outgoing links")}</Table.Th>
                <Table.Th>{t("Last updated")}</Table.Th>
              </Table.Tr>
            </Table.Thead>
            <Table.Tbody>
              {graph.nodes.map((node) => {
                const stats = graph.stats.get(node.id) ?? {
                  incoming: 0,
                  outgoing: 0,
                };
                return (
                  <Table.Tr key={node.id}>
                    <Table.Td>
                      <UnstyledButton
                        component={Link}
                        className={classes.pageLink}
                        to={buildPageUrl(
                          space.slug,
                          node.slugId,
                          node.title ?? undefined,
                        )}
                      >
                        <Text fw={500} lineClamp={1}>
                          {node.icon} {node.title || t("Untitled")}
                        </Text>
                      </UnstyledButton>
                    </Table.Td>
                    <Table.Td>{stats.incoming}</Table.Td>
                    <Table.Td>{stats.outgoing}</Table.Td>
                    <Table.Td>
                      <Text size="xs" c="dimmed">
                        {formattedDate(new Date(node.updatedAt))}
                      </Text>
                    </Table.Td>
                  </Table.Tr>
                );
              })}
            </Table.Tbody>
          </Table>
        </Table.ScrollContainer>
      )}
    </Stack>
  );
}
