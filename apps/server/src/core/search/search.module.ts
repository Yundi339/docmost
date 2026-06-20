import { Module } from '@nestjs/common';
import { SearchController } from './search.controller';
import { SearchAttachmentsController } from './search-attachments.controller';
import { SearchService } from './search.service';
import { SearchAttachmentsService } from './search-attachments.service';

@Module({
  controllers: [SearchController, SearchAttachmentsController],
  providers: [SearchService, SearchAttachmentsService],
  exports: [SearchService, SearchAttachmentsService],
})
export class SearchModule {}
