export const ApiKeyScope = {
  REST_READ: 'rest:read',
  REST_WRITE: 'rest:write',
  MCP_READ: 'mcp:read',
  MCP_WRITE: 'mcp:write',
  MCP_DESTRUCTIVE: 'mcp:destructive',
} as const;

export type ApiKeyScope = (typeof ApiKeyScope)[keyof typeof ApiKeyScope];

export const API_KEY_SCOPES = Object.values(ApiKeyScope);

export const ApiKeyType = {
  REST: 'rest',
  MCP: 'mcp',
} as const;

export type ApiKeyType = (typeof ApiKeyType)[keyof typeof ApiKeyType];

export const API_KEY_TYPES = Object.values(ApiKeyType);

export const REST_API_KEY_SCOPES: ApiKeyScope[] = [
  ApiKeyScope.REST_READ,
  ApiKeyScope.REST_WRITE,
];

export const MCP_API_KEY_SCOPES: ApiKeyScope[] = [
  ApiKeyScope.MCP_READ,
  ApiKeyScope.MCP_WRITE,
  ApiKeyScope.MCP_DESTRUCTIVE,
];

export const DEFAULT_REST_API_KEY_SCOPES: ApiKeyScope[] = [
  ApiKeyScope.REST_READ,
];

export const DEFAULT_MCP_API_KEY_SCOPES: ApiKeyScope[] = [ApiKeyScope.MCP_READ];

export function normalizeApiKeyScopes(
  scopes?: string[] | null,
  fallback: ApiKeyScope[] = DEFAULT_REST_API_KEY_SCOPES,
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

export function normalizeApiKeyScopesForType(
  keyType: ApiKeyType,
  scopes?: string[] | null,
): ApiKeyScope[] | undefined {
  if (scopes === null) {
    return undefined;
  }

  const allowedScopes =
    keyType === ApiKeyType.REST ? REST_API_KEY_SCOPES : MCP_API_KEY_SCOPES;
  const defaultScopes =
    keyType === ApiKeyType.REST
      ? DEFAULT_REST_API_KEY_SCOPES
      : DEFAULT_MCP_API_KEY_SCOPES;
  const source = scopes ?? defaultScopes;

  if (
    source.length === 0 ||
    source.some((scope) => !allowedScopes.includes(scope as ApiKeyScope))
  ) {
    return undefined;
  }

  return normalizeApiKeyScopes(source, defaultScopes);
}

export function isApiKeyType(value: unknown): value is ApiKeyType {
  return API_KEY_TYPES.includes(value as ApiKeyType);
}

export function hasApiKeyScope(
  scopes: string[] | null | undefined,
  scope: ApiKeyScope,
) {
  if (!scopes?.length) {
    return false;
  }

  return normalizeApiKeyScopes(scopes, []).includes(scope);
}
