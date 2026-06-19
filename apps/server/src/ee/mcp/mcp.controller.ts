import {
  All,
  Controller,
  ForbiddenException,
  Logger,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import { FastifyReply, FastifyRequest } from 'fastify';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { ApiKeyAuthGuard } from '../../common/guards/api-key-auth.guard';
import { AuthUser } from '../../common/decorators/auth-user.decorator';
import { AuthWorkspace } from '../../common/decorators/auth-workspace.decorator';
import { User, Workspace } from '@docmost/db/types/entity.types';
import { WorkspaceRepo } from '@docmost/db/repos/workspace/workspace.repo';
import { McpMode, McpRequestContext, McpService } from './mcp.service';

@UseGuards(JwtAuthGuard, ApiKeyAuthGuard)
@Controller('mcp')
export class McpController {
  private readonly logger = new Logger(McpController.name);

  constructor(
    private readonly mcpService: McpService,
    private readonly workspaceRepo: WorkspaceRepo,
  ) {}

  @All()
  async handleMcp(
    @Req() req: FastifyRequest,
    @Res() res: FastifyReply,
    @AuthUser() user: User,
    @AuthWorkspace() workspace: Workspace,
  ): Promise<void> {
    // Fetch full workspace to check MCP settings
    const fullWorkspace = await this.workspaceRepo.findById(workspace.id);
    if (!fullWorkspace) {
      throw new ForbiddenException('Workspace not found');
    }

    const settings = fullWorkspace.settings as any;
    const mode = resolveMcpMode(settings?.ai);
    if (mode === 'off') {
      throw new ForbiddenException('MCP is not enabled for this workspace');
    }
    const apiKey = (req as any).raw?.apiKey;
    if (!apiKey?.id) {
      throw new ForbiddenException('An API key bearer token is required');
    }
    const context: McpRequestContext = {
      apiKeyId: apiKey.id,
      scopes: apiKey.scopes ?? [],
      mode,
    };

    const method = req.method;
    const rawReq = req.raw;
    const rawRes = res.raw;

    if (method === 'DELETE') {
      await this.mcpService.handleDelete(
        rawReq,
        rawRes,
        user,
        fullWorkspace,
        context,
      );
      return;
    }

    // POST and GET
    await this.mcpService.handleRequest(
      rawReq,
      rawRes,
      req.body,
      user,
      fullWorkspace,
      context,
    );
  }
}

export function resolveMcpMode(aiSettings: any): McpMode {
  if (
    aiSettings?.mcpMode === 'read-only' ||
    aiSettings?.mcpMode === 'read-write'
  ) {
    return aiSettings.mcpMode;
  }
  if (aiSettings?.mcpMode === 'off') {
    return 'off';
  }

  return aiSettings?.mcp === true ? 'read-write' : 'off';
}
