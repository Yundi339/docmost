import {
  Controller,
  Post,
  Body,
  HttpCode,
  HttpStatus,
  UseGuards,
  ForbiddenException,
  Inject,
} from '@nestjs/common';
import { AuthUser } from '../../common/decorators/auth-user.decorator';
import { AuthWorkspace } from '../../common/decorators/auth-workspace.decorator';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { SessionAuthGuard } from '../../common/guards/session-auth.guard';
import { User, Workspace } from '@docmost/db/types/entity.types';
import {
  AuditRepo,
  AuditQueryParams,
} from '@docmost/db/repos/audit/audit.repo';
import { UserRole } from '../../common/helpers/types/permission';
import { AUDIT_SERVICE, IAuditService } from './audit.service';
import { AuditEvent, AuditResource } from '../../common/events/audit-events';

@UseGuards(JwtAuthGuard, SessionAuthGuard)
@Controller('audit')
export class AuditController {
  constructor(
    private readonly auditRepo: AuditRepo,
    @Inject(AUDIT_SERVICE) private readonly auditService: IAuditService,
  ) {}

  @HttpCode(HttpStatus.OK)
  @Post('/')
  async findAuditLogs(
    @Body() params: AuditQueryParams,
    @AuthUser() user: User,
    @AuthWorkspace() workspace: Workspace,
  ) {
    this.validateOwnerAccess(user);
    return this.auditRepo.findAuditLogs(workspace.id, params);
  }

  @HttpCode(HttpStatus.OK)
  @Post('mcp/my')
  async findMyMcpAuditLogs(
    @Body() params: AuditQueryParams,
    @AuthUser() user: User,
    @AuthWorkspace() workspace: Workspace,
  ) {
    return this.auditRepo.findAuditLogs(workspace.id, {
      ...params,
      actorId: user.id,
      event: AuditEvent.MCP_TOOL_CALLED,
      resourceType: AuditResource.MCP_TOOL,
    });
  }

  @HttpCode(HttpStatus.OK)
  @Post('retention')
  async getRetention(
    @AuthUser() user: User,
    @AuthWorkspace() workspace: Workspace,
  ) {
    this.validateOwnerAccess(user);
    return { retentionDays: workspace['trashRetentionDays'] ?? 90 };
  }

  @HttpCode(HttpStatus.OK)
  @Post('retention/update')
  async updateRetention(
    @Body('auditRetentionDays') auditRetentionDays: number,
    @AuthUser() user: User,
    @AuthWorkspace() workspace: Workspace,
  ) {
    this.validateOwnerAccess(user);

    if (auditRetentionDays && auditRetentionDays > 0) {
      await this.auditService.updateRetention(workspace.id, auditRetentionDays);
    }

    return { retentionDays: auditRetentionDays };
  }

  private validateOwnerAccess(user: User) {
    if (user.role !== UserRole.OWNER) {
      throw new ForbiddenException('Owner access required');
    }
  }
}
