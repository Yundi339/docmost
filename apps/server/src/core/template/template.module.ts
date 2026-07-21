import { Module } from '@nestjs/common';
import { TemplateService } from './template.service';
import { TemplateController } from './template.controller';
import { PageModule } from '../page/page.module';
import { CaslModule } from '../casl/casl.module';

@Module({
  imports: [PageModule, CaslModule],
  controllers: [TemplateController],
  providers: [TemplateService],
  exports: [TemplateService],
})
export class TemplateModule {}
