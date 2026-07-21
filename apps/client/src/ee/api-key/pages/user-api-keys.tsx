import { useState } from "react";
import { Alert, Button, Code, Group, Space, Stack, Text } from "@mantine/core";
import { IconInfoCircle } from "@tabler/icons-react";
import { Helmet } from "react-helmet-async";
import { useTranslation } from "react-i18next";
import SettingsTitle from "@/components/settings/settings-title";
import { getAppName, getAppUrl } from "@/lib/config";
import { ApiKeyTable } from "@/ee/api-key/components/api-key-table";
import { CreateApiKeyModal } from "@/ee/api-key/components/create-api-key-modal";
import { ApiKeyCreatedModal } from "@/ee/api-key/components/api-key-created-modal";
import { UpdateApiKeyModal } from "@/ee/api-key/components/update-api-key-modal";
import { RevokeApiKeyModal } from "@/ee/api-key/components/revoke-api-key-modal";
import Paginate from "@/components/common/paginate";
import { useCursorPaginate } from "@/hooks/use-cursor-paginate";
import { useGetApiKeysQuery } from "@/ee/api-key/queries/api-key-query.ts";
import type { ApiKeyType, IApiKey } from "@/ee/api-key";
import { useAtom } from "jotai";
import { workspaceAtom } from "@/features/user/atoms/current-user-atom.ts";
import useUserRole from "@/hooks/use-user-role.tsx";
import { resolveMcpMode } from "@/features/workspace/lib/mcp-mode";

interface UserApiKeysProps {
  keyType: ApiKeyType;
}

export default function UserApiKeys({ keyType }: UserApiKeysProps) {
  const { t } = useTranslation();
  const { cursor, goNext, goPrev } = useCursorPaginate();
  const [createModalOpened, setCreateModalOpened] = useState(false);
  const [createdApiKey, setCreatedApiKey] = useState<IApiKey | null>(null);
  const [updateModalOpened, setUpdateModalOpened] = useState(false);
  const [revokeModalOpened, setRevokeModalOpened] = useState(false);
  const [selectedApiKey, setSelectedApiKey] = useState<IApiKey | null>(null);
  const { data, isLoading } = useGetApiKeysQuery({ cursor, keyType });
  const [workspace] = useAtom(workspaceAtom);
  const { isAdmin } = useUserRole();
  const restrictToAdmins = workspace?.settings?.api?.restrictToAdmins === true;
  const canCreateByRole = !restrictToAdmins || isAdmin;
  const isRest = keyType === "rest";
  const mcpDisabled =
    !isRest && resolveMcpMode(workspace?.settings?.ai) === "off";
  const pageTitle = isRest ? t("REST API keys") : t("MCP keys");

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
          {pageTitle} - {getAppName()}
        </title>
      </Helmet>

      <SettingsTitle title={pageTitle} />

      <Text size="sm" c="dimmed" mb="md">
        {isRest
          ? t("Manage keys used to access the REST API.")
          : t("Manage keys used to connect MCP clients.")}
      </Text>

      {!isRest && (
        <Alert
          variant="light"
          color="blue"
          mb="md"
          p="sm"
          icon={<IconInfoCircle />}
        >
          <Stack gap={4}>
            <Text size="sm" fw={500}>
              {t("MCP server URL")}
            </Text>
            <Code
              style={{ overflowWrap: "anywhere" }}
            >{`${getAppUrl()}/mcp`}</Code>
          </Stack>
        </Alert>
      )}

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

      {canCreateByRole ? (
        <Group justify="flex-end" mb="md">
          <Button
            disabled={mcpDisabled}
            onClick={() => setCreateModalOpened(true)}
          >
            {t(isRest ? "Create REST API key" : "Create MCP key")}
          </Button>
        </Group>
      ) : restrictToAdmins ? (
        <Alert
          variant="light"
          color="yellow"
          mb="md"
          p="sm"
          icon={<IconInfoCircle />}
        >
          <Text size="sm">
            {t(
              "API key creation is restricted to admins by your workspace administrator.",
            )}
          </Text>
        </Alert>
      ) : null}

      <ApiKeyTable
        apiKeys={data?.items || []}
        keyType={keyType}
        isLoading={isLoading}
        emptyText={t(isRest ? "No REST API keys yet." : "No MCP keys yet.")}
        onUpdate={handleUpdate}
        onRevoke={handleRevoke}
      />

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
        onSuccess={setCreatedApiKey}
        keyType={keyType}
      />

      <ApiKeyCreatedModal
        opened={!!createdApiKey}
        onClose={() => setCreatedApiKey(null)}
        apiKey={createdApiKey}
      />

      <UpdateApiKeyModal
        opened={updateModalOpened}
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
