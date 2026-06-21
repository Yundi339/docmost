import React from "react";
import {
  Alert,
  ActionIcon,
  Anchor,
  Badge,
  CopyButton,
  Divider,
  Group,
  Loader,
  Paper,
  SegmentedControl,
  Stack,
  Switch,
  Text,
  Tooltip,
} from "@mantine/core";
import { modals } from "@mantine/modals";
import {
  IconCheck,
  IconCopy,
  IconInfoCircle,
  IconX,
} from "@tabler/icons-react";
import { Helmet } from "react-helmet-async";
import { Link } from "react-router-dom";
import { useAtom } from "jotai";
import { useTranslation } from "react-i18next";
import SettingsTitle from "@/components/settings/settings-title";
import { getAppName } from "@/lib/config";
import useUserRole from "@/hooks/use-user-role";
import { workspaceAtom } from "@/features/user/atoms/current-user-atom";
import {
  useOAuthAuthorizationsQuery,
  useOAuthClientsQuery,
  useRevokeOAuthAuthorizationMutation,
  useUpdateOAuthClientMutation,
} from "@/ee/oauth/queries/oauth-query";
import { IOAuthAuthorization, OAuthScope } from "@/ee/oauth";
import { OAuthAuthorizationTable } from "@/ee/oauth/components/oauth-authorization-table";

export default function WorkspaceOAuthManagement() {
  const { t } = useTranslation();
  const { isOwner } = useUserRole();
  const [workspace] = useAtom(workspaceAtom);
  const { data: clients = [], isLoading } = useOAuthClientsQuery({
    enabled: isOwner,
  });
  const { data: authorizations = [] } = useOAuthAuthorizationsQuery(
    { adminView: true },
    { enabled: isOwner },
  );
  const updateClientMutation = useUpdateOAuthClientMutation();
  const revokeMutation = useRevokeOAuthAuthorizationMutation();

  if (!isOwner) {
    return null;
  }

  const chatgptClient = clients.find((client) => client.provider === "chatgpt");
  const mcpMode = resolveMcpMode(workspace?.settings?.ai);
  const scopeMode = chatgptClient?.allowedScopes.includes("mcp:write")
    ? "read-write"
    : "read-only";

  const updateScopes = (value: string) => {
    if (!chatgptClient) return;
    const allowedScopes: OAuthScope[] =
      value === "read-write" ? ["mcp:read", "mcp:write"] : ["mcp:read"];
    updateClientMutation.mutate({
      clientId: chatgptClient.id,
      allowedScopes,
    });
  };

  const revokeAuthorization = (authorization: IOAuthAuthorization) => {
    modals.openConfirmModal({
      title: t("Revoke OAuth authorization"),
      children: (
        <Text size="sm">
          {t("This will disconnect the selected OAuth application.")}
        </Text>
      ),
      labels: { confirm: t("Revoke"), cancel: t("Cancel") },
      confirmProps: { color: "red" },
      onConfirm: () =>
        revokeMutation.mutate({ authorizationId: authorization.id }),
    });
  };

  return (
    <>
      <Helmet>
        <title>
          {t("OAuth management")} - {getAppName()}
        </title>
      </Helmet>

      <SettingsTitle title={t("OAuth management")} />

      <Text size="sm" c="dimmed" mb="md">
        {t("Manage OAuth access for AI clients that connect to Docmost MCP.")}
      </Text>

      {mcpMode === "off" && (
        <Alert
          variant="light"
          color="yellow"
          mb="md"
          p="sm"
          icon={<IconInfoCircle />}
        >
          <Text size="sm">
            {t(
              "MCP is disabled. Enable MCP before users can authorize OAuth clients.",
            )}
          </Text>
          <Anchor component={Link} to="/settings/ai/mcp" size="sm">
            {t("Open AI settings")}
          </Anchor>
        </Alert>
      )}

      {isLoading ? (
        <Group justify="center" py="xl">
          <Loader size="sm" />
        </Group>
      ) : chatgptClient ? (
        <Paper withBorder radius="sm" p="md">
          <Group justify="space-between" align="flex-start" mb="md">
            <div>
              <Group gap="xs">
                <Text fw={600}>{chatgptClient.name}</Text>
                <Badge variant="light">GPT</Badge>
              </Group>
              <Text size="sm" c="dimmed">
                {t("ChatGPT OAuth provider for Docmost MCP.")}
              </Text>
            </div>
            <Switch
              checked={chatgptClient.isEnabled}
              disabled={updateClientMutation.isPending}
              label={chatgptClient.isEnabled ? t("Enabled") : t("Disabled")}
              onChange={(event) =>
                updateClientMutation.mutate({
                  clientId: chatgptClient.id,
                  isEnabled: event.currentTarget.checked,
                })
              }
            />
          </Group>

          <Stack gap="sm">
            <div>
              <Text size="sm" fw={500} mb={6}>
                {t("Allowed access")}
              </Text>
              <SegmentedControl
                value={scopeMode}
                onChange={updateScopes}
                disabled={updateClientMutation.isPending}
                data={[
                  { label: t("Read only"), value: "read-only" },
                  { label: t("Read and write"), value: "read-write" },
                ]}
              />
            </div>

            <Divider />

            <CopyRow
              label={t("MCP server URL")}
              value={chatgptClient.mcpServerUrl}
            />
            <CopyRow
              label={t("Protected resource metadata")}
              value={chatgptClient.resourceMetadataUrl}
            />
            <CopyRow
              label={t("Authorization server metadata")}
              value={chatgptClient.authorizationServerMetadataUrl}
            />
            <CopyRow
              label={t("Dynamic client registration")}
              value={chatgptClient.registrationEndpoint}
            />
          </Stack>
        </Paper>
      ) : (
        <Alert variant="light" color="yellow" p="sm" icon={<IconInfoCircle />}>
          {t("No OAuth providers are configured.")}
        </Alert>
      )}

      <Divider my="lg" />

      <Text fw={600} mb="sm">
        {t("Authorized applications")}
      </Text>
      <OAuthAuthorizationTable
        authorizations={authorizations}
        showUserColumn
        onRevoke={revokeAuthorization}
      />
    </>
  );
}

function CopyRow({ label, value }: { label: string; value: string }) {
  const { t } = useTranslation();

  return (
    <Group justify="space-between" gap="sm" wrap="nowrap">
      <div style={{ minWidth: 0 }}>
        <Text size="sm" fw={500}>
          {label}
        </Text>
        <Text size="sm" c="dimmed" ff="monospace" truncate>
          {value}
        </Text>
      </div>
      <CopyButton value={value}>
        {({ copied, copy }) => (
          <Tooltip label={copied ? t("Copied") : t("Copy")}>
            <ActionIcon
              variant="subtle"
              color={copied ? "green" : "gray"}
              onClick={copy}
              aria-label={copied ? t("Copied") : t("Copy")}
            >
              {copied ? <IconCheck size={16} /> : <IconCopy size={16} />}
            </ActionIcon>
          </Tooltip>
        )}
      </CopyButton>
    </Group>
  );
}

type McpMode = "off" | "read-only" | "read-write";

function resolveMcpMode(aiSettings: any): McpMode {
  if (
    aiSettings?.mcpMode === "read-only" ||
    aiSettings?.mcpMode === "read-write"
  ) {
    return aiSettings.mcpMode;
  }
  if (aiSettings?.mcpMode === "off") {
    return "off";
  }

  return aiSettings?.mcp === true ? "read-write" : "off";
}
