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

@UseGuards(JwtAuthGuard)
@Controller('sso')
export class SsoController {
  constructor(private ssoService: SsoService) {}

  @HttpCode(HttpStatus.OK)
  @Post('providers')
  async getProviders(@AuthWorkspace() workspace: Workspace) {
    return this.ssoService.getProviders(workspace.id);
  }

  @HttpCode(HttpStatus.OK)
  @Post('info')
  async getProviderById(
    @Body() body: { providerId: string },
    @AuthWorkspace() workspace: Workspace,
  ) {
    return this.ssoService.getProviderById(body.providerId, workspace.id);
  }

  @HttpCode(HttpStatus.OK)
  @Post('create')
  async createProvider(
    @Body() body: any,
    @AuthUser() user: User,
    @AuthWorkspace() workspace: Workspace,
  ) {
    return this.ssoService.createProvider({
      ...body,
      workspaceId: workspace.id,
      creatorId: user.id,
    });
  }

  @HttpCode(HttpStatus.OK)
  @Post('update')
  async updateProvider(
    @Body() body: any,
    @AuthWorkspace() workspace: Workspace,
  ) {
    const { providerId, ...data } = body;
    return this.ssoService.updateProvider(providerId, workspace.id, data);
  }

  @HttpCode(HttpStatus.OK)
  @Post('delete')
  async deleteProvider(
    @Body() body: { providerId: string },
    @AuthWorkspace() workspace: Workspace,
  ) {
    return this.ssoService.deleteProvider(body.providerId, workspace.id);
  }
}
