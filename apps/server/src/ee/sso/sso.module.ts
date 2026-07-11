import { Module } from '@nestjs/common';
import { SsoService } from './sso.service';
import { SsoController } from './sso.controller';
import { SsoSecretService } from './sso-secret.service';

@Module({
  controllers: [SsoController],
  providers: [SsoService, SsoSecretService],
  exports: [SsoService],
})
export class SsoModule {}
