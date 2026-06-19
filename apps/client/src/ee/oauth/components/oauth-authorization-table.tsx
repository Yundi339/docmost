import { ActionIcon, Badge, Group, Table, Text, Tooltip } from "@mantine/core";
import { IconTrash } from "@tabler/icons-react";
import React from "react";
import { useTranslation } from "react-i18next";
import NoTableResults from "@/components/common/no-table-results";
import { CustomAvatar } from "@/components/ui/custom-avatar";
import { formatLocalized, useDateFnsLocale } from "@/lib/date-locale";
import { IOAuthAuthorization, OAuthScope } from "@/ee/oauth";

type OAuthAuthorizationTableProps = {
  authorizations: IOAuthAuthorization[];
  showUserColumn?: boolean;
  onRevoke?: (authorization: IOAuthAuthorization) => void;
};

export function OAuthAuthorizationTable({
  authorizations,
  showUserColumn = false,
  onRevoke,
}: OAuthAuthorizationTableProps) {
  const { t } = useTranslation();
  const locale = useDateFnsLocale();

  const formatDate = (date?: string | null) => {
    if (!date) return t("Never");
    return formatLocalized(date, "MMM dd, yyyy", "PP", locale);
  };

  return (
    <Table.ScrollContainer minWidth={700}>
      <Table highlightOnHover verticalSpacing="sm">
        <Table.Thead>
          <Table.Tr>
            <Table.Th>{t("Application")}</Table.Th>
            {showUserColumn && <Table.Th>{t("User")}</Table.Th>}
            <Table.Th>{t("Scopes")}</Table.Th>
            <Table.Th>{t("Last used")}</Table.Th>
            <Table.Th>{t("Created")}</Table.Th>
            <Table.Th aria-label={t("Action")} />
          </Table.Tr>
        </Table.Thead>
        <Table.Tbody>
          {authorizations.length > 0 ? (
            authorizations.map((authorization) => (
              <Table.Tr key={authorization.id}>
                <Table.Td>
                  <Text fz="sm" fw={500}>
                    {authorization.clientName}
                  </Text>
                  <Text fz="xs" c="dimmed" lineClamp={1}>
                    {authorization.provider}
                  </Text>
                </Table.Td>

                {showUserColumn && (
                  <Table.Td>
                    <Group gap="4" wrap="nowrap">
                      <CustomAvatar
                        avatarUrl={authorization.userAvatarUrl}
                        name={authorization.userName || authorization.userEmail}
                        size="sm"
                      />
                      <div>
                        <Text fz="sm" lineClamp={1}>
                          {authorization.userName || authorization.userEmail}
                        </Text>
                        <Text fz="xs" c="dimmed" lineClamp={1}>
                          {authorization.userEmail}
                        </Text>
                      </div>
                    </Group>
                  </Table.Td>
                )}

                <Table.Td>
                  <Group gap="xs">
                    {authorization.scopes.map((scope) => (
                      <Badge
                        key={scope}
                        variant="light"
                        color={scopeColor(scope)}
                      >
                        {t(scopeLabel(scope))}
                      </Badge>
                    ))}
                  </Group>
                </Table.Td>

                <Table.Td>
                  <Text fz="sm" style={{ whiteSpace: "nowrap" }}>
                    {formatDate(authorization.lastUsedAt)}
                  </Text>
                </Table.Td>

                <Table.Td>
                  <Text fz="sm" style={{ whiteSpace: "nowrap" }}>
                    {formatDate(authorization.createdAt)}
                  </Text>
                </Table.Td>

                <Table.Td>
                  {onRevoke && (
                    <Tooltip label={t("Revoke")}>
                      <ActionIcon
                        variant="subtle"
                        color="red"
                        aria-label={t("Revoke OAuth authorization")}
                        onClick={() => onRevoke(authorization)}
                      >
                        <IconTrash size={16} />
                      </ActionIcon>
                    </Tooltip>
                  )}
                </Table.Td>
              </Table.Tr>
            ))
          ) : (
            <NoTableResults colSpan={showUserColumn ? 6 : 5} />
          )}
        </Table.Tbody>
      </Table>
    </Table.ScrollContainer>
  );
}

function scopeLabel(scope: OAuthScope) {
  if (scope === "mcp:write") return "MCP write";
  return "MCP read";
}

function scopeColor(scope: OAuthScope) {
  if (scope === "mcp:write") return "orange";
  return "blue";
}
