import { Module } from '@nestjs/common';
import { TokenModule } from '../../core/auth/token.module';
import { OAuthController, OAuthMetadataController } from './oauth.controller';
import { OAuthAuthorizationService } from './oauth-authorization.service';
import { OAuthClientService } from './oauth-client.service';
import { OAuthMetadataService } from './oauth-metadata.service';
import { OAuthService } from './oauth.service';
import { OAuthTokenService } from './oauth-token.service';
import { ChatGptOAuthClientProvider } from './providers/chatgpt-oauth-client.provider';
import { OAUTH_CLIENT_PROVIDERS } from './providers/oauth-client-provider';
import { OAuthProviderRegistry } from './providers/oauth-provider.registry';
import { CredentialSpaceAccessModule } from '../../core/credential-space-access/credential-space-access.module';

@Module({
  imports: [TokenModule, CredentialSpaceAccessModule],
  controllers: [OAuthMetadataController, OAuthController],
  providers: [
    ChatGptOAuthClientProvider,
    {
      provide: OAUTH_CLIENT_PROVIDERS,
      useFactory: (chatGptProvider: ChatGptOAuthClientProvider) => [
        chatGptProvider,
      ],
      inject: [ChatGptOAuthClientProvider],
    },
    OAuthProviderRegistry,
    OAuthMetadataService,
    OAuthClientService,
    OAuthAuthorizationService,
    OAuthTokenService,
    OAuthService,
  ],
  exports: [OAuthService],
})
export class OAuthModule {}
