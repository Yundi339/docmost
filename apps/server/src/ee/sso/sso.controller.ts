import {
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Post,
  UseGuards,
} from '@nestjs/common';
import { SsoService } from './sso.service';
import { AuthUser } from '../../common/decorators/auth-user.decorator';
import { AuthWorkspace } from '../../common/decorators/auth-workspace.decorator';
import { User, Workspace } from '@docmost/db/types/entity.types';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { SessionAuthGuard } from '../../common/guards/session-auth.guard';
import {
  CreateSsoProviderDto,
  SsoProviderIdDto,
  UpdateSsoProviderDto,
} from './dto/sso.dto';

@UseGuards(JwtAuthGuard, SessionAuthGuard)
@Controller('sso')
export class SsoController {
  constructor(private readonly ssoService: SsoService) {}

  @HttpCode(HttpStatus.OK)
  @Post('providers')
  async getProviders(
    @AuthUser() user: User,
    @AuthWorkspace() workspace: Workspace,
  ) {
    return this.ssoService.getProviders(workspace.id, user);
  }

  @HttpCode(HttpStatus.OK)
  @Post('info')
  async getProviderById(
    @Body() dto: SsoProviderIdDto,
    @AuthUser() user: User,
    @AuthWorkspace() workspace: Workspace,
  ) {
    return this.ssoService.getProviderById(dto.providerId, workspace.id, user);
  }

  @HttpCode(HttpStatus.OK)
  @Post('create')
  async createProvider(
    @Body() dto: CreateSsoProviderDto,
    @AuthUser() user: User,
    @AuthWorkspace() workspace: Workspace,
  ) {
    return this.ssoService.createProvider(dto, workspace.id, user);
  }

  @HttpCode(HttpStatus.OK)
  @Post('update')
  async updateProvider(
    @Body() dto: UpdateSsoProviderDto,
    @AuthUser() user: User,
    @AuthWorkspace() workspace: Workspace,
  ) {
    const { providerId, ...data } = dto;
    return this.ssoService.updateProvider(providerId, workspace.id, data, user);
  }

  @HttpCode(HttpStatus.OK)
  @Post('delete')
  async deleteProvider(
    @Body() dto: SsoProviderIdDto,
    @AuthUser() user: User,
    @AuthWorkspace() workspace: Workspace,
  ) {
    return this.ssoService.deleteProvider(dto.providerId, workspace.id, user);
  }
}
