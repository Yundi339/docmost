export const ApiKeyScope = {
  REST_READ: 'rest:read',
  REST_WRITE: 'rest:write',
  MCP_READ: 'mcp:read',
  MCP_WRITE: 'mcp:write',
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
  return Array.from(
    new Set(
      source.filter((scope): scope is ApiKeyScope =>
        API_KEY_SCOPES.includes(scope as ApiKeyScope),
      ),
    ),
  );
}

export function hasApiKeyScope(
  scopes: string[] | null | undefined,
  scope: ApiKeyScope,
) {
  return normalizeApiKeyScopes(scopes, LEGACY_API_KEY_SCOPES).includes(scope);
}
