import { IUser } from "@/features/user/types/user.types.ts";
import {
  ISpaceAccess,
  SpaceAccessInput,
} from "@/ee/space-access/types/space-access.types";
import type { QueryParams } from "@/lib/types";

export type ApiKeyType = "rest" | "mcp";

export type ApiKeyScope =
  | "rest:read"
  | "rest:write"
  | "mcp:read"
  | "mcp:write"
  | "mcp:destructive";

export interface IApiKey {
  id: string;
  name: string;
  token?: string;
  creatorId: string;
  workspaceId: string;
  keyType: ApiKeyType;
  scopes: ApiKeyScope[];
  spaceAccess: ISpaceAccess;
  expiresAt: string | null;
  lastUsedAt: string | null;
  lastUsedIp?: string | null;
  lastUsedUserAgent?: string | null;
  createdAt: string;
  creator: Partial<IUser>;
}

export interface ICreateApiKeyRequest {
  name: string;
  expiresAt: string;
  keyType: ApiKeyType;
  scopes?: ApiKeyScope[];
  spaceAccess: SpaceAccessInput;
}

export interface IApiKeyListParams extends QueryParams {
  keyType: ApiKeyType;
}

export interface IUpdateApiKeyRequest {
  apiKeyId: string;
  name: string;
  scopes?: ApiKeyScope[];
  spaceAccess?: SpaceAccessInput;
}
