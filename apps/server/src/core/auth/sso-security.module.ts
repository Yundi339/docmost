import { Global, Module } from '@nestjs/common';
import { SsoEnforcementService } from './services/sso-enforcement.service';
import { SsoLoginCapabilityService } from './services/sso-login-capability.service';

@Global()
@Module({
  providers: [SsoLoginCapabilityService, SsoEnforcementService],
  exports: [SsoLoginCapabilityService, SsoEnforcementService],
})
export class SsoSecurityModule {}
