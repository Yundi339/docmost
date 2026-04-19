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
import { User, Workspace } from '@docmost/db/types/entity.types';
import { AuditRepo, AuditQueryParams } from '@docmost/db/repos/audit/audit.repo';
import { UserRole } from '../../common/helpers/types/permission';
import {
  AUDIT_SERVICE,
  IAuditService,
} from './audit.service';

@UseGuards(JwtAuthGuard)
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
    this.validateAdminAccess(user);
    return this.auditRepo.findAuditLogs(workspace.id, params);
  }

  @HttpCode(HttpStatus.OK)
  @Post('retention')
  async getRetention(
    @AuthUser() user: User,
    @AuthWorkspace() workspace: Workspace,
  ) {
    this.validateAdminAccess(user);
    return { retentionDays: workspace['trashRetentionDays'] ?? 90 };
  }

  @HttpCode(HttpStatus.OK)
  @Post('retention/update')
  async updateRetention(
    @Body('auditRetentionDays') auditRetentionDays: number,
    @AuthUser() user: User,
    @AuthWorkspace() workspace: Workspace,
  ) {
    this.validateAdminAccess(user);

    if (auditRetentionDays && auditRetentionDays > 0) {
      await this.auditService.updateRetention(workspace.id, auditRetentionDays);
    }

    return { retentionDays: auditRetentionDays };
  }

  private validateAdminAccess(user: User) {
    if (user.role !== UserRole.ADMIN && user.role !== UserRole.OWNER) {
      throw new ForbiddenException('Admin access required');
    }
  }
}
