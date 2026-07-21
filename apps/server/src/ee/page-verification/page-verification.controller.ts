import {
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Post,
  UseGuards,
} from '@nestjs/common';
import { PageVerificationService } from './page-verification.service';
import { AuthUser } from '../../common/decorators/auth-user.decorator';
import { AuthWorkspace } from '../../common/decorators/auth-workspace.decorator';
import { User, Workspace } from '@docmost/db/types/entity.types';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RequireApiKeyScopes } from '../../common/decorators/api-key-scope.decorator';
import { ApiKeyScope } from '../../core/api-key/api-key-scopes';

@UseGuards(JwtAuthGuard)
@Controller('pages')
export class PageVerificationController {
  constructor(private pageVerificationService: PageVerificationService) {}

  @HttpCode(HttpStatus.OK)
  @RequireApiKeyScopes(ApiKeyScope.REST_READ)
  @Post('verification-info')
  async getVerificationInfo(
    @Body() body: { pageId: string },
    @AuthUser() user: User,
    @AuthWorkspace() workspace: Workspace,
  ) {
    return this.pageVerificationService.getVerificationInfo(
      body.pageId,
      workspace.id,
      user,
    );
  }

  @HttpCode(HttpStatus.OK)
  @Post('create-verification')
  async setupVerification(
    @Body() body: any,
    @AuthUser() user: User,
    @AuthWorkspace() workspace: Workspace,
  ) {
    return this.pageVerificationService.setupVerification(
      body,
      workspace.id,
      user,
    );
  }

  @HttpCode(HttpStatus.OK)
  @Post('update-verification')
  async updateVerification(
    @Body() body: any,
    @AuthUser() user: User,
    @AuthWorkspace() workspace: Workspace,
  ) {
    return this.pageVerificationService.updateVerification(
      body,
      workspace.id,
      user,
    );
  }

  @HttpCode(HttpStatus.OK)
  @Post('delete-verification')
  async removeVerification(
    @Body() body: { pageId: string },
    @AuthUser() user: User,
    @AuthWorkspace() workspace: Workspace,
  ) {
    return this.pageVerificationService.removeVerification(
      body.pageId,
      workspace.id,
      user,
    );
  }

  @HttpCode(HttpStatus.OK)
  @Post('verify')
  async verifyPage(
    @Body() body: { pageId: string },
    @AuthUser() user: User,
    @AuthWorkspace() workspace: Workspace,
  ) {
    return this.pageVerificationService.verifyPage(
      body.pageId,
      workspace.id,
      user,
    );
  }

  @HttpCode(HttpStatus.OK)
  @Post('submit-for-approval')
  async submitForApproval(
    @Body() body: { pageId: string },
    @AuthUser() user: User,
    @AuthWorkspace() workspace: Workspace,
  ) {
    return this.pageVerificationService.submitForApproval(
      body.pageId,
      workspace.id,
      user,
    );
  }

  @HttpCode(HttpStatus.OK)
  @Post('reject-approval')
  async rejectApproval(
    @Body() body: { pageId: string; comment?: string },
    @AuthUser() user: User,
    @AuthWorkspace() workspace: Workspace,
  ) {
    return this.pageVerificationService.rejectApproval(
      body.pageId,
      workspace.id,
      user,
      body.comment,
    );
  }

  @HttpCode(HttpStatus.OK)
  @Post('mark-obsolete')
  async markObsolete(
    @Body() body: { pageId: string },
    @AuthUser() user: User,
    @AuthWorkspace() workspace: Workspace,
  ) {
    return this.pageVerificationService.markObsolete(
      body.pageId,
      workspace.id,
      user,
    );
  }

  @HttpCode(HttpStatus.OK)
  @RequireApiKeyScopes(ApiKeyScope.REST_READ)
  @Post('verifications')
  async getVerificationList(
    @Body() body: any,
    @AuthUser() user: User,
    @AuthWorkspace() workspace: Workspace,
  ) {
    return this.pageVerificationService.getVerificationList(
      workspace.id,
      user,
      body,
    );
  }
}
