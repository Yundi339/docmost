import {
  ISpaceAccess,
  ISpaceAccessSpace,
  SpaceAccessInput,
} from "@/ee/space-access/types/space-access.types";

export type OAuthScope = "mcp:read" | "mcp:write" | "mcp:destructive";

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
  spaceAccess: ISpaceAccess;
}

export interface IOAuthAuthorizeInfo {
  provider: string;
  clientName: string;
  clientUri?: string | null;
  redirectUri: string;
  redirectHost: string;
  resource: string;
  scopes: OAuthScope[];
  availableSpaces: ISpaceAccessSpace[];
  spaceAccess: ISpaceAccess;
  user: {
    id: string;
    name: string;
    email: string;
  };
}

export interface IOAuthRedirectResponse {
  redirectUri: string;
}

export interface IOAuthApprovalRequest {
  [key: string]: string | SpaceAccessInput | undefined;
  spaceAccess?: SpaceAccessInput;
}

export interface IUpdateOAuthAuthorizationRequest {
  authorizationId: string;
  spaceAccess: SpaceAccessInput;
}
