import type {
  ApiKeyScope,
  ApiKeyType,
  ICreateApiKeyRequest,
} from "@/ee/api-key/types/api-key.types";
import type { SpaceAccessInput } from "@/ee/space-access";

const API_KEY_SCOPES: Record<ApiKeyType, ApiKeyScope[]> = {
  rest: ["rest:read", "rest:write"],
  mcp: ["mcp:read", "mcp:write", "mcp:destructive"],
};

export function getDefaultApiKeyScopes(keyType: ApiKeyType): ApiKeyScope[] {
  return [`${keyType}:read` as ApiKeyScope];
}

export function restrictApiKeyScopesToType(
  keyType: ApiKeyType,
  scopes: ApiKeyScope[],
): ApiKeyScope[] {
  const allowedScopes = new Set(API_KEY_SCOPES[keyType]);
  const restrictedScopes = scopes.filter((scope) => allowedScopes.has(scope));

  return restrictedScopes.length > 0
    ? restrictedScopes
    : getDefaultApiKeyScopes(keyType);
}

export function getApiKeyScopeLabel(scopes: ApiKeyScope[] = []) {
  if (scopes.some((scope) => scope.endsWith(":destructive"))) {
    return "Read, write and destructive";
  }
  if (scopes.some((scope) => scope.endsWith(":write"))) {
    return "Read and write";
  }
  return "Read only";
}

export type ApiKeyConfigurationError =
  | "invalid_scope"
  | "missing_scope"
  | "missing_space"
  | "rest_space_access";

export function getApiKeyConfigurationError(
  keyType: ApiKeyType,
  scopes: ApiKeyScope[],
  spaceAccess: SpaceAccessInput,
): ApiKeyConfigurationError | null {
  if (scopes.length === 0) {
    return "missing_scope";
  }
  if (scopes.some((scope) => !API_KEY_SCOPES[keyType].includes(scope))) {
    return "invalid_scope";
  }
  if (keyType === "rest" && spaceAccess.mode !== "all") {
    return "rest_space_access";
  }
  if (keyType === "mcp" && spaceAccess.mode === "selected") {
    if (spaceAccess.spaceIds.length === 0) {
      return "missing_space";
    }
  }

  return null;
}

interface BuildApiKeyCreateRequestInput {
  name: string;
  expiresAt: string;
  keyType: ApiKeyType;
  scopes: ApiKeyScope[];
  spaceAccess: SpaceAccessInput;
}

export function buildApiKeyCreateRequest({
  name,
  expiresAt,
  keyType,
  scopes,
  spaceAccess,
}: BuildApiKeyCreateRequestInput): ICreateApiKeyRequest {
  return {
    name,
    expiresAt,
    keyType,
    scopes: restrictApiKeyScopesToType(keyType, scopes),
    spaceAccess: keyType === "rest" ? { mode: "all" } : spaceAccess,
  };
}
