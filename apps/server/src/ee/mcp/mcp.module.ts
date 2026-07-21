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
import { McpToolRegistryService } from './mcp-tool-registry.service';
import { McpToolExecutorService } from './mcp-tool-executor.service';
import { McpToolAccessService } from './mcp-tool-access.service';
import { McpPageToolProvider } from './tools/page.tools';
import { McpCommentToolProvider } from './tools/comment.tools';
import { McpSpaceToolProvider } from './tools/space.tools';
import { McpSearchToolProvider } from './tools/search.tools';
import { McpMemberToolProvider } from './tools/member.tools';
import { McpSessionAdminController } from './mcp-session-admin.controller';

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
  controllers: [McpController, McpSessionAdminController],
  providers: [
    McpService,
    McpAuthGuard,
    McpToolRegistryService,
    McpToolExecutorService,
    McpToolAccessService,
    McpPageToolProvider,
    McpCommentToolProvider,
    McpSpaceToolProvider,
    McpSearchToolProvider,
    McpMemberToolProvider,
  ],
})
export class McpModule {}
