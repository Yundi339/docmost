import { BadRequestException, Injectable } from '@nestjs/common';
import {
  CHATGPT_TRUSTED_CLIENT_ID_HOST,
  OAUTH_PROVIDER_CHATGPT,
} from '../oauth.constants';
import { OAuthClientProviderAdapter } from './oauth-client-provider';

@Injectable()
export class ChatGptOAuthClientProvider implements OAuthClientProviderAdapter {
  readonly id = OAUTH_PROVIDER_CHATGPT;
  readonly defaults = {
    name: 'ChatGPT',
    trustedClientIdHost: CHATGPT_TRUSTED_CLIENT_ID_HOST,
    allowClientIdMetadataDocuments: true,
  } as const;

  assertRedirectUri(redirectUri: string) {
    let url: URL;
    try {
      url = new URL(redirectUri);
    } catch {
      throw new BadRequestException('Invalid redirect_uri');
    }

    const allowedPath =
      url.pathname.startsWith('/connector/oauth/') ||
      url.pathname === '/connector_platform_oauth_redirect';
    if (
      url.protocol !== 'https:' ||
      url.hostname !== CHATGPT_TRUSTED_CLIENT_ID_HOST ||
      url.username ||
      url.password ||
      url.port ||
      !allowedPath
    ) {
      throw new BadRequestException('OAuth redirect_uri is not trusted');
    }
  }
}
