import {
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Post,
  UseGuards,
} from '@nestjs/common';
import { AuthUser } from '../../common/decorators/auth-user.decorator';
import { AuthWorkspace } from '../../common/decorators/auth-workspace.decorator';
import { User, Workspace } from '@docmost/db/types/entity.types';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { PagePermissionService } from './page-permission.service';

@UseGuards(JwtAuthGuard)
@Controller('pages')
export class PagePermissionController {
  constructor(private readonly service: PagePermissionService) {}

  @HttpCode(HttpStatus.OK)
  @Post('permission-info')
  async getInfo(
    @Body() body: { pageId: string },
    @AuthUser() user: User,
    @AuthWorkspace() workspace: Workspace,
  ) {
    return this.service.getRestrictionInfo(body.pageId, user, workspace.id);
  }

  @HttpCode(HttpStatus.OK)
  @Post('permissions')
  async listPermissions(
    @Body()
    body: {
      pageId: string;
      cursor?: string;
      limit?: number;
      query?: string;
    },
    @AuthUser() user: User,
    @AuthWorkspace() workspace: Workspace,
  ) {
    return this.service.listPermissions(body.pageId, user, workspace.id, {
      cursor: body.cursor,
      limit: body.limit,
      query: body.query,
    });
  }

  @HttpCode(HttpStatus.OK)
  @Post('restrict')
  async restrictPage(
    @Body() body: { pageId: string },
    @AuthUser() user: User,
    @AuthWorkspace() workspace: Workspace,
  ) {
    await this.service.restrictPage(body.pageId, user, workspace.id);
    return { success: true };
  }

  @HttpCode(HttpStatus.OK)
  @Post('remove-restriction')
  async unrestrictPage(
    @Body() body: { pageId: string },
    @AuthUser() user: User,
    @AuthWorkspace() workspace: Workspace,
  ) {
    await this.service.unrestrictPage(body.pageId, user, workspace.id);
    return { success: true };
  }

  @HttpCode(HttpStatus.OK)
  @Post('add-permission')
  async addPermission(
    @Body()
    body: {
      pageId: string;
      role: 'reader' | 'writer';
      userIds?: string[];
      groupIds?: string[];
    },
    @AuthUser() user: User,
    @AuthWorkspace() workspace: Workspace,
  ) {
    await this.service.addPermissions(body, user, workspace.id);
    return { success: true };
  }

  @HttpCode(HttpStatus.OK)
  @Post('remove-permission')
  async removePermission(
    @Body()
    body: {
      pageId: string;
      userIds?: string[];
      groupIds?: string[];
    },
    @AuthUser() user: User,
    @AuthWorkspace() workspace: Workspace,
  ) {
    await this.service.removePermissions(body, user, workspace.id);
    return { success: true };
  }

  @HttpCode(HttpStatus.OK)
  @Post('update-permission')
  async updatePermission(
    @Body()
    body: {
      pageId: string;
      role: 'reader' | 'writer';
      userId?: string;
      groupId?: string;
    },
    @AuthUser() user: User,
    @AuthWorkspace() workspace: Workspace,
  ) {
    await this.service.updatePermissionRole(body, user, workspace.id);
    return { success: true };
  }
}
