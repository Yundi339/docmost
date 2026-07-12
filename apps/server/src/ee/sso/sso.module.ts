import { Module } from '@nestjs/common';
import { SsoService } from './sso.service';
import { SsoController } from './sso.controller';
import { SsoSecretService } from './sso-secret.service';
import { SsoLoginCapabilityModule } from '../../core/auth/sso-login-capability.module';

@Module({
  imports: [SsoLoginCapabilityModule],
  controllers: [SsoController],
  providers: [SsoService, SsoSecretService],
  exports: [SsoService],
})
export class SsoModule {}
