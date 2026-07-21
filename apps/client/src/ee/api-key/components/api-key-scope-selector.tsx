import { Alert, MultiSelect, Select, Stack } from "@mantine/core";
import { IconInfoCircle } from "@tabler/icons-react";
import React from "react";
import { useTranslation } from "react-i18next";
import {
  API_KEY_SCOPE_OPTIONS,
  API_KEY_SCOPE_PRESETS,
} from "@/ee/api-key/lib/api-key-scopes";
import { ApiKeyScope } from "@/ee/api-key/types/api-key.types";

interface ApiKeyScopeSelectorProps {
  scopePreset: string;
  customScopes: ApiKeyScope[];
  onScopePresetChange: (value: string) => void;
  onCustomScopesChange: (value: ApiKeyScope[]) => void;
  mcpOnly?: boolean;
  error?: React.ReactNode;
}

export function ApiKeyScopeSelector({
  scopePreset,
  customScopes,
  onScopePresetChange,
  onCustomScopesChange,
  mcpOnly = false,
  error,
}: ApiKeyScopeSelectorProps) {
  const { t } = useTranslation();
  const presets = API_KEY_SCOPE_PRESETS.filter(
    (preset) =>
      !mcpOnly ||
      preset.value === "custom" ||
      preset.scopes.every((scope) => scope.startsWith("mcp:")),
  );
  const scopeOptions = API_KEY_SCOPE_OPTIONS.filter(
    (scope) => !mcpOnly || scope.value.startsWith("mcp:"),
  );

  return (
    <Stack gap="sm">
      {mcpOnly && (
        <Alert variant="light" color="blue" icon={<IconInfoCircle />} p="sm">
          {t(
            "Space-restricted access supports MCP scopes only. REST scopes are unavailable.",
          )}
        </Alert>
      )}

      <Select
        label={t("Usage type")}
        data={presets.map((preset) => ({
          value: preset.value,
          label: t(preset.label),
        }))}
        value={scopePreset}
        onChange={(value) => onScopePresetChange(value || "mcp-read")}
        allowDeselect={false}
        error={scopePreset === "custom" ? undefined : error}
      />

      {scopePreset === "custom" && (
        <MultiSelect
          label={t("Scopes")}
          data={scopeOptions}
          value={customScopes}
          onChange={(value) => onCustomScopesChange(value as ApiKeyScope[])}
          required
          error={error}
        />
      )}
    </Stack>
  );
}
