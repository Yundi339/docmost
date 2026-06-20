import {
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Post,
  UseGuards,
} from '@nestjs/common';
import { SearchDTO } from './dto/search.dto';
import { AuthWorkspace } from '../../common/decorators/auth-workspace.decorator';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { RequireApiKeyScopes } from '../../common/decorators/api-key-scope.decorator';
import { ApiKeyScope } from '../api-key/api-key-scopes';
import { User, Workspace } from '@docmost/db/types/entity.types';
import { AuthUser } from '../../common/decorators/auth-user.decorator';
import { SearchAttachmentsService } from './search-attachments.service';

@UseGuards(JwtAuthGuard)
@Controller('search-attachments')
export class SearchAttachmentsController {
  constructor(
    private readonly searchAttachmentsService: SearchAttachmentsService,
  ) {}

  @HttpCode(HttpStatus.OK)
  @RequireApiKeyScopes(ApiKeyScope.REST_READ)
  @Post()
  async searchAttachments(
    @Body() searchDto: SearchDTO,
    @AuthUser() user: User,
    @AuthWorkspace() workspace: Workspace,
  ) {
    return this.searchAttachmentsService.searchAttachments(
      searchDto,
      user.id,
      workspace.id,
    );
  }
}
