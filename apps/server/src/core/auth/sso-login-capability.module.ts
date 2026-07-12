import { Module } from '@nestjs/common';
import { SsoLoginCapabilityService } from './services/sso-login-capability.service';

@Module({
  providers: [SsoLoginCapabilityService],
  exports: [SsoLoginCapabilityService],
})
export class SsoLoginCapabilityModule {}
