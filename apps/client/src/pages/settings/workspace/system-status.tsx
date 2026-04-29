import {
  Badge,
  Card,
  Group,
  Loader,
  Progress,
  SimpleGrid,
  Stack,
  Text,
  Title,
  Tooltip,
} from "@mantine/core";
import {
  IconActivity,
  IconAlertCircle,
  IconCheck,
  IconCircleDashed,
  IconDatabase,
  IconServer,
} from "@tabler/icons-react";
import { useTranslation } from "react-i18next";
import { Helmet } from "react-helmet-async";
import SettingsTitle from "@/components/settings/settings-title";
import { getAppName } from "@/lib/config";
import { useSystemStatusQuery } from "@/features/system-status/queries/system-status-query";
import {
  ISystemStatus,
  ISystemStatusDatabase,
  ISystemStatusRedis,
} from "@/features/system-status/types/system-status.types";

function formatUptime(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;
  const m = Math.floor(seconds / 60);
  if (m < 60) return `${m}m ${seconds % 60}s`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ${m % 60}m`;
  const d = Math.floor(h / 24);
  return `${d}d ${h % 24}h`;
}

function StatusBadge({ status }: { status: "up" | "down" }) {
  const { t } = useTranslation();
  if (status === "up") {
    return (
      <Badge
        color="green"
        leftSection={<IconCheck size={12} />}
        variant="light"
      >
        {t("Healthy")}
      </Badge>
    );
  }
  return (
    <Badge color="red" leftSection={<IconAlertCircle size={12} />} variant="light">
      {t("Unavailable")}
    </Badge>
  );
}

function MetricRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <Group justify="space-between" gap="xs" wrap="nowrap">
      <Text size="sm" c="dimmed">
        {label}
      </Text>
      <Text size="sm" fw={500} ta="right">
        {value ?? "—"}
      </Text>
    </Group>
  );
}

function AppCard({ data }: { data: ISystemStatus }) {
  const { t } = useTranslation();
  return (
    <Card withBorder padding="md" radius="md">
      <Group justify="space-between" mb="xs">
        <Group gap="xs">
          <IconServer size={18} />
          <Title order={5}>{t("Application")}</Title>
        </Group>
        <StatusBadge status="up" />
      </Group>
      <Stack gap={6}>
        <MetricRow label={t("Version")} value={data.app.version} />
        <MetricRow label={t("Node")} value={data.app.nodeVersion} />
        <MetricRow label={t("Edition")} value={data.app.cloud ? t("Cloud") : t("Self-hosted")} />
        <MetricRow label={t("Uptime")} value={formatUptime(data.app.uptimeSeconds)} />
      </Stack>
    </Card>
  );
}

function DatabaseCard({ data }: { data: ISystemStatusDatabase }) {
  const { t } = useTranslation();
  const usedPct =
    data.activeConnections != null && data.maxConnections
      ? (data.activeConnections / data.maxConnections) * 100
      : null;
  return (
    <Card withBorder padding="md" radius="md">
      <Group justify="space-between" mb="xs">
        <Group gap="xs">
          <IconDatabase size={18} />
          <Title order={5}>{t("Database")} (PostgreSQL)</Title>
        </Group>
        <StatusBadge status={data.status} />
      </Group>
      {data.status === "down" ? (
        <Text size="sm" c="red">
          {data.error ?? t("Unavailable")}
        </Text>
      ) : (
        <Stack gap={6}>
          <MetricRow label={t("Version")} value={data.version} />
          <MetricRow
            label={t("Latency")}
            value={data.latencyMs != null ? `${data.latencyMs} ms` : null}
          />
          <MetricRow label={t("Size")} value={data.sizePretty} />
          <MetricRow
            label={t("Connections")}
            value={
              data.activeConnections != null && data.maxConnections != null
                ? `${data.activeConnections} / ${data.maxConnections}`
                : data.activeConnections
            }
          />
          {usedPct != null && (
            <Tooltip label={`${usedPct.toFixed(1)}%`}>
              <Progress value={usedPct} size="sm" />
            </Tooltip>
          )}
        </Stack>
      )}
    </Card>
  );
}

function RedisCard({ data }: { data: ISystemStatusRedis }) {
  const { t } = useTranslation();
  return (
    <Card withBorder padding="md" radius="md">
      <Group justify="space-between" mb="xs">
        <Group gap="xs">
          <IconActivity size={18} />
          <Title order={5}>{t("Cache")} (Redis)</Title>
        </Group>
        <StatusBadge status={data.status} />
      </Group>
      {data.status === "down" ? (
        <Text size="sm" c="red">
          {data.error ?? t("Unavailable")}
        </Text>
      ) : (
        <Stack gap={6}>
          <MetricRow label={t("Version")} value={data.version} />
          <MetricRow
            label={t("Latency")}
            value={data.latencyMs != null ? `${data.latencyMs} ms` : null}
          />
          <MetricRow label={t("Memory used")} value={data.usedMemoryPretty} />
          <MetricRow label={t("Connected clients")} value={data.connectedClients} />
        </Stack>
      )}
    </Card>
  );
}

export default function SystemStatus() {
  const { t } = useTranslation();
  const { data, isLoading, isError, dataUpdatedAt, isFetching } =
    useSystemStatusQuery({ refetchIntervalMs: 10000 });

  return (
    <>
      <Helmet>
        <title>
          {t("System Status")} - {getAppName()}
        </title>
      </Helmet>
      <SettingsTitle title={t("System Status")} />

      <Group gap="xs" mb="md" c="dimmed">
        <IconCircleDashed size={14} />
        <Text size="xs">
          {t("Auto-refreshes every 5 seconds.")}
          {dataUpdatedAt > 0 && (
            <>
              {" "}
              {t("Last updated")}:{" "}
              {new Date(dataUpdatedAt).toLocaleTimeString()}
            </>
          )}
        </Text>
        {isFetching && <Loader size="xs" />}
      </Group>

      {isLoading && <Loader />}

      {isError && (
        <Text c="red">{t("Failed to load system status.")}</Text>
      )}

      {data && (
        <SimpleGrid cols={{ base: 1, md: 3 }} spacing="md">
          <AppCard data={data} />
          <DatabaseCard data={data.database} />
          <RedisCard data={data.redis} />
        </SimpleGrid>
      )}
    </>
  );
}
