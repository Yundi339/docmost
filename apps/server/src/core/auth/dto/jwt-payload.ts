export enum JwtType {
  ACCESS = 'access',
  COLLAB = 'collab',
  EXCHANGE = 'exchange',
  ATTACHMENT = 'attachment',
  MFA_TOKEN = 'mfa_token',
  API_KEY = 'api_key',
  MCP_OAUTH = 'mcp_oauth',
  SHARE_ACCESS = 'share_access',
}
export type JwtPayload = {
  sub: string;
  email: string;
  workspaceId: string;
  type: 'access';
  sessionId?: string;
};

export type JwtCollabPayload = {
  sub: string;
  workspaceId: string;
  type: 'collab';
};

export type JwtExchangePayload = {
  sub: string;
  workspaceId: string;
  type: 'exchange';
};

export type JwtAttachmentPayload = {
  attachmentId: string;
  pageId: string;
  workspaceId: string;
  shareId: string;
  sharePasswordVersion: number;
  type: 'attachment';
};

export type JwtShareAccessPayload = {
  shareId: string;
  workspaceId: string;
  passwordVersion: number;
  type: 'share_access';
};

export interface JwtMfaTokenPayload {
  sub: string;
  workspaceId: string;
  type: 'mfa_token';
  jti: string;
  exp?: number;
  primaryAuth: 'password' | 'passkey' | 'sso';
  ownerRecovery?: boolean;
  passkeyId?: string;
  authTime: string;
}

export type JwtApiKeyPayload = {
  sub: string;
  workspaceId: string;
  apiKeyId: string;
  scopes?: string[];
  type: 'api_key';
};

export type JwtMcpOAuthPayload = {
  sub: string;
  workspaceId: string;
  authorizationId: string;
  oauthClientId?: string;
  clientId: string;
  resource: string;
  scopes?: string[];
  type: 'mcp_oauth';
};
