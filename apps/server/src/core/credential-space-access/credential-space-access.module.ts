import { Module } from '@nestjs/common';
import { CredentialSpaceAccessService } from './credential-space-access.service';
import { CredentialRevocationService } from './credential-revocation.service';

@Module({
  providers: [CredentialSpaceAccessService, CredentialRevocationService],
  exports: [CredentialSpaceAccessService, CredentialRevocationService],
})
export class CredentialSpaceAccessModule {}
