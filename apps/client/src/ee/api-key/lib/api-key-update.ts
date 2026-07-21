import type {
  ApiKeyScope,
  IUpdateApiKeyRequest,
} from "@/ee/api-key/types/api-key.types";
import type { SpaceAccessInput } from "@/ee/space-access";

interface BuildApiKeyUpdateRequestInput {
  apiKeyId: string;
  name: string;
  nameOnly?: boolean;
  scopes?: ApiKeyScope[];
  spaceAccess?: SpaceAccessInput;
}

export function buildApiKeyUpdateRequest({
  apiKeyId,
  name,
  nameOnly = false,
  scopes,
  spaceAccess,
}: BuildApiKeyUpdateRequestInput): IUpdateApiKeyRequest {
  if (nameOnly) {
    return { apiKeyId, name };
  }

  return { apiKeyId, name, scopes, spaceAccess };
}
