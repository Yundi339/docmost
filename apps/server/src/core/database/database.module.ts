import { Module } from '@nestjs/common';
import { DatabaseController } from './database.controller';
import { DatabaseService } from './database.service';
import { DatabaseRepo } from './database.repo';
import { ApitableClient } from './apitable.client';
import { PageAccessModule } from '../page/page-access/page-access.module';
import { PageModule } from '../page/page.module';
import { DatabasePagePolicyContributor } from './database-page-policy.contributor';
import { DatabasePageLifecycleListener } from './database-page-lifecycle.listener';
import { CollaborationModule } from '../../collaboration/collaboration.module';
import { DatabaseContentLifecycleContributor } from './database-content-lifecycle.contributor';

@Module({
  imports: [PageAccessModule, PageModule, CollaborationModule],
  controllers: [DatabaseController],
  providers: [
    DatabaseService,
    DatabaseRepo,
    ApitableClient,
    DatabasePagePolicyContributor,
    DatabasePageLifecycleListener,
    DatabaseContentLifecycleContributor,
  ],
  exports: [DatabaseService],
})
export class DatabaseFeatureModule {}
