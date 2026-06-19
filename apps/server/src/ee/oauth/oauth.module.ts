import { Module } from '@nestjs/common';
import { TokenModule } from '../../core/auth/token.module';
import { OAuthController, OAuthMetadataController } from './oauth.controller';
import { OAuthService } from './oauth.service';

@Module({
  imports: [TokenModule],
  controllers: [OAuthMetadataController, OAuthController],
  providers: [OAuthService],
  exports: [OAuthService],
})
export class OAuthModule {}
