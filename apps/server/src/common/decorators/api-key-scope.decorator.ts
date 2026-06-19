import { SetMetadata } from '@nestjs/common';
import { ApiKeyScope } from '../../core/api-key/api-key-scopes';

export const API_KEY_SCOPES_KEY = 'apiKeyScopes';

export const RequireApiKeyScopes = (...scopes: ApiKeyScope[]) =>
  SetMetadata(API_KEY_SCOPES_KEY, scopes);
