import { ApiKeyScope } from "@/ee/api-key/types/api-key.types";
import type { SpaceAccessInput } from "@/ee/space-access";

export const API_KEY_SCOPE_OPTIONS: Array<{
  value: ApiKeyScope;
  label: ApiKeyScope;
}> = [
  { value: "rest:read", label: "rest:read" },
  { value: "rest:write", label: "rest:write" },
  { value: "mcp:read", label: "mcp:read" },
  { value: "mcp:write", label: "mcp:write" },
  { value: "mcp:destructive", label: "mcp:destructive" },
];

export const API_KEY_SCOPE_PRESETS: Array<{
  value: string;
  label: string;
  scopes: ApiKeyScope[];
}> = [
  {
    value: "full",
    label: "Full access",
    scopes: ["rest:read", "rest:write", "mcp:read", "mcp:write"],
  },
  {
    value: "rest-read",
    label: "REST read-only",
    scopes: ["rest:read"],
  },
  {
    value: "rest-write",
    label: "REST read-write",
    scopes: ["rest:read", "rest:write"],
  },
  {
    value: "mcp-read",
    label: "MCP read-only",
    scopes: ["mcp:read"],
  },
  {
    value: "mcp-write",
    label: "MCP read-write",
    scopes: ["mcp:read", "mcp:write"],
  },
  {
    value: "mcp-maintenance",
    label: "MCP maintenance",
    scopes: ["mcp:read", "mcp:write", "mcp:destructive"],
  },
  {
    value: "custom",
    label: "Custom",
    scopes: ["rest:read", "rest:write"],
  },
];

export function getApiKeyScopeLabel(scopes: ApiKeyScope[] = []) {
  return getApiKeyScopePreset(scopes)?.label || "Custom";
}

export function getApiKeyScopePreset(scopes: ApiKeyScope[] = []) {
  const normalized = [...scopes].sort().join(",");
  const preset = API_KEY_SCOPE_PRESETS.find(
    (item) =>
      item.value !== "custom" &&
      [...item.scopes].sort().join(",") === normalized,
  );

  return preset;
}

export function getApiKeyScopePresetValue(scopes: ApiKeyScope[] = []) {
  return getApiKeyScopePreset(scopes)?.value || "custom";
}

export function resolveApiKeyScopes(
  scopePreset: string,
  customScopes: ApiKeyScope[],
) {
  if (scopePreset === "custom") {
    return customScopes;
  }

  return (
    API_KEY_SCOPE_PRESETS.find((preset) => preset.value === scopePreset)
      ?.scopes || []
  );
}

export function restrictApiKeyScopesToMcp(scopes: ApiKeyScope[]) {
  const mcpScopes = scopes.filter((scope) => scope.startsWith("mcp:"));
  return mcpScopes.length > 0 ? mcpScopes : (["mcp:read"] as ApiKeyScope[]);
}

export function hasRestApiKeyScope(scopes: ApiKeyScope[]) {
  return scopes.some((scope) => scope.startsWith("rest:"));
}

export type ApiKeyConfigurationError =
  | "missing_scope"
  | "missing_space"
  | "rest_scope_with_selected_spaces";

export function getApiKeyConfigurationError(
  scopes: ApiKeyScope[],
  spaceAccess: SpaceAccessInput,
): ApiKeyConfigurationError | null {
  if (spaceAccess.mode === "selected" && spaceAccess.spaceIds.length === 0) {
    return "missing_space";
  }
  if (scopes.length === 0) {
    return "missing_scope";
  }
  if (spaceAccess.mode === "selected" && hasRestApiKeyScope(scopes)) {
    return "rest_scope_with_selected_spaces";
  }

  return null;
}
