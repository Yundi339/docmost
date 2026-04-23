import { Module } from '@nestjs/common';
import { PageVerificationService } from './page-verification.service';
import { PageVerificationController } from './page-verification.controller';

@Module({
  controllers: [PageVerificationController],
  providers: [PageVerificationService],
  exports: [PageVerificationService],
})
export class PageVerificationModule {}
