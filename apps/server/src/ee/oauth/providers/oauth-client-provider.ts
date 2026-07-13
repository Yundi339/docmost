import { OAuthProvider } from '../oauth.types';

export const OAUTH_CLIENT_PROVIDERS = Symbol('OAUTH_CLIENT_PROVIDERS');

export type OAuthClientProviderDefaults = {
  name: string;
  trustedClientIdHost: string;
  allowClientIdMetadataDocuments: boolean;
};

export interface OAuthClientProviderAdapter {
  readonly id: OAuthProvider;
  readonly defaults: OAuthClientProviderDefaults;
  assertRedirectUri(redirectUri: string): void;
}
