import {
  Alert,
  Badge,
  Box,
  Group,
  Table,
  Tabs,
  Text,
  Title,
} from "@mantine/core";
import {
  IconAlertTriangle,
  IconCheck,
  IconInfoCircle,
  IconStethoscope,
} from "@tabler/icons-react";
import { useTranslation } from "react-i18next";
import {
  ISystemDiagnosticCheck,
  ISystemDiagnosticHistoryEntry,
  ISystemDiagnostics,
  SystemDiagnosticCode,
} from "@/features/system-status/types/system-status.types";

const diagnosticLabels: Record<SystemDiagnosticCode, string> = {
  external_apitable_active: "External APITable data sources",
  large_board: "Large boards",
  orphan_database_source: "Orphaned database sources",
  invalid_database_relation: "Invalid board-page relationships",
  realtime_invalidation_failure: "Realtime update delivery",
};

function DiagnosticStatusBadge({ check }: { check: ISystemDiagnosticCheck }) {
  const { t } = useTranslation();
  if (check.status === "ok") {
    return (
      <Badge
        color="green"
        variant="light"
        leftSection={<IconCheck size={12} />}
      >
        {t("Normal")}
      </Badge>
    );
  }
  if (check.severity === "info") {
    return (
      <Badge
        color="blue"
        variant="light"
        leftSection={<IconInfoCircle size={12} />}
      >
        {t("Observed")}
      </Badge>
    );
  }
  return (
    <Badge
      color={check.severity === "error" ? "red" : "yellow"}
      variant="light"
      leftSection={<IconAlertTriangle size={12} />}
    >
      {t("Needs attention")}
    </Badge>
  );
}

function HistoryStateBadge({
  entry,
}: {
  entry: ISystemDiagnosticHistoryEntry;
}) {
  const { t } = useTranslation();
  if (entry.state === "resolved") {
    return (
      <Badge color="green" variant="light">
        {t("Resolved")}
      </Badge>
    );
  }
  if (entry.state === "occurred") {
    return (
      <Badge color="orange" variant="light">
        {t("Incident")}
      </Badge>
    );
  }
  return (
    <Badge
      color={entry.severity === "info" ? "blue" : "yellow"}
      variant="light"
    >
      {t("Detected")}
    </Badge>
  );
}

function currentValue(
  check: ISystemDiagnosticCheck,
  t: (key: string, options?: Record<string, unknown>) => string,
) {
  switch (check.code) {
    case "large_board":
      return t(
        "{{count}} boards; largest has {{value}} work items (threshold {{threshold}})",
        {
          count: check.count,
          value: check.value ?? 0,
          threshold: check.threshold ?? 0,
        },
      );
    case "realtime_invalidation_failure":
      return t("{{count}} failure records in the last {{hours}} hours", {
        count: check.count,
        hours: check.windowHours ?? 24,
      });
    case "invalid_database_relation":
      return t("{{count}} invalid relationships", { count: check.count });
    case "orphan_database_source":
      return t("{{count}} orphaned sources", { count: check.count });
    default:
      return t("{{count}} data sources", { count: check.count });
  }
}

function historyValue(
  entry: ISystemDiagnosticHistoryEntry,
  t: (key: string, options?: Record<string, unknown>) => string,
) {
  if (entry.code === "large_board" && entry.value !== undefined) {
    return t("{{count}} boards; largest had {{value}} work items", {
      count: entry.count,
      value: entry.value,
    });
  }
  return t("{{count}} affected", { count: entry.count });
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

export default function SystemDiagnostics({
  data,
}: {
  data: ISystemDiagnostics;
}) {
  const { t } = useTranslation();
  const attentionCount = data.checks.filter(
    (check) => check.status === "attention" && check.severity !== "info",
  ).length;

  return (
    <Box component="section" mt="xl" aria-labelledby="system-diagnostics-title">
      <Group justify="space-between" gap="sm" mb="md">
        <Group gap="xs">
          <IconStethoscope size={20} aria-hidden />
          <Title id="system-diagnostics-title" order={3} size="h4">
            {t("System diagnostics")}
          </Title>
        </Group>
        {data.status === "up" && (
          <Badge
            color={attentionCount > 0 ? "yellow" : "green"}
            variant="light"
          >
            {attentionCount > 0
              ? t("{{count}} items need attention", { count: attentionCount })
              : t("No active warnings")}
          </Badge>
        )}
      </Group>

      {data.status === "down" ? (
        <Alert color="yellow" icon={<IconAlertTriangle size={18} />}>
          {t("System diagnostics are temporarily unavailable.")}
        </Alert>
      ) : (
        <Tabs defaultValue="current" keepMounted={false}>
          <Tabs.List>
            <Tabs.Tab value="current">{t("Current status")}</Tabs.Tab>
            <Tabs.Tab value="history">{t("History")}</Tabs.Tab>
          </Tabs.List>

          <Tabs.Panel value="current" pt="sm">
            <Table.ScrollContainer minWidth={680}>
              <Table verticalSpacing="sm" highlightOnHover>
                <Table.Thead>
                  <Table.Tr>
                    <Table.Th w={150}>{t("Status")}</Table.Th>
                    <Table.Th>{t("Check")}</Table.Th>
                    <Table.Th>{t("Current value")}</Table.Th>
                  </Table.Tr>
                </Table.Thead>
                <Table.Tbody>
                  {data.checks.map((check) => (
                    <Table.Tr key={check.code}>
                      <Table.Td>
                        <DiagnosticStatusBadge check={check} />
                      </Table.Td>
                      <Table.Td>
                        <Text size="sm" fw={500}>
                          {t(diagnosticLabels[check.code])}
                        </Text>
                      </Table.Td>
                      <Table.Td>
                        <Text size="sm" c="dimmed">
                          {currentValue(check, t)}
                        </Text>
                      </Table.Td>
                    </Table.Tr>
                  ))}
                </Table.Tbody>
              </Table>
            </Table.ScrollContainer>
          </Tabs.Panel>

          <Tabs.Panel value="history" pt="sm">
            {data.history.length === 0 ? (
              <Text size="sm" c="dimmed" py="sm">
                {t("No diagnostic history yet.")}
              </Text>
            ) : (
              <Table.ScrollContainer minWidth={680}>
                <Table verticalSpacing="sm" highlightOnHover>
                  <Table.Thead>
                    <Table.Tr>
                      <Table.Th w={190}>{t("Time")}</Table.Th>
                      <Table.Th w={120}>{t("Status")}</Table.Th>
                      <Table.Th>{t("Check")}</Table.Th>
                      <Table.Th>{t("Details")}</Table.Th>
                    </Table.Tr>
                  </Table.Thead>
                  <Table.Tbody>
                    {data.history.map((entry) => (
                      <Table.Tr key={entry.id}>
                        <Table.Td>
                          <Text size="sm">
                            {formatDateTime(entry.createdAt)}
                          </Text>
                        </Table.Td>
                        <Table.Td>
                          <HistoryStateBadge entry={entry} />
                        </Table.Td>
                        <Table.Td>
                          <Text size="sm" fw={500}>
                            {t(diagnosticLabels[entry.code])}
                          </Text>
                        </Table.Td>
                        <Table.Td>
                          <Text size="sm" c="dimmed">
                            {historyValue(entry, t)}
                          </Text>
                        </Table.Td>
                      </Table.Tr>
                    ))}
                  </Table.Tbody>
                </Table>
              </Table.ScrollContainer>
            )}
          </Tabs.Panel>
        </Tabs>
      )}
    </Box>
  );
}
