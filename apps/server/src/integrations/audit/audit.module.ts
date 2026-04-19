import { Global, Module } from '@nestjs/common';
import { AUDIT_SERVICE, RealAuditService } from './audit.service';
import { AuditController } from './audit.controller';

@Global()
@Module({
  controllers: [AuditController],
  providers: [
    {
      provide: AUDIT_SERVICE,
      useClass: RealAuditService,
    },
  ],
  exports: [AUDIT_SERVICE],
})
export class NoopAuditModule {}
