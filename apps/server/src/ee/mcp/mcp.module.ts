import { Module } from '@nestjs/common';
import { McpService } from './mcp.service';
import { McpController } from './mcp.controller';
import { PageModule } from '../../core/page/page.module';
import { SpaceModule } from '../../core/space/space.module';
import { CommentModule } from '../../core/comment/comment.module';
import { SearchModule } from '../../core/search/search.module';
import { WorkspaceModule } from '../../core/workspace/workspace.module';

@Module({
  imports: [PageModule, SpaceModule, CommentModule, SearchModule, WorkspaceModule],
  controllers: [McpController],
  providers: [McpService],
})
export class McpModule {}
