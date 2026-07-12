import { Module } from '@nestjs/common';
import { ShareController } from './share.controller';
import { ShareService } from './share.service';
import { TokenModule } from '../auth/token.module';
import { ShareSeoController } from './share-seo.controller';
import { SharePasswordService } from './share-password.service';
import { ShareAccessService } from './share-access.service';
import { ShareAccessGuard } from './share-access.guard';
import { ShareAccessController } from './share-access.controller';

@Module({
  imports: [TokenModule],
  controllers: [ShareController, ShareAccessController, ShareSeoController],
  providers: [
    ShareService,
    SharePasswordService,
    ShareAccessService,
    ShareAccessGuard,
  ],
  exports: [ShareService, ShareAccessService, ShareAccessGuard],
})
export class ShareModule {}
