import { BadRequestException, Inject, Injectable } from '@nestjs/common';
import { OAUTH_PROVIDER_CHATGPT } from '../oauth.constants';
import {
  OAUTH_CLIENT_PROVIDERS,
  OAuthClientProviderAdapter,
} from './oauth-client-provider';

@Injectable()
export class OAuthProviderRegistry {
  private readonly providers: Map<string, OAuthClientProviderAdapter>;

  constructor(
    @Inject(OAUTH_CLIENT_PROVIDERS)
    providers: OAuthClientProviderAdapter[],
  ) {
    this.providers = new Map(
      providers.map((provider) => [provider.id, provider]),
    );
  }

  get(providerId: string): OAuthClientProviderAdapter {
    const provider = this.providers.get(providerId);
    if (!provider) {
      throw new BadRequestException('OAuth client provider is not supported');
    }
    return provider;
  }

  getDefault(): OAuthClientProviderAdapter {
    return this.get(OAUTH_PROVIDER_CHATGPT);
  }
}
