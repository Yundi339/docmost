import { Module } from '@nestjs/common';
import { PagePermissionService } from './page-permission.service';
import { PagePermissionController } from './page-permission.controller';
import { PageModule } from '../../core/page/page.module';
import { CaslModule } from '../../core/casl/casl.module';

@Module({
  imports: [PageModule, CaslModule],
  controllers: [PagePermissionController],
  providers: [PagePermissionService],
})
export class PagePermissionModule {}
