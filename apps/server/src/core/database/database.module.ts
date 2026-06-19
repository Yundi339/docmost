import { Module } from '@nestjs/common';
import { DatabaseController } from './database.controller';
import { DatabaseService } from './database.service';
import { DatabaseRepo } from './database.repo';
import { ApitableClient } from './apitable.client';
import { PageAccessModule } from '../page/page-access/page-access.module';
import { PageModule } from '../page/page.module';

@Module({
  imports: [PageAccessModule, PageModule],
  controllers: [DatabaseController],
  providers: [DatabaseService, DatabaseRepo, ApitableClient],
  exports: [DatabaseService],
})
export class DatabaseFeatureModule {}
