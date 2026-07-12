import { ApiKeyScope } from "@/ee/api-key/types/api-key.types";

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
  const normalized = [...scopes].sort().join(",");
  const preset = API_KEY_SCOPE_PRESETS.find(
    (item) => [...item.scopes].sort().join(",") === normalized,
  );

  return preset?.label || "Custom";
}
