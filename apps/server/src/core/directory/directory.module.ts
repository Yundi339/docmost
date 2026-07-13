import { Module } from '@nestjs/common';
import { PageAccessModule } from '../page/page-access/page-access.module';
import { DirectoryQueryService } from './directory-query.service';
import { DirectoryVisibilityPolicy } from './directory-visibility.policy';

@Module({
  imports: [PageAccessModule],
  providers: [DirectoryQueryService, DirectoryVisibilityPolicy],
  exports: [DirectoryQueryService, DirectoryVisibilityPolicy],
})
export class DirectoryModule {}
