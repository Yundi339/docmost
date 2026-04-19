import {
  Controller,
  Post,
  Body,
  HttpCode,
  HttpStatus,
  UseGuards,
} from '@nestjs/common';
import { ApiKeyService } from './api-key.service';
import { CreateApiKeyDto, UpdateApiKeyDto, ApiKeyIdDto } from './dto/api-key.dto';
import { AuthUser } from '../../common/decorators/auth-user.decorator';
import { AuthWorkspace } from '../../common/decorators/auth-workspace.decorator';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { PaginationOptions } from '@docmost/db/pagination/pagination-options';
import { User, Workspace } from '@docmost/db/types/entity.types';

@UseGuards(JwtAuthGuard)
@Controller('api-keys')
export class ApiKeyController {
  constructor(private readonly apiKeyService: ApiKeyService) {}

  @HttpCode(HttpStatus.OK)
  @Post('/')
  async findApiKeys(
    @Body() pagination: PaginationOptions,
    @AuthWorkspace() workspace: Workspace,
  ) {
    return this.apiKeyService.findApiKeys(workspace.id, pagination);
  }

  @HttpCode(HttpStatus.OK)
  @Post('create')
  async create(
    @Body() dto: CreateApiKeyDto,
    @AuthUser() user: User,
    @AuthWorkspace() workspace: Workspace,
  ) {
    return this.apiKeyService.create(dto, user, workspace.id);
  }

  @HttpCode(HttpStatus.OK)
  @Post('update')
  async update(
    @Body() dto: UpdateApiKeyDto,
    @AuthWorkspace() workspace: Workspace,
  ) {
    return this.apiKeyService.update(dto, workspace.id);
  }

  @HttpCode(HttpStatus.OK)
  @Post('revoke')
  async revoke(
    @Body() input: ApiKeyIdDto,
    @AuthWorkspace() workspace: Workspace,
  ) {
    await this.apiKeyService.revoke(input.apiKeyId, workspace.id);
  }
}
