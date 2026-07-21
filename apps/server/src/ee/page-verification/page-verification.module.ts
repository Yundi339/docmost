import { Module } from '@nestjs/common';
import { PageVerificationService } from './page-verification.service';
import { PageVerificationController } from './page-verification.controller';
import { PageModule } from '../../core/page/page.module';

@Module({
  imports: [PageModule],
  controllers: [PageVerificationController],
  providers: [PageVerificationService],
  exports: [PageVerificationService],
})
export class PageVerificationModule {}
