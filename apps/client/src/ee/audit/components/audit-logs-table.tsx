import { Fragment, useState } from "react";
import {
  Table,
  Text,
  Group,
  Skeleton,
  Anchor,
  Collapse,
  Box,
  Stack,
} from "@mantine/core";
import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import {
  IconChevronRight,
  IconChevronDown,
  IconArrowRight,
} from "@tabler/icons-react";
import { IAuditLog } from "@/ee/audit/types/audit.types";
import { CustomAvatar } from "@/components/ui/custom-avatar";
import { getEventLabel } from "@/ee/audit/lib/audit-event-labels";
import { formattedDateWithSeconds } from "@/lib/time";
import { buildPageUrl } from "@/features/page/page.utils";
import NoTableResults from "@/components/common/no-table-results";
import classes from "./audit-logs.module.css";
import {
  formatAuditPrimitive,
  getAuditFieldLabel,
  getMcpToolLabel,
  getVisibleAuditMetadataEntries,
} from "@/ee/audit/lib/audit-display";

type AuditLogsTableProps = {
  items?: IAuditLog[];
  isLoading: boolean;
};

function hasDetails(entry: IAuditLog): boolean {
  return !!(
    entry.changes?.before ||
    entry.changes?.after ||
    entry.metadata ||
    entry.resource ||
    entry.ipAddress
  );
}

function getResourceUrl(entry: IAuditLog): string | null {
  if (!entry.resource) return null;

  if (
    entry.resource.type === "page" &&
    entry.resource.slugId &&
    entry.resource.spaceSlug &&
    !entry.resource.deleted
  ) {
    return buildPageUrl(
      entry.resource.spaceSlug,
      entry.resource.slugId,
      entry.resource.name,
    );
  }

  if (entry.resource.type === "space" && entry.resource.slug) {
    return `/s/${entry.resource.slug}`;
  }

  switch (entry.resourceType) {
    case "group":
      return `/settings/groups/${entry.resource.id}`;
    case "space":
    case "space_member":
      return entry.resource.slug ? `/s/${entry.resource.slug}` : null;
    default:
      return null;
  }
}

function getMcpAuditResource(entry: IAuditLog): {
  primary: string;
  secondary?: string;
} | null {
  const metadata = entry.metadata;
  if (!metadata) return null;

  if (entry.resourceType === "mcp_tool") {
    const toolName =
      typeof metadata.toolName === "string" ? metadata.toolName : null;
    if (!toolName) return null;

    const result = metadata.result as Record<string, unknown> | undefined;
    const target = metadata.target as Record<string, unknown> | undefined;
    const name = [
      entry.resource?.path,
      result?.title,
      result?.name,
      target?.title,
    ].find(
      (value): value is string => typeof value === "string" && value.length > 0,
    );
    const id = [
      result?.id,
      target?.pageId,
      target?.commentId,
      target?.spaceId,
    ].find(
      (value): value is string => typeof value === "string" && value.length > 0,
    );

    return {
      primary: toolName,
      secondary: name ?? (id ? id.slice(0, 8) : undefined),
    };
  }

  if (entry.resourceType === "mcp_oauth_authorization") {
    const clientName =
      typeof metadata.clientName === "string" ? metadata.clientName : "OAuth";
    return {
      primary: clientName,
      secondary:
        typeof metadata.redirectHost === "string"
          ? metadata.redirectHost
          : undefined,
    };
  }

  if (entry.resourceType === "mcp_oauth_client") {
    return {
      primary:
        typeof metadata.clientName === "string"
          ? metadata.clientName
          : "MCP OAuth",
      secondary:
        typeof metadata.provider === "string" ? metadata.provider : undefined,
    };
  }

  return null;
}

function AuditValue({
  fieldKey,
  value,
}: {
  fieldKey: string;
  value: unknown;
}) {
  const { t } = useTranslation();

  if (Array.isArray(value)) {
    return (
      <Text fz="xs" style={{ overflowWrap: "anywhere" }}>
        {value.length > 0
          ? value
              .map((item) => formatAuditPrimitive(item, fieldKey, t))
              .join(", ")
          : "—"}
      </Text>
    );
  }

  if (value && typeof value === "object") {
    return (
      <Stack gap={2} pl="xs">
        {Object.entries(value).map(([nestedKey, nestedValue]) => (
          <Group key={nestedKey} gap={6} wrap="nowrap" align="flex-start">
            <Text fz="xs" c="dimmed" fw={500}>
              {t(getAuditFieldLabel(nestedKey))}:
            </Text>
            <AuditValue fieldKey={nestedKey} value={nestedValue} />
          </Group>
        ))}
      </Stack>
    );
  }

  return (
    <Text fz="xs" component="span" style={{ overflowWrap: "anywhere" }}>
      {formatAuditPrimitive(value, fieldKey, t)}
    </Text>
  );
}

function ChangesDiff({ changes }: { changes: IAuditLog["changes"] }) {
  const { t } = useTranslation();
  if (!changes) return null;

  const { before, after } = changes;
  const allKeys = new Set([
    ...Object.keys(before ?? {}),
    ...Object.keys(after ?? {}),
  ]);

  if (allKeys.size === 0) return null;

  return (
    <Box>
      <Text fz="xs" fw={600} mb={4}>
        {t("Changes")}
      </Text>
      {[...allKeys].map((key) => {
        const hasBefore = before && key in before;
        const hasAfter = after && key in after;

        return (
          <Group key={key} gap={6} mb={2} wrap="nowrap" align="center">
            <Text
              fz="xs"
              c="dimmed"
              fw={500}
              style={{ minWidth: "fit-content" }}
            >
              {t(getAuditFieldLabel(key))}:
            </Text>
            {hasBefore && (
              <AuditValue fieldKey={key} value={before[key]} />
            )}
            {hasBefore && hasAfter && (
              <IconArrowRight size={10} color="var(--mantine-color-dimmed)" />
            )}
            {hasAfter && (
              <AuditValue fieldKey={key} value={after[key]} />
            )}
          </Group>
        );
      })}
    </Box>
  );
}

function MetadataDisplay({ metadata }: { metadata: Record<string, any> }) {
  const { t } = useTranslation();
  const entries = getVisibleAuditMetadataEntries(metadata);
  if (entries.length === 0) return null;

  return (
    <Box>
      <Text fz="xs" fw={600} mb={4}>
        {t("Metadata")}
      </Text>
      {entries.map(([key, value]) => (
        <Group key={key} gap={6} mb={2} wrap="nowrap" align="flex-start">
          <Text fz="xs" c="dimmed" fw={500}>
            {t(getAuditFieldLabel(key))}:
          </Text>
          <AuditValue fieldKey={key} value={value} />
        </Group>
      ))}
    </Box>
  );
}

function RequestDisplay({ entry }: { entry: IAuditLog }) {
  const { t } = useTranslation();
  if (!entry.ipAddress) return null;

  return (
    <Box>
      <Text fz="xs" fw={600} mb={4}>
        {t("Request")}
      </Text>
      <Group gap={6} mb={2} wrap="nowrap">
        <Text fz="xs" c="dimmed" fw={500}>
          {t("IP address")}:
        </Text>
        <Text fz="xs">{entry.ipAddress}</Text>
      </Group>
    </Box>
  );
}

function ResourceDetails({ entry }: { entry: IAuditLog }) {
  const { t } = useTranslation();
  const resource = entry.resource;
  if (!resource) return null;

  return (
    <Box>
      <Text fz="xs" fw={600} mb={4}>
        {t("Resource details")}
      </Text>
      {resource.spaceName && (
        <Group gap={6} mb={2} wrap="nowrap">
          <Text fz="xs" c="dimmed" fw={500}>
            {t("Space")}:
          </Text>
          <Text fz="xs">{resource.spaceName}</Text>
        </Group>
      )}
      {resource.path && (
        <Group gap={6} mb={2} wrap="nowrap" align="flex-start">
          <Text fz="xs" c="dimmed" fw={500}>
            {t("Path")}:
          </Text>
          <Text fz="xs">{resource.path}</Text>
        </Group>
      )}
      <Group gap={6} mb={2} wrap="nowrap">
        <Text fz="xs" c="dimmed" fw={500}>
          {t("Resource ID")}:
        </Text>
        <Text fz="xs" ff="monospace">
          {resource.id}
        </Text>
      </Group>
      {resource.deleted && (
        <Text fz="xs" c="dimmed">
          {t("Deleted")}
        </Text>
      )}
    </Box>
  );
}

function TableSkeleton() {
  return (
    <>
      {Array.from({ length: 8 }).map((_, i) => (
        <Table.Tr key={i}>
          <Table.Td>
            <Group gap="sm" wrap="nowrap">
              <Skeleton circle height={36} />
              <div>
                <Skeleton height={14} width={120} mb={4} />
                <Skeleton height={10} width={160} />
              </div>
            </Group>
          </Table.Td>
          <Table.Td>
            <Skeleton height={14} width={140} />
          </Table.Td>
          <Table.Td>
            <Skeleton height={14} width={120} />
          </Table.Td>
          <Table.Td>
            <Skeleton height={14} width={120} />
          </Table.Td>
        </Table.Tr>
      ))}
    </>
  );
}

function ResourceCell({ entry }: { entry: IAuditLog }) {
  const { t } = useTranslation();
  const mcpResource = getMcpAuditResource(entry);
  const url = getResourceUrl(entry);
  if (mcpResource) {
    const content = (
      <div className={classes.resourceLinkText}>
        <Text fz="sm" fw={500} lineClamp={1}>
          {entry.resourceType === "mcp_tool"
            ? t(getMcpToolLabel(mcpResource.primary))
            : mcpResource.primary}
        </Text>
        {mcpResource.secondary && (
          <Text fz="xs" c="dimmed" lineClamp={1}>
            {mcpResource.secondary}
          </Text>
        )}
      </div>
    );
    return url ? (
      <Anchor
        component={Link}
        to={url}
        underline="never"
        style={{ color: "var(--mantine-color-text)" }}
      >
        {content}
      </Anchor>
    ) : (
      content
    );
  }

  if (!entry.resource?.name) {
    return (
      <Text fz="sm" c="dimmed">
        —
      </Text>
    );
  }

  if (url) {
    return (
      <Anchor
        size="sm"
        underline="never"
        style={{
          cursor: "pointer",
          color: "var(--mantine-color-text)",
        }}
        component={Link}
        to={url}
      >
        <div className={classes.resourceLinkText}>
          <Text fz="sm" fw={500} lineClamp={1}>
            {entry.resource.name}
          </Text>
          {entry.resource.path && (
            <Text fz="xs" c="dimmed" lineClamp={1}>
              {entry.resource.path}
            </Text>
          )}
        </div>
      </Anchor>
    );
  }

  return (
    <div>
      <Text fz="sm" lineClamp={1}>
        {entry.resource.name}
      </Text>
      {entry.resource.path && (
        <Text fz="xs" c="dimmed" lineClamp={1}>
          {entry.resource.path}
        </Text>
      )}
    </div>
  );
}

export default function AuditLogsTable({
  items,
  isLoading,
}: AuditLogsTableProps) {
  const { t } = useTranslation();
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  const toggleExpanded = (id: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  return (
    <Table.ScrollContainer minWidth={700}>
      <Table highlightOnHover verticalSpacing="xs" className={classes.table}>
        <Table.Thead>
          <Table.Tr>
            <Table.Th>{t("Actor")}</Table.Th>
            <Table.Th>{t("Event")}</Table.Th>
            <Table.Th>{t("Resource")}</Table.Th>
            <Table.Th>{t("Date")}</Table.Th>
          </Table.Tr>
        </Table.Thead>

        <Table.Tbody>
          {isLoading ? (
            <TableSkeleton />
          ) : items && items.length > 0 ? (
            items.map((entry) => {
              const expandable = hasDetails(entry);
              const isExpanded = expanded.has(entry.id);

              return (
                <Fragment key={entry.id}>
                  <Table.Tr
                    onClick={
                      expandable ? () => toggleExpanded(entry.id) : undefined
                    }
                    style={{ cursor: expandable ? "pointer" : undefined }}
                  >
                    <Table.Td>
                      <Group gap="sm" wrap="nowrap">
                        {expandable ? (
                          isExpanded ? (
                            <IconChevronDown
                              size={16}
                              color="var(--mantine-color-dimmed)"
                            />
                          ) : (
                            <IconChevronRight
                              size={16}
                              color="var(--mantine-color-dimmed)"
                            />
                          )
                        ) : (
                          <Box w={16} />
                        )}
                        {entry.actor ? (
                          <Group gap="sm" wrap="nowrap">
                            <CustomAvatar
                              avatarUrl={entry.actor.avatarUrl}
                              name={entry.actor.name}
                              size={36}
                            />
                            <div>
                              <Text fz="sm" fw={500} lineClamp={1}>
                                {entry.actor.name}
                              </Text>
                              <Text fz="xs" c="dimmed">
                                {entry.actor.email}
                              </Text>
                            </div>
                          </Group>
                        ) : (
                          <Text fz="sm" c="dimmed" fs="italic">
                            {entry.actorType === "system"
                              ? t("System")
                              : t("System")}
                          </Text>
                        )}
                      </Group>
                    </Table.Td>

                    <Table.Td>
                      <Text fz="sm">{t(getEventLabel(entry.event))}</Text>
                    </Table.Td>

                    <Table.Td>
                      <ResourceCell entry={entry} />
                    </Table.Td>

                    <Table.Td>
                      <Text fz="sm" style={{ whiteSpace: "nowrap" }}>
                        {formattedDateWithSeconds(new Date(entry.createdAt))}
                      </Text>
                    </Table.Td>
                  </Table.Tr>

                  {expandable && (
                    <Table.Tr className={classes.detailRow}>
                      <Table.Td colSpan={4} p={0}>
                        <Collapse in={isExpanded}>
                          <Box
                            px="md"
                            py="sm"
                            className={classes.detailContent}
                          >
                            <Group gap="xl" align="flex-start">
                              {entry.changes && (
                                <ChangesDiff changes={entry.changes} />
                              )}
                              {entry.metadata && (
                                <MetadataDisplay metadata={entry.metadata} />
                              )}
                              {entry.resource && (
                                <ResourceDetails entry={entry} />
                              )}
                              {entry.ipAddress && (
                                <RequestDisplay entry={entry} />
                              )}
                            </Group>
                          </Box>
                        </Collapse>
                      </Table.Td>
                    </Table.Tr>
                  )}
                </Fragment>
              );
            })
          ) : (
            <NoTableResults colSpan={4} />
          )}
        </Table.Tbody>
      </Table>
    </Table.ScrollContainer>
  );
}
