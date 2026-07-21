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
import { IOAuthAuthorization, IOAuthClient, OAuthScope } from "@/ee/oauth";
import { OAuthAuthorizationTable } from "@/ee/oauth/components/oauth-authorization-table";
import { getOAuthProviderDescriptor } from "@/ee/oauth/oauth-provider-registry";
import { resolveMcpMode } from "@/features/workspace/lib/mcp-mode";

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

  const mcpMode = resolveMcpMode(workspace?.settings?.ai);

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
      ) : clients.length ? (
        <Stack gap="sm">
          {clients.map((client) => (
            <OAuthClientManagementCard
              key={client.id}
              client={client}
              isPending={updateClientMutation.isPending}
              onUpdate={(input) => updateClientMutation.mutate(input)}
            />
          ))}
        </Stack>
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

function OAuthClientManagementCard({
  client,
  isPending,
  onUpdate,
}: {
  client: IOAuthClient;
  isPending: boolean;
  onUpdate: (input: {
    clientId: string;
    isEnabled?: boolean;
    allowedScopes?: OAuthScope[];
  }) => void;
}) {
  const { t } = useTranslation();
  const descriptor = getOAuthProviderDescriptor(client.provider, client.name);
  const scopeMode = client.allowedScopes.includes("mcp:write")
    ? "read-write"
    : "read-only";
  const destructiveEnabled = client.allowedScopes.includes("mcp:destructive");

  const updateScopes = (value: string) => {
    const allowedScopes: OAuthScope[] =
      value === "read-write"
        ? [
            "mcp:read",
            "mcp:write",
            ...(destructiveEnabled ? (["mcp:destructive"] as const) : []),
          ]
        : ["mcp:read"];
    onUpdate({ clientId: client.id, allowedScopes });
  };

  return (
    <Paper withBorder radius="sm" p="md">
      <Group justify="space-between" align="flex-start" mb="md">
        <div>
          <Group gap="xs">
            <Text fw={600}>{client.name}</Text>
            <Badge variant="light">{descriptor.badge}</Badge>
          </Group>
          {descriptor.description && (
            <Text size="sm" c="dimmed">
              {t(descriptor.description)}
            </Text>
          )}
        </div>
        <Switch
          checked={client.isEnabled}
          disabled={isPending}
          label={client.isEnabled ? t("Enabled") : t("Disabled")}
          onChange={(event) =>
            onUpdate({
              clientId: client.id,
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
            disabled={isPending}
            data={[
              { label: t("Read only"), value: "read-only" },
              { label: t("Read and write"), value: "read-write" },
            ]}
          />
        </div>

        <Switch
          checked={destructiveEnabled}
          disabled={scopeMode !== "read-write" || isPending}
          label={t("Destructive MCP tools")}
          description={t(
            "Allow explicitly confirmed page trash operations through MCP.",
          )}
          onChange={(event) =>
            onUpdate({
              clientId: client.id,
              allowedScopes: event.currentTarget.checked
                ? ["mcp:read", "mcp:write", "mcp:destructive"]
                : ["mcp:read", "mcp:write"],
            })
          }
        />

        <Divider />

        <CopyRow label={t("MCP server URL")} value={client.mcpServerUrl} />
        <CopyRow
          label={t("Protected resource metadata")}
          value={client.resourceMetadataUrl}
        />
        <CopyRow
          label={t("Authorization server metadata")}
          value={client.authorizationServerMetadataUrl}
        />
        <CopyRow
          label={t("Dynamic client registration")}
          value={client.registrationEndpoint}
        />
      </Stack>
    </Paper>
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
