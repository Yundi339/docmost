import {
  Body,
  Controller,
  ForbiddenException,
  HttpCode,
  HttpStatus,
  Post,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { AuthUser } from '../../common/decorators/auth-user.decorator';
import { RequireApiKeyScopes } from '../../common/decorators/api-key-scope.decorator';
import { ApiKeyScope } from '../api-key/api-key-scopes';
import { User } from '@docmost/db/types/entity.types';
import { UserRole } from '../../common/helpers/types/permission';
import { SystemStatusService } from './system-status.service';
import { ListSystemDiagnosticDataSourcesDto } from './system-diagnostics.dto';

@UseGuards(JwtAuthGuard)
@Controller('system-status')
export class SystemStatusController {
  constructor(private readonly systemStatusService: SystemStatusService) {}

  @HttpCode(HttpStatus.OK)
  @RequireApiKeyScopes(ApiKeyScope.REST_READ)
  @Post()
  async getStatus(@AuthUser() user: User) {
    // Owner-only. Admins are NOT allowed to read infrastructure metrics —
    // this matches the sidebar gating (role: "owner") and avoids leaking
    // database size / version / connection counts to non-owner admins.
    this.assertOwner(user);
    return this.systemStatusService.getStatus(user.workspaceId);
  }

  @HttpCode(HttpStatus.OK)
  @RequireApiKeyScopes(ApiKeyScope.REST_READ)
  @Post('diagnostics/data-sources')
  async listDiagnosticDataSources(
    @Body() dto: ListSystemDiagnosticDataSourcesDto,
    @AuthUser() user: User,
  ) {
    this.assertOwner(user);
    return this.systemStatusService.listDiagnosticDataSources(user, dto);
  }

  private assertOwner(user: User): void {
    if (user.role !== UserRole.OWNER) throw new ForbiddenException();
  }
}
