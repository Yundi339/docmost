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
import { AuthUser } from '../../common/decorators/auth-user.decorator';
import { AuthWorkspace } from '../../common/decorators/auth-workspace.decorator';
import { User, Workspace } from '@docmost/db/types/entity.types';
import { WorkspaceRepo } from '@docmost/db/repos/workspace/workspace.repo';
import { McpMode, McpRequestContext, McpService } from './mcp.service';
import { McpAuthGuard } from './mcp-auth.guard';

@UseGuards(McpAuthGuard)
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
    const mcpAuth = (req as any).raw?.mcpAuth ?? (req as any).mcpAuth;
    if (!mcpAuth?.credentialId) {
      throw new ForbiddenException('A valid MCP bearer token is required');
    }
    const context: McpRequestContext = {
      authType: mcpAuth.authType,
      credentialId: mcpAuth.credentialId,
      apiKeyId: mcpAuth.apiKeyId,
      oauthAuthorizationId: mcpAuth.oauthAuthorizationId,
      oauthClientId: mcpAuth.oauthClientId,
      clientId: mcpAuth.clientId,
      scopes: mcpAuth.scopes ?? [],
      mode,
      ipAddress: getClientIp(req),
      userAgent: req.headers?.['user-agent'],
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

function getClientIp(req: FastifyRequest) {
  const forwardedFor = req.headers?.['x-forwarded-for'];
  return Array.isArray(forwardedFor)
    ? forwardedFor[0]
    : forwardedFor?.split(',')[0]?.trim() || req.ip;
}
