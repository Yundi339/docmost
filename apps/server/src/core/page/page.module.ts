import { Module } from '@nestjs/common';
import { PageService } from './services/page.service';
import { PageController } from './page.controller';
import { PageHistoryService } from './services/page-history.service';
import { PageVisitorService } from './services/page-visitor.service';
import { TrashCleanupService } from './services/trash-cleanup.service';
import { BacklinkService } from './services/backlink.service';
import { StorageModule } from '../../integrations/storage/storage.module';
import { CollaborationModule } from '../../collaboration/collaboration.module';
import { WatcherModule } from '../watcher/watcher.module';
import { LabelModule } from '../label/label.module';
import { PageLifecycleService } from './services/page-lifecycle.service';
import { PageOperationPolicyService } from './policies/page-operation-policy.service';

@Module({
  controllers: [PageController],
  providers: [
    PageService,
    PageHistoryService,
    PageVisitorService,
    TrashCleanupService,
    BacklinkService,
    PageLifecycleService,
    PageOperationPolicyService,
  ],
  exports: [
    PageService,
    PageHistoryService,
    PageVisitorService,
    PageLifecycleService,
    PageOperationPolicyService,
  ],
  imports: [StorageModule, CollaborationModule, WatcherModule, LabelModule],
})
export class PageModule {}
