export const ApiKeyScope = {
  REST_READ: 'rest:read',
  REST_WRITE: 'rest:write',
  MCP_READ: 'mcp:read',
  MCP_WRITE: 'mcp:write',
  MCP_DESTRUCTIVE: 'mcp:destructive',
} as const;

export type ApiKeyScope = (typeof ApiKeyScope)[keyof typeof ApiKeyScope];

export const API_KEY_SCOPES = Object.values(ApiKeyScope);

export const DEFAULT_API_KEY_SCOPES: ApiKeyScope[] = [
  ApiKeyScope.REST_READ,
  ApiKeyScope.REST_WRITE,
  ApiKeyScope.MCP_READ,
  ApiKeyScope.MCP_WRITE,
];

export const LEGACY_API_KEY_SCOPES: ApiKeyScope[] = [
  ApiKeyScope.REST_READ,
  ApiKeyScope.REST_WRITE,
];

export function normalizeApiKeyScopes(
  scopes?: string[] | null,
  fallback: ApiKeyScope[] = DEFAULT_API_KEY_SCOPES,
): ApiKeyScope[] {
  const source = scopes?.length ? scopes : fallback;
  const normalized = new Set(
    source.filter((scope): scope is ApiKeyScope =>
      API_KEY_SCOPES.includes(scope as ApiKeyScope),
    ),
  );

  if (normalized.has(ApiKeyScope.REST_WRITE)) {
    normalized.add(ApiKeyScope.REST_READ);
  }
  if (normalized.has(ApiKeyScope.MCP_WRITE)) {
    normalized.add(ApiKeyScope.MCP_READ);
  }
  if (normalized.has(ApiKeyScope.MCP_DESTRUCTIVE)) {
    normalized.add(ApiKeyScope.MCP_WRITE);
    normalized.add(ApiKeyScope.MCP_READ);
  }

  return API_KEY_SCOPES.filter((scope) => normalized.has(scope));
}

export function hasApiKeyScope(
  scopes: string[] | null | undefined,
  scope: ApiKeyScope,
) {
  return normalizeApiKeyScopes(scopes, LEGACY_API_KEY_SCOPES).includes(scope);
}
