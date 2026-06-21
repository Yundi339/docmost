export type OAuthScope = "mcp:read" | "mcp:write";

export interface IOAuthClient {
  id: string;
  provider: "chatgpt" | string;
  name: string;
  isEnabled: boolean;
  allowedScopes: OAuthScope[];
  trustedClientIdHost: string;
  allowClientIdMetadataDocuments: boolean;
  mcpServerUrl: string;
  issuer: string;
  resourceMetadataUrl: string;
  authorizationServerMetadataUrl: string;
  authorizationEndpoint: string;
  tokenEndpoint: string;
  registrationEndpoint: string;
}

export interface IOAuthAuthorization {
  id: string;
  provider: string;
  clientId: string;
  clientName: string;
  clientUri?: string | null;
  redirectUri: string;
  resource: string;
  scopes: OAuthScope[];
  lastUsedAt?: string | null;
  revokedAt?: string | null;
  createdAt: string;
  updatedAt: string;
  userId: string;
  userName?: string | null;
  userEmail?: string | null;
  userAvatarUrl?: string | null;
}

export interface IOAuthAuthorizeInfo {
  provider: string;
  clientName: string;
  clientUri?: string | null;
  redirectUri: string;
  redirectHost: string;
  resource: string;
  scopes: OAuthScope[];
  user: {
    id: string;
    name: string;
    email: string;
  };
}

export interface IOAuthRedirectResponse {
  redirectUri: string;
}
