import {
  Body,
  BadRequestException,
  Controller,
  ForbiddenException,
  HttpCode,
  HttpStatus,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { FastifyRequest } from 'fastify';
import { User } from '@docmost/db/types/entity.types';
import { AuthUser } from '../../common/decorators/auth-user.decorator';
import { RequireApiKeyScopes } from '../../common/decorators/api-key-scope.decorator';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { UserRole } from '../../common/helpers/types/permission';
import { ApiKeyScope } from '../../core/api-key/api-key-scopes';
import { McpService } from './mcp.service';
import { ReleaseMcpSessionsDto } from './mcp-session-admin.dto';

@UseGuards(JwtAuthGuard)
@Controller('system-status/mcp-sessions')
export class McpSessionAdminController {
  constructor(private readonly mcpService: McpService) {}

  @HttpCode(HttpStatus.OK)
  @RequireApiKeyScopes(ApiKeyScope.REST_READ)
  @Post()
  async getSessions(@AuthUser() user: User) {
    this.assertOwner(user);
    return this.mcpService.getSessionDiagnostics(user.workspaceId);
  }

  @HttpCode(HttpStatus.OK)
  @RequireApiKeyScopes(ApiKeyScope.REST_WRITE)
  @Post('release')
  async releaseSessions(
    @Body() dto: ReleaseMcpSessionsDto,
    @AuthUser() user: User,
    @Req() req: FastifyRequest,
  ) {
    this.assertOwner(user);
    if (
      (!dto.sessionId && dto.idleOnly !== true) ||
      (dto.sessionId && dto.idleOnly)
    ) {
      throw new BadRequestException(
        'Specify one MCP session or request idle session release',
      );
    }
    return this.mcpService.releaseSessions(user.workspaceId, dto, {
      userId: user.id,
      ipAddress: req.ip,
    });
  }

  private assertOwner(user: User) {
    if (user.role !== UserRole.OWNER) throw new ForbiddenException();
  }
}
