import { Module } from '@nestjs/common';
import { DocxImportService } from './docx-import.service';
import { StorageModule } from '../../integrations/storage/storage.module';

@Module({
  imports: [StorageModule],
  providers: [DocxImportService],
  exports: [DocxImportService],
})
export class DocxImportModule {}
