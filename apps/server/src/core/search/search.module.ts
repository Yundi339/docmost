import { Module } from '@nestjs/common';
import { SearchController } from './search.controller';
import { SearchAttachmentsController } from './search-attachments.controller';
import { SearchService } from './search.service';

@Module({
  controllers: [SearchController, SearchAttachmentsController],
  providers: [SearchService],
  exports: [SearchService],
})
export class SearchModule {}
