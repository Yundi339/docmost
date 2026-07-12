export const OAUTH_PROVIDER_CHATGPT = 'chatgpt' as const;

export const OAuthScope = {
  MCP_READ: 'mcp:read',
  MCP_WRITE: 'mcp:write',
  MCP_DESTRUCTIVE: 'mcp:destructive',
} as const;

export type OAuthScopeValue = (typeof OAuthScope)[keyof typeof OAuthScope];

export const SUPPORTED_OAUTH_SCOPES: OAuthScopeValue[] = [
  OAuthScope.MCP_READ,
  OAuthScope.MCP_WRITE,
  OAuthScope.MCP_DESTRUCTIVE,
];

export const DEFAULT_OAUTH_SCOPES: OAuthScopeValue[] = [OAuthScope.MCP_READ];

export const OAUTH_ACCESS_TOKEN_TTL_SECONDS = 60 * 60;
export const OAUTH_AUTHORIZATION_CODE_TTL_SECONDS = 10 * 60;
export const OAUTH_REFRESH_TOKEN_TTL_SECONDS = 60 * 60 * 24 * 30;

export const CHATGPT_TRUSTED_CLIENT_ID_HOST = 'chatgpt.com';
