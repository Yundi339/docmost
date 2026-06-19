import { HttpStatus } from '@nestjs/common';
import {
  JwtApiKeyPayload,
  JwtMcpOAuthPayload,
} from '../../core/auth/dto/jwt-payload';

export type OAuthProvider = 'chatgpt';

export type OAuthClientMetadata = {
  client_id: string;
  client_name?: string;
  client_uri?: string;
  logo_uri?: string;
  redirect_uris?: string[];
  grant_types?: string[];
  response_types?: string[];
  scope?: string;
};

export type OAuthAuthorizeQuery = {
  response_type?: string;
  client_id?: string;
  redirect_uri?: string;
  scope?: string;
  state?: string;
  code_challenge?: string;
  code_challenge_method?: string;
  resource?: string;
};

export type OAuthTokenRequest = {
  grant_type?: string;
  code?: string;
  refresh_token?: string;
  client_id?: string;
  redirect_uri?: string;
  code_verifier?: string;
  resource?: string;
  scope?: string;
};

export type OAuthTokenResponse = {
  access_token: string;
  token_type: 'Bearer';
  expires_in: number;
  scope: string;
  refresh_token?: string;
};

export type McpAuthResult =
  | {
      authType: 'api_key';
      payload: JwtApiKeyPayload;
      apiKey: {
        id: string;
        creatorId: string;
        scopes: string[];
      };
    }
  | {
      authType: 'oauth';
      payload: JwtMcpOAuthPayload;
      oauth: {
        authorizationId: string;
        oauthClientId?: string;
        clientId: string;
        scopes: string[];
      };
    };

export class OAuthRequestError extends Error {
  constructor(
    public readonly errorCode: string,
    public readonly errorDescription: string,
    public readonly statusCode = HttpStatus.BAD_REQUEST,
  ) {
    super(errorDescription);
  }
}
