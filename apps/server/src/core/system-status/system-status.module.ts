import { Module } from '@nestjs/common';
import { SystemStatusController } from './system-status.controller';
import { SystemStatusService } from './system-status.service';
import { SystemDiagnosticsRepo } from './system-diagnostics.repo';
import { SystemDiagnosticsService } from './system-diagnostics.service';

@Module({
  controllers: [SystemStatusController],
  providers: [
    SystemStatusService,
    SystemDiagnosticsRepo,
    SystemDiagnosticsService,
  ],
  exports: [SystemDiagnosticsService],
})
export class SystemStatusModule {}
