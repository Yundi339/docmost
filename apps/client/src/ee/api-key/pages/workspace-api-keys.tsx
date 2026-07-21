import React, { useState } from "react";
import {
  Alert,
  Button,
  Divider,
  Group,
  Space,
  Tabs,
  Text,
} from "@mantine/core";
import { Helmet } from "react-helmet-async";
import { useTranslation } from "react-i18next";
import SettingsTitle from "@/components/settings/settings-title";
import { getAppName } from "@/lib/config";
import { ApiKeyTable } from "@/ee/api-key/components/api-key-table";
import { CreateApiKeyModal } from "@/ee/api-key/components/create-api-key-modal";
import { ApiKeyCreatedModal } from "@/ee/api-key/components/api-key-created-modal";
import { UpdateApiKeyModal } from "@/ee/api-key/components/update-api-key-modal";
import { RevokeApiKeyModal } from "@/ee/api-key/components/revoke-api-key-modal";
import Paginate from "@/components/common/paginate";
import { useCursorPaginate } from "@/hooks/use-cursor-paginate";
import { useGetApiKeysQuery } from "@/ee/api-key/queries/api-key-query.ts";
import { ApiKeyType, IApiKey } from "@/ee/api-key";
import useUserRole from "@/hooks/use-user-role.tsx";
import RestrictApiToAdmins from "@/ee/api-key/components/restrict-api-to-admins";
import { useAtomValue } from "jotai";
import { workspaceAtom } from "@/features/user/atoms/current-user-atom";
import { resolveMcpMode } from "@/features/workspace/lib/mcp-mode";
import { IconInfoCircle } from "@tabler/icons-react";

export default function WorkspaceApiKeys() {
  const { t } = useTranslation();
  const { cursor, goNext, goPrev, resetCursor } = useCursorPaginate();
  const [createModalOpened, setCreateModalOpened] = useState(false);
  const [createdApiKey, setCreatedApiKey] = useState<IApiKey | null>(null);
  const [updateModalOpened, setUpdateModalOpened] = useState(false);
  const [revokeModalOpened, setRevokeModalOpened] = useState(false);
  const [selectedApiKey, setSelectedApiKey] = useState<IApiKey | null>(null);
  const [keyType, setKeyType] = useState<ApiKeyType>("rest");
  const workspace = useAtomValue(workspaceAtom);
  const mcpDisabled =
    keyType === "mcp" &&
    resolveMcpMode(workspace?.settings?.ai) === "off";
  const { isOwner } = useUserRole();
  const { data, isLoading } = useGetApiKeysQuery(
    {
      cursor,
      adminView: true,
      keyType,
    },
    { enabled: isOwner },
  );

  if (!isOwner) {
    return null;
  }

  const handleCreateSuccess = (response: IApiKey) => {
    setCreatedApiKey(response);
  };

  const handleUpdate = (apiKey: IApiKey) => {
    setSelectedApiKey(apiKey);
    setUpdateModalOpened(true);
  };

  const handleRevoke = (apiKey: IApiKey) => {
    setSelectedApiKey(apiKey);
    setRevokeModalOpened(true);
  };

  return (
    <>
      <Helmet>
        <title>
          {t("API management")} - {getAppName()}
        </title>
      </Helmet>

      <SettingsTitle title={t("API management")} />

      <Text size="sm" c="dimmed" mb="md">
        {t("Manage API keys for all users in the workspace.")}
      </Text>

      <RestrictApiToAdmins />
      <Divider my="lg" />

      <Tabs
        value={keyType}
        onChange={(value) => {
          resetCursor();
          setKeyType((value as ApiKeyType) || "rest");
        }}
        color="dark"
      >
        <Group justify="space-between" align="center" mb="md">
          <Tabs.List>
            <Tabs.Tab value="rest">{t("REST API keys")}</Tabs.Tab>
            <Tabs.Tab value="mcp">{t("MCP keys")}</Tabs.Tab>
          </Tabs.List>
          <Button
            disabled={mcpDisabled}
            onClick={() => setCreateModalOpened(true)}
          >
            {t(keyType === "rest" ? "Create REST API key" : "Create MCP key")}
          </Button>
        </Group>

        {mcpDisabled && (
          <Alert
            variant="light"
            color="yellow"
            mb="md"
            p="sm"
            icon={<IconInfoCircle />}
          >
            <Text size="sm">
              {t("MCP is disabled. Enable MCP before creating MCP keys.")}
            </Text>
          </Alert>
        )}

        <Tabs.Panel value={keyType}>
          <ApiKeyTable
            apiKeys={data?.items || []}
            keyType={keyType}
            isLoading={isLoading}
            showUserColumn
            updateActionLabel="Rename"
            emptyText={t(
              keyType === "rest" ? "No REST API keys yet." : "No MCP keys yet.",
            )}
            onUpdate={handleUpdate}
            onRevoke={handleRevoke}
          />
        </Tabs.Panel>
      </Tabs>

      <Space h="md" />

      {data?.items.length > 0 && (
        <Paginate
          hasPrevPage={data?.meta?.hasPrevPage}
          hasNextPage={data?.meta?.hasNextPage}
          onNext={() => goNext(data?.meta?.nextCursor)}
          onPrev={goPrev}
        />
      )}

      <CreateApiKeyModal
        opened={createModalOpened}
        onClose={() => setCreateModalOpened(false)}
        onSuccess={handleCreateSuccess}
        keyType={keyType}
      />

      <ApiKeyCreatedModal
        opened={!!createdApiKey}
        onClose={() => setCreatedApiKey(null)}
        apiKey={createdApiKey}
      />

      <UpdateApiKeyModal
        opened={updateModalOpened}
        nameOnly
        onClose={() => {
          setUpdateModalOpened(false);
          setSelectedApiKey(null);
        }}
        apiKey={selectedApiKey}
      />

      <RevokeApiKeyModal
        opened={revokeModalOpened}
        onClose={() => {
          setRevokeModalOpened(false);
          setSelectedApiKey(null);
        }}
        apiKey={selectedApiKey}
      />
    </>
  );
}
