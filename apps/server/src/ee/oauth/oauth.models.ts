import {
  OauthClient,
  OauthRegisteredClient,
} from '@docmost/db/types/entity.types';
import { OAuthScopeValue } from './oauth.constants';

export type OAuthClientRow = OauthClient;

export type ResolvedAuthorizeRequest = {
  oauthClient: OAuthClientRow;
  clientId: string;
  clientName: string;
  clientUri?: string;
  redirectUri: string;
  resource: string;
  scopes: OAuthScopeValue[];
  state?: string;
  codeChallenge: string;
  codeChallengeMethod: 'S256';
};

export type RegisteredDcrClient = {
  clientId: string;
  clientName: string;
  clientUri?: string;
  redirectUris: string[];
  grantTypes: string[];
  responseTypes: string[];
  tokenEndpointAuthMethod: 'none';
  scopes: OAuthScopeValue[];
  createdAt: string;
  updatedAt?: string;
};

export type OAuthClientView = {
  id: string;
  provider: string;
  name: string;
  isEnabled: boolean;
  allowedScopes: string[];
  trustedClientIdHost: string;
  allowClientIdMetadataDocuments: boolean;
  mcpServerUrl: string;
  issuer: string;
  resourceMetadataUrl: string;
  authorizationServerMetadataUrl: string;
  authorizationEndpoint: string;
  tokenEndpoint: string;
  registrationEndpoint: string;
};

export type RegisteredClientRow = OauthRegisteredClient;
