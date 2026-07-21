import { Module } from '@nestjs/common';
import { ApiKeyService } from './api-key.service';
import { ApiKeyController } from './api-key.controller';
import { TokenModule } from '../auth/token.module';
import { CredentialSpaceAccessModule } from '../credential-space-access/credential-space-access.module';

@Module({
  imports: [TokenModule, CredentialSpaceAccessModule],
  controllers: [ApiKeyController],
  providers: [ApiKeyService],
  exports: [ApiKeyService],
})
export class ApiKeyModule {}
