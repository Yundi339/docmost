import { Module } from '@nestjs/common';
import { McpService } from './mcp.service';
import { McpController } from './mcp.controller';
import { PageModule } from '../../core/page/page.module';
import { SpaceModule } from '../../core/space/space.module';
import { CommentModule } from '../../core/comment/comment.module';
import { SearchModule } from '../../core/search/search.module';
import { WorkspaceModule } from '../../core/workspace/workspace.module';
import { ApiKeyModule } from '../../core/api-key/api-key.module';
import { OAuthModule } from '../oauth/oauth.module';
import { McpAuthGuard } from './mcp-auth.guard';
import { PageAccessModule } from '../../core/page/page-access/page-access.module';
import { TokenModule } from '../../core/auth/token.module';

@Module({
  imports: [
    PageModule,
    SpaceModule,
    CommentModule,
    SearchModule,
    WorkspaceModule,
    ApiKeyModule,
    OAuthModule,
    TokenModule,
    PageAccessModule,
  ],
  controllers: [McpController],
  providers: [McpService, McpAuthGuard],
})
export class McpModule {}
