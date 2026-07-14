import { Module } from '@nestjs/common';
import { DatabaseController } from './database.controller';
import { DatabaseService } from './database.service';
import { DatabaseRepo } from './database.repo';
import { ApitableClient } from './apitable.client';
import { PageAccessModule } from '../page/page-access/page-access.module';
import { PageModule } from '../page/page.module';
import { DatabasePagePolicyContributor } from './database-page-policy.contributor';
import { DatabasePageLifecycleListener } from './database-page-lifecycle.listener';

@Module({
  imports: [PageAccessModule, PageModule],
  controllers: [DatabaseController],
  providers: [
    DatabaseService,
    DatabaseRepo,
    ApitableClient,
    DatabasePagePolicyContributor,
    DatabasePageLifecycleListener,
  ],
  exports: [DatabaseService],
})
export class DatabaseFeatureModule {}
