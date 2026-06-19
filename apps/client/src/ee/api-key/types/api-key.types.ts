import { IUser } from "@/features/user/types/user.types.ts";

export type ApiKeyScope = "rest:read" | "rest:write" | "mcp:read" | "mcp:write";

export interface IApiKey {
  id: string;
  name: string;
  token?: string;
  creatorId: string;
  workspaceId: string;
  scopes: ApiKeyScope[];
  expiresAt: string | null;
  lastUsedAt: string | null;
  lastUsedIp?: string | null;
  lastUsedUserAgent?: string | null;
  createdAt: string;
  creator: Partial<IUser>;
}

export interface ICreateApiKeyRequest {
  name: string;
  expiresAt?: string;
  scopes?: ApiKeyScope[];
}

export interface IUpdateApiKeyRequest {
  apiKeyId: string;
  name: string;
}
