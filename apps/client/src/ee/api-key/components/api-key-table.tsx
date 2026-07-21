import { ActionIcon, Badge, Group, Menu, Table, Text } from "@mantine/core";
import { IconDots, IconEdit, IconTrash } from "@tabler/icons-react";
import { useTranslation } from "react-i18next";
import { ApiKeyType, IApiKey } from "@/ee/api-key";
import { CustomAvatar } from "@/components/ui/custom-avatar.tsx";
import React from "react";
import NoTableResults from "@/components/common/no-table-results";
import { formatLocalized, useDateFnsLocale } from "@/lib/date-locale.ts";
import { getApiKeyScopeLabel } from "@/ee/api-key/lib/api-key-scopes";
import { SpaceAccessSummary } from "@/ee/space-access";

interface ApiKeyTableProps {
  apiKeys: IApiKey[];
  keyType: ApiKeyType;
  isLoading?: boolean;
  showUserColumn?: boolean;
  updateActionLabel?: string;
  onUpdate?: (apiKey: IApiKey) => void;
  onRevoke?: (apiKey: IApiKey) => void;
  emptyText?: string;
}

export function ApiKeyTable({
  apiKeys,
  keyType,
  isLoading,
  showUserColumn = false,
  updateActionLabel = "Edit",
  onUpdate,
  onRevoke,
  emptyText,
}: ApiKeyTableProps) {
  const { t } = useTranslation();
  const locale = useDateFnsLocale();

  const formatDate = (date: Date | string | null) => {
    if (!date) return t("Never");
    return formatLocalized(date, "MMM dd, yyyy", "PP", locale);
  };

  const isExpired = (expiresAt: string | null) => {
    if (!expiresAt) return false;
    return new Date(expiresAt) < new Date();
  };

  const getStatuses = (apiKey: IApiKey) => {
    const statuses: Array<{ color: string; label: string }> = [];

    if (
      keyType === "mcp" &&
      apiKey.spaceAccess?.status === "no_effective_spaces"
    ) {
      statuses.push({ color: "red", label: t("No effective spaces") });
    }
    if (isExpired(apiKey.expiresAt)) {
      statuses.push({ color: "red", label: t("Expired") });
    }
    if (statuses.length === 0) {
      statuses.push({ color: "green", label: t("Active") });
    }

    return statuses;
  };

  return (
    <Table.ScrollContainer minWidth={keyType === "mcp" ? 880 : 720}>
      <Table
        highlightOnHover
        verticalSpacing="sm"
        aria-busy={isLoading || undefined}
      >
        <Table.Thead>
          <Table.Tr>
            <Table.Th>{t("Name")}</Table.Th>
            {showUserColumn && <Table.Th>{t("User")}</Table.Th>}
            <Table.Th>{t("Access")}</Table.Th>
            {keyType === "mcp" && <Table.Th>{t("Space access")}</Table.Th>}
            <Table.Th>{t("Status")}</Table.Th>
            <Table.Th>{t("Last used")}</Table.Th>
            <Table.Th>{t("Expires")}</Table.Th>
            <Table.Th>{t("Created")}</Table.Th>
            <Table.Th aria-label={t("Action")} />
          </Table.Tr>
        </Table.Thead>

        <Table.Tbody>
          {apiKeys && apiKeys.length > 0 ? (
            apiKeys.map((apiKey: IApiKey) => (
              <Table.Tr key={apiKey.id}>
                <Table.Td>
                  <Text fz="sm" fw={500}>
                    {apiKey.name}
                  </Text>
                </Table.Td>

                {showUserColumn && apiKey.creator && (
                  <Table.Td>
                    <Group gap="4" wrap="nowrap">
                      <CustomAvatar
                        avatarUrl={apiKey.creator?.avatarUrl}
                        name={apiKey.creator.name}
                        size="sm"
                      />
                      <Text fz="sm" lineClamp={1}>
                        {apiKey.creator.name}
                      </Text>
                    </Group>
                  </Table.Td>
                )}

                <Table.Td>
                  <Text fz="sm" fw={500}>
                    {t(getApiKeyScopeLabel(apiKey.scopes))}
                  </Text>
                </Table.Td>

                {keyType === "mcp" && (
                  <Table.Td>
                    <SpaceAccessSummary
                      access={apiKey.spaceAccess}
                      showStatus={false}
                    />
                  </Table.Td>
                )}

                <Table.Td>
                  <Group gap={4} wrap="nowrap">
                    {getStatuses(apiKey).map((status) => (
                      <Badge
                        key={status.label}
                        variant="light"
                        color={status.color}
                      >
                        {status.label}
                      </Badge>
                    ))}
                  </Group>
                </Table.Td>

                <Table.Td>
                  <Text fz="sm" style={{ whiteSpace: "nowrap" }}>
                    {formatDate(apiKey.lastUsedAt)}
                  </Text>
                </Table.Td>

                <Table.Td>
                  {apiKey.expiresAt ? (
                    isExpired(apiKey.expiresAt) ? (
                      <Text fz="sm" style={{ whiteSpace: "nowrap" }}>
                        {t("Expired")}
                      </Text>
                    ) : (
                      <Text fz="sm" style={{ whiteSpace: "nowrap" }}>
                        {formatDate(apiKey.expiresAt)}
                      </Text>
                    )
                  ) : (
                    <Text fz="sm" style={{ whiteSpace: "nowrap" }}>
                      {t("Never")}
                    </Text>
                  )}
                </Table.Td>

                <Table.Td>
                  <Text fz="sm" style={{ whiteSpace: "nowrap" }}>
                    {formatDate(apiKey.createdAt)}
                  </Text>
                </Table.Td>

                <Table.Td>
                  <Menu position="bottom-end" withinPortal>
                    <Menu.Target>
                      <ActionIcon
                        variant="subtle"
                        color="gray"
                        aria-label={t("API key menu")}
                      >
                        <IconDots size={16} />
                      </ActionIcon>
                    </Menu.Target>
                    <Menu.Dropdown>
                      {onUpdate && (
                        <Menu.Item
                          leftSection={<IconEdit size={16} />}
                          onClick={() => onUpdate(apiKey)}
                        >
                          {t(updateActionLabel)}
                        </Menu.Item>
                      )}
                      {onRevoke && (
                        <Menu.Item
                          leftSection={<IconTrash size={16} />}
                          color="red"
                          onClick={() => onRevoke(apiKey)}
                        >
                          {t("Revoke")}
                        </Menu.Item>
                      )}
                    </Menu.Dropdown>
                  </Menu>
                </Table.Td>
              </Table.Tr>
            ))
          ) : (
            <NoTableResults
              colSpan={(showUserColumn ? 1 : 0) + (keyType === "mcp" ? 8 : 7)}
              text={isLoading ? t("Loading API keys") : emptyText}
              announce={isLoading}
            />
          )}
        </Table.Tbody>
      </Table>
    </Table.ScrollContainer>
  );
}
