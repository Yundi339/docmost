import {
  ActionIcon,
  Badge,
  Box,
  Button,
  Card,
  Group,
  Loader,
  Progress,
  SimpleGrid,
  Stack,
  Table,
  Tabs,
  Text,
  Title,
  Tooltip,
} from "@mantine/core";
import { modals } from "@mantine/modals";
import { notifications } from "@mantine/notifications";
import {
  IconActivity,
  IconPlugConnectedX,
  IconUsers,
} from "@tabler/icons-react";
import { useTranslation } from "react-i18next";
import {
  useMcpSessionStatusQuery,
  useReleaseMcpSessionsMutation,
} from "@/features/system-status/queries/system-status-query";
import type { ReleaseMcpSessionsInput } from "@/features/system-status/types/system-status.types";

function formatDuration(seconds: number) {
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ${seconds % 60}s`;
  const hours = Math.floor(minutes / 60);
  return `${hours}h ${minutes % 60}m`;
}

function Metric({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <Box>
      <Text size="xs" c="dimmed">
        {label}
      </Text>
      <Text size="lg" fw={600}>
        {value}
      </Text>
    </Box>
  );
}

export default function McpSessionMonitor() {
  const { t } = useTranslation();
  const { data, isLoading, isError, isFetching } = useMcpSessionStatusQuery({
    refetchIntervalMs: 10_000,
  });
  const releaseMutation = useReleaseMcpSessionsMutation();

  const release = async (input: ReleaseMcpSessionsInput) => {
    try {
      const result = await releaseMutation.mutateAsync(input);
      notifications.show({
        color: "green",
        message: t("Released {{count}} MCP sessions.", {
          count: result.releasedCount,
        }),
      });
    } catch {
      notifications.show({
        color: "red",
        message: t("Failed to release MCP sessions."),
      });
    }
  };

  const confirmReleaseIdle = () =>
    modals.openConfirmModal({
      title: t("Release all idle MCP sessions?"),
      children: (
        <Text size="sm">
          {t(
            "Idle connections will be closed immediately. Clients may reconnect automatically.",
          )}
        </Text>
      ),
      centered: true,
      labels: { confirm: t("Release"), cancel: t("Cancel") },
      confirmProps: { color: "red" },
      onConfirm: () => release({ idleOnly: true }),
    });

  const confirmReleaseSession = (sessionId: string) =>
    modals.openConfirmModal({
      title: t("Release MCP session?"),
      children: (
        <Text size="sm">
          {t(
            "This connection will be closed immediately. The client may reconnect automatically.",
          )}
        </Text>
      ),
      centered: true,
      labels: { confirm: t("Release"), cancel: t("Cancel") },
      confirmProps: { color: "red" },
      onConfirm: () => release({ sessionId }),
    });

  return (
    <Card withBorder padding="md" radius="md" mt="xl">
      <Group justify="space-between" align="flex-start" mb="md">
        <Group gap="xs">
          <IconActivity size={20} />
          <Title order={3}>{t("MCP sessions")}</Title>
          {isFetching && <Loader size="xs" />}
        </Group>
        <Button
          color="red"
          variant="light"
          leftSection={<IconPlugConnectedX size={16} />}
          disabled={!data?.summary.idleSessions || releaseMutation.isPending}
          onClick={confirmReleaseIdle}
        >
          {t("Release idle sessions")}
        </Button>
      </Group>

      {isLoading && <Loader size="sm" />}
      {isError && <Text c="red">{t("Failed to load MCP sessions.")}</Text>}

      {data && (
        <Stack gap="md">
          <SimpleGrid cols={{ base: 2, sm: 3, lg: 6 }} spacing="md">
            <Metric
              label={t("Global capacity")}
              value={`${data.summary.globalSessions} / ${data.limits.global}`}
            />
            <Metric
              label={t("Online sessions")}
              value={data.summary.workspaceSessions}
            />
            <Metric
              label={t("Busy sessions")}
              value={data.summary.busySessions}
            />
            <Metric
              label={t("Idle sessions")}
              value={data.summary.idleSessions}
            />
            <Metric label={t("Users")} value={data.summary.users} />
            <Metric label={t("Credentials")} value={data.summary.credentials} />
          </SimpleGrid>

          <Box>
            <Group justify="space-between" mb={4}>
              <Text size="xs" c="dimmed">
                {t("Global MCP session usage")}
              </Text>
              <Text size="xs" c="dimmed">
                {t("Per-key limit")}: {data.limits.perCredential} ·{" "}
                {t("Idle timeout")}:{" "}
                {formatDuration(data.limits.idleTimeoutSeconds)}
              </Text>
            </Group>
            <Progress
              value={Math.min(
                100,
                (data.summary.globalSessions / data.limits.global) * 100,
              )}
              color={
                data.summary.globalSessions / data.limits.global >= 0.8
                  ? "red"
                  : "blue"
              }
              size="sm"
            />
          </Box>

          <Tabs defaultValue="users">
            <Tabs.List>
              <Tabs.Tab value="users" leftSection={<IconUsers size={15} />}>
                {t("User occupancy")}
              </Tabs.Tab>
              <Tabs.Tab
                value="sessions"
                leftSection={<IconActivity size={15} />}
              >
                {t("Session details")}
              </Tabs.Tab>
            </Tabs.List>

            <Tabs.Panel value="users" pt="sm">
              <Table.ScrollContainer minWidth={720}>
                <Table verticalSpacing="xs">
                  <Table.Thead>
                    <Table.Tr>
                      <Table.Th>{t("User")}</Table.Th>
                      <Table.Th>{t("Online sessions")}</Table.Th>
                      <Table.Th>{t("Busy")}</Table.Th>
                      <Table.Th>{t("Idle")}</Table.Th>
                      <Table.Th>{t("Credentials")}</Table.Th>
                      <Table.Th>{t("Last activity")}</Table.Th>
                    </Table.Tr>
                  </Table.Thead>
                  <Table.Tbody>
                    {data.users.map((user) => (
                      <Table.Tr key={user.userId}>
                        <Table.Td>
                          <Text size="sm" fw={500}>
                            {user.name || user.email}
                          </Text>
                          {user.name && (
                            <Text size="xs" c="dimmed">
                              {user.email}
                            </Text>
                          )}
                        </Table.Td>
                        <Table.Td>{user.sessions}</Table.Td>
                        <Table.Td>{user.busySessions}</Table.Td>
                        <Table.Td>{user.idleSessions}</Table.Td>
                        <Table.Td>{user.credentials}</Table.Td>
                        <Table.Td>
                          {new Date(user.lastActivityAt).toLocaleString()}
                        </Table.Td>
                      </Table.Tr>
                    ))}
                    {data.users.length === 0 && (
                      <Table.Tr>
                        <Table.Td colSpan={6}>
                          <Text size="sm" c="dimmed" ta="center" py="md">
                            {t("No active MCP sessions.")}
                          </Text>
                        </Table.Td>
                      </Table.Tr>
                    )}
                  </Table.Tbody>
                </Table>
              </Table.ScrollContainer>
            </Tabs.Panel>

            <Tabs.Panel value="sessions" pt="sm">
              <Table.ScrollContainer minWidth={820}>
                <Table verticalSpacing="xs">
                  <Table.Thead>
                    <Table.Tr>
                      <Table.Th>{t("User")}</Table.Th>
                      <Table.Th>{t("Authentication")}</Table.Th>
                      <Table.Th>{t("Status")}</Table.Th>
                      <Table.Th>{t("Idle for")}</Table.Th>
                      <Table.Th>{t("Active operations")}</Table.Th>
                      <Table.Th>{t("Space access")}</Table.Th>
                      <Table.Th ta="right">{t("Actions")}</Table.Th>
                    </Table.Tr>
                  </Table.Thead>
                  <Table.Tbody>
                    {data.sessions.map((session) => (
                      <Table.Tr key={session.sessionId}>
                        <Table.Td>
                          <Text size="sm" fw={500}>
                            {session.userName || session.userEmail}
                          </Text>
                          <Tooltip label={session.sessionId}>
                            <Text size="xs" c="dimmed" ff="monospace">
                              {session.sessionId.slice(0, 12)}…
                            </Text>
                          </Tooltip>
                        </Table.Td>
                        <Table.Td>
                          <Text size="sm">
                            {session.authType === "api_key"
                              ? t("API key")
                              : t("OAuth")}
                          </Text>
                          <Tooltip label={session.credentialId}>
                            <Text size="xs" c="dimmed" ff="monospace">
                              {session.credentialId.slice(0, 12)}…
                            </Text>
                          </Tooltip>
                          {session.userAgent && (
                            <Tooltip
                              label={`${t("User agent")}: ${session.userAgent}`}
                            >
                              <Text size="xs" c="dimmed" truncate maw={145}>
                                {session.userAgent}
                              </Text>
                            </Tooltip>
                          )}
                        </Table.Td>
                        <Table.Td>
                          <Badge
                            color={session.status === "busy" ? "blue" : "gray"}
                            variant="light"
                          >
                            {session.status === "busy" ? t("Busy") : t("Idle")}
                          </Badge>
                        </Table.Td>
                        <Table.Td>
                          {session.status === "idle"
                            ? formatDuration(session.idleSeconds)
                            : "—"}
                        </Table.Td>
                        <Table.Td>{session.activeOperations}</Table.Td>
                        <Table.Td>
                          {session.spaceAccessMode === "all"
                            ? t("All spaces")
                            : t("Selected spaces")}{" "}
                          ({session.effectiveSpaceCount})
                        </Table.Td>
                        <Table.Td ta="right">
                          <Tooltip label={t("Release session")}>
                            <ActionIcon
                              color="red"
                              variant="subtle"
                              aria-label={t("Release session")}
                              loading={
                                releaseMutation.isPending &&
                                releaseMutation.variables?.sessionId ===
                                  session.sessionId
                              }
                              onClick={() =>
                                confirmReleaseSession(session.sessionId)
                              }
                            >
                              <IconPlugConnectedX size={17} />
                            </ActionIcon>
                          </Tooltip>
                        </Table.Td>
                      </Table.Tr>
                    ))}
                    {data.sessions.length === 0 && (
                      <Table.Tr>
                        <Table.Td colSpan={7}>
                          <Text size="sm" c="dimmed" ta="center" py="md">
                            {t("No active MCP sessions.")}
                          </Text>
                        </Table.Td>
                      </Table.Tr>
                    )}
                  </Table.Tbody>
                </Table>
              </Table.ScrollContainer>
            </Tabs.Panel>
          </Tabs>
        </Stack>
      )}
    </Card>
  );
}
