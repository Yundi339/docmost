import {
  Group,
  List,
  Text,
  TextInput,
  ActionIcon,
  Tooltip,
  Stack,
  Alert,
  SegmentedControl,
} from "@mantine/core";
import { useAtom } from "jotai";
import { workspaceAtom } from "@/features/user/atoms/current-user-atom.ts";
import React, { useState } from "react";
import { useTranslation } from "react-i18next";
import { updateWorkspace } from "@/features/workspace/services/workspace-service.ts";
import { notifications } from "@mantine/notifications";
import { useHasFeature } from "@/ee/hooks/use-feature";
import { Feature } from "@/ee/features";
import { useUpgradeLabel } from "@/ee/hooks/use-upgrade-label";
import { getAppUrl } from "@/lib/config.ts";
import { IconCheck, IconCopy, IconInfoCircle } from "@tabler/icons-react";
import { CopyButton } from "@/components/common/copy-button.tsx";

export default function McpSettings() {
  const { t } = useTranslation();
  const [workspace, setWorkspace] = useAtom(workspaceAtom);
  const [mode, setMode] = useState(resolveMcpMode(workspace?.settings?.ai));
  const hasAccess = useHasFeature(Feature.MCP);
  const upgradeLabel = useUpgradeLabel();

  const mcpUrl = `${getAppUrl()}/mcp`;

  const handleChange = async (value: string) => {
    try {
      const updatedWorkspace = await updateWorkspace({ mcpMode: value as any });
      setMode(value as McpMode);
      setWorkspace(updatedWorkspace);
    } catch (err) {
      notifications.show({
        message: err?.response?.data?.message,
        color: "red",
      });
    }
  };

  return (
    <Stack gap="lg">
      {!hasAccess && (
        <Alert icon={<IconInfoCircle />} title={upgradeLabel} color="blue">
          {t("MCP is only available in the enterprise edition.")}
        </Alert>
      )}

      <Group justify="space-between" wrap="nowrap" gap="xl">
        <div>
          <Text size="md">{t("Model Context Protocol (MCP)")}</Text>
          <Text size="sm" c="dimmed">
            {t(
              "Enable the MCP server to allow AI assistants and tools to interact with your workspace content.",
            )}
          </Text>
        </div>

        <Tooltip label={upgradeLabel} disabled={hasAccess}>
          <SegmentedControl
            value={mode}
            onChange={handleChange}
            disabled={!hasAccess}
            data={[
              { value: "off", label: t("Off") },
              { value: "read-only", label: t("Read-only") },
              { value: "read-write", label: t("Read-write") },
            ]}
          />
        </Tooltip>
      </Group>

      {mode !== "off" && (
        <div>
          <Text size="sm" fw={500} mb={4}>
            {t("MCP Server URL")}
          </Text>
          <Group gap="xs">
            <TextInput value={mcpUrl} readOnly style={{ flex: 1 }} />
            <CopyButton value={mcpUrl} timeout={2000}>
              {({ copied, copy }) => (
                <Tooltip
                  label={copied ? t("Copied") : t("Copy")}
                  withArrow
                  position="right"
                >
                  <ActionIcon
                    color={copied ? "teal" : "gray"}
                    variant="subtle"
                    onClick={copy}
                  >
                    {copied ? <IconCheck size={16} /> : <IconCopy size={16} />}
                  </ActionIcon>
                </Tooltip>
              )}
            </CopyButton>
          </Group>
          <Text size="sm" c="dimmed" mt="xs">
            {t(
              mode === "read-only"
                ? "Use an API key with mcp:read scope for authentication."
                : "Use an API key with mcp:write scope for write tools.",
            )}
          </Text>

          <div>
            <Text size="sm" fw={500} mt="md" mb={4}>
              {t("Supported tools")}
            </Text>
            <List size="sm" spacing={2}>
              <List.Item>
                <Text size="sm" c="dimmed" span>
                  search_pages, get_page, create_page, update_page
                </Text>
              </List.Item>
              <List.Item>
                <Text size="sm" c="dimmed" span>
                  list_pages, list_child_pages, duplicate_page
                </Text>
              </List.Item>
              <List.Item>
                <Text size="sm" c="dimmed" span>
                  copy_page_to_space, move_page, move_page_to_space
                </Text>
              </List.Item>
              <List.Item>
                <Text size="sm" c="dimmed" span>
                  get_space, list_spaces, create_space, update_space
                </Text>
              </List.Item>
              <List.Item>
                <Text size="sm" c="dimmed" span>
                  get_comments, create_comment, update_comment
                </Text>
              </List.Item>
              <List.Item>
                <Text size="sm" c="dimmed" span>
                  search_attachments, list_workspace_members, get_current_user
                </Text>
              </List.Item>
            </List>
          </div>
        </div>
      )}
    </Stack>
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
