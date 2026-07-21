import { SegmentedControl, Stack, Switch, Text } from "@mantine/core";
import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import type { ApiKeyScope, ApiKeyType } from "@/ee/api-key/types/api-key.types";

interface ApiKeyScopeSelectorProps {
  keyType: ApiKeyType;
  scopes: ApiKeyScope[];
  onChange: (value: ApiKeyScope[]) => void;
  error?: ReactNode;
  allowWrite?: boolean;
}

export function ApiKeyScopeSelector({
  keyType,
  scopes,
  onChange,
  error,
  allowWrite = true,
}: ApiKeyScopeSelectorProps) {
  const { t } = useTranslation();
  const canWrite = scopes.includes(`${keyType}:write` as ApiKeyScope);
  const destructiveEnabled = scopes.includes("mcp:destructive");

  const updateAccess = (access: string) => {
    if (access === "read-write") {
      onChange([
        `${keyType}:read` as ApiKeyScope,
        `${keyType}:write` as ApiKeyScope,
      ]);
      return;
    }

    onChange([`${keyType}:read` as ApiKeyScope]);
  };

  return (
    <Stack gap="sm">
      <div>
        <Text size="sm" fw={500} mb={6}>
          {t("Access")}
        </Text>
        <SegmentedControl
          value={canWrite ? "read-write" : "read-only"}
          onChange={updateAccess}
          data={[
            { label: t("Read only"), value: "read-only" },
            {
              label: t("Read and write"),
              value: "read-write",
              disabled: !allowWrite,
            },
          ]}
          withItemsBorders={false}
          fullWidth
          aria-label={t("API key access")}
        />
        {error && (
          <Text c="red" size="xs" mt={4}>
            {error}
          </Text>
        )}
      </div>

      {keyType === "mcp" && (
        <Switch
          checked={destructiveEnabled}
          disabled={!canWrite || !allowWrite}
          label={t("Destructive MCP tools")}
          description={t(
            "Allow explicitly confirmed page trash operations through MCP.",
          )}
          onChange={(event) =>
            onChange(
              event.currentTarget.checked
                ? ["mcp:read", "mcp:write", "mcp:destructive"]
                : ["mcp:read", "mcp:write"],
            )
          }
        />
      )}
    </Stack>
  );
}
