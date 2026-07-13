import React from "react";
import {
  ActionIcon,
  Alert,
  Anchor,
  CopyButton,
  Divider,
  Group,
  Paper,
  Stack,
  Text,
  Tooltip,
} from "@mantine/core";
import { modals } from "@mantine/modals";
import { IconCheck, IconCopy, IconInfoCircle } from "@tabler/icons-react";
import { Helmet } from "react-helmet-async";
import { useTranslation } from "react-i18next";
import SettingsTitle from "@/components/settings/settings-title";
import { getAppName } from "@/lib/config";
import {
  useAvailableOAuthClientsQuery,
  useOAuthAuthorizationsQuery,
  useRevokeOAuthAuthorizationMutation,
} from "@/ee/oauth/queries/oauth-query";
import { IOAuthAuthorization } from "@/ee/oauth";
import { OAuthAuthorizationTable } from "@/ee/oauth/components/oauth-authorization-table";
import { getOAuthProviderDescriptor } from "@/ee/oauth/oauth-provider-registry";

export default function UserOAuthSettings() {
  const { t } = useTranslation();
  const { data: clients = [] } = useAvailableOAuthClientsQuery();
  const { data: authorizations = [] } = useOAuthAuthorizationsQuery();
  const revokeMutation = useRevokeOAuthAuthorizationMutation();
  const metadataClient = clients[0];

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
          {t("OAuth settings")} - {getAppName()}
        </title>
      </Helmet>

      <SettingsTitle title={t("OAuth settings")} />

      <Text size="sm" c="dimmed" mb="md">
        {t("Manage OAuth applications connected to your Docmost account.")}
      </Text>

      {clients.length ? (
        <Stack gap="sm" mb="md">
          {clients.map((client) => {
            const descriptor = getOAuthProviderDescriptor(
              client.provider,
              client.name,
            );
            return (
              <Paper key={client.id} withBorder radius="sm" p="md">
                <Stack gap="sm">
                  <Text fw={600}>{t(descriptor.label)}</Text>
                  <CopyRow
                    label={t("MCP server URL")}
                    value={client.mcpServerUrl}
                  />
                  <CopyRow
                    label={t("Protected resource metadata")}
                    value={client.resourceMetadataUrl}
                  />
                </Stack>
              </Paper>
            );
          })}
        </Stack>
      ) : (
        <Alert
          variant="light"
          color="yellow"
          mb="md"
          p="sm"
          icon={<IconInfoCircle />}
        >
          <Text size="sm">
            {t("No OAuth providers are currently enabled for this workspace.")}
          </Text>
        </Alert>
      )}

      <Divider my="lg" />

      <Group justify="space-between" mb="sm">
        <Text fw={600}>{t("Authorized applications")}</Text>
        {metadataClient?.resourceMetadataUrl && (
          <Anchor
            href={metadataClient.resourceMetadataUrl}
            target="_blank"
            size="sm"
          >
            {t("View metadata")}
          </Anchor>
        )}
      </Group>

      <OAuthAuthorizationTable
        authorizations={authorizations}
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
