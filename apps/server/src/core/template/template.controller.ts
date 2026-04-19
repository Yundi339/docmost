import {
  Controller,
  Post,
  Body,
  HttpCode,
  HttpStatus,
  UseGuards,
} from '@nestjs/common';
import { TemplateService } from './template.service';
import {
  CreateTemplateDto,
  UpdateTemplateDto,
  TemplateIdDto,
  UseTemplateDto,
} from './dto/template.dto';
import { AuthUser } from '../../common/decorators/auth-user.decorator';
import { AuthWorkspace } from '../../common/decorators/auth-workspace.decorator';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { PaginationOptions } from '@docmost/db/pagination/pagination-options';
import { User, Workspace } from '@docmost/db/types/entity.types';

@UseGuards(JwtAuthGuard)
@Controller('templates')
export class TemplateController {
  constructor(private readonly templateService: TemplateService) {}

  @HttpCode(HttpStatus.OK)
  @Post('/')
  async findTemplates(
    @Body() pagination: PaginationOptions,
    @Body('spaceId') spaceId: string,
    @AuthUser() user: User,
    @AuthWorkspace() workspace: Workspace,
  ) {
    return this.templateService.findTemplates(
      workspace.id,
      user.id,
      pagination,
      spaceId,
    );
  }

  @HttpCode(HttpStatus.OK)
  @Post('info')
  async findOne(
    @Body() input: TemplateIdDto,
    @AuthWorkspace() workspace: Workspace,
  ) {
    return this.templateService.findById(input.templateId, workspace.id);
  }

  @HttpCode(HttpStatus.OK)
  @Post('create')
  async create(
    @Body() dto: CreateTemplateDto,
    @AuthUser() user: User,
    @AuthWorkspace() workspace: Workspace,
  ) {
    return this.templateService.create(dto, user.id, workspace.id);
  }

  @HttpCode(HttpStatus.OK)
  @Post('update')
  async update(
    @Body() dto: UpdateTemplateDto,
    @AuthUser() user: User,
    @AuthWorkspace() workspace: Workspace,
  ) {
    return this.templateService.update(dto, user.id, workspace.id);
  }

  @HttpCode(HttpStatus.OK)
  @Post('delete')
  async delete(
    @Body() input: TemplateIdDto,
    @AuthWorkspace() workspace: Workspace,
  ) {
    await this.templateService.delete(input.templateId, workspace.id);
  }

  @HttpCode(HttpStatus.OK)
  @Post('use')
  async useTemplate(
    @Body() dto: UseTemplateDto,
    @AuthUser() user: User,
    @AuthWorkspace() workspace: Workspace,
  ) {
    return this.templateService.useTemplate(dto, user.id, workspace.id);
  }
}
