import {
  Injectable,
  NotFoundException,
  ForbiddenException,
} from '@nestjs/common';
import { TemplateRepo } from '@docmost/db/repos/template/template.repo';
import { PageRepo } from '@docmost/db/repos/page/page.repo';
import { SpaceMemberRepo } from '@docmost/db/repos/space/space-member.repo';
import { CreateTemplateDto, UpdateTemplateDto, UseTemplateDto } from './dto/template.dto';
import { User } from '@docmost/db/types/entity.types';
import { PaginationOptions } from '@docmost/db/pagination/pagination-options';
import { generateSlugId } from '../../common/helpers';

@Injectable()
export class TemplateService {
  constructor(
    private readonly templateRepo: TemplateRepo,
    private readonly pageRepo: PageRepo,
    private readonly spaceMemberRepo: SpaceMemberRepo,
  ) {}

  async findTemplates(
    workspaceId: string,
    userId: string,
    pagination: PaginationOptions,
    spaceId?: string,
  ) {
    const accessibleSpaceIds = await this.spaceMemberRepo.getUserSpaceIds(userId);
    return this.templateRepo.findTemplates(workspaceId, accessibleSpaceIds, pagination, { spaceId });
  }

  async findById(templateId: string, workspaceId: string) {
    const template = await this.templateRepo.findById(templateId, workspaceId, {
      includeContent: true,
    });
    if (!template) {
      throw new NotFoundException('Template not found');
    }
    return template;
  }

  async create(dto: CreateTemplateDto, userId: string, workspaceId: string) {
    if (dto.spaceId) {
      await this.validateSpaceAccess(userId, dto.spaceId);
    }

    const result = await this.templateRepo.insertTemplate({
      title: dto.title,
      description: dto.description,
      content: dto.content,
      icon: dto.icon,
      spaceId: dto.spaceId,
      workspaceId,
      creatorId: userId,
      lastUpdatedById: userId,
    });

    return this.templateRepo.findById(result.id, workspaceId, {
      includeContent: true,
    });
  }

  async update(dto: UpdateTemplateDto, userId: string, workspaceId: string) {
    const template = await this.templateRepo.findById(dto.templateId, workspaceId);
    if (!template) {
      throw new NotFoundException('Template not found');
    }

    if (dto.spaceId) {
      await this.validateSpaceAccess(userId, dto.spaceId);
    }

    await this.templateRepo.updateTemplate(
      {
        title: dto.title,
        description: dto.description,
        content: dto.content,
        icon: dto.icon,
        spaceId: dto.spaceId,
        lastUpdatedById: userId,
      },
      dto.templateId,
      workspaceId,
    );

    return this.templateRepo.findById(dto.templateId, workspaceId, {
      includeContent: true,
    });
  }

  async delete(templateId: string, workspaceId: string) {
    const template = await this.templateRepo.findById(templateId, workspaceId);
    if (!template) {
      throw new NotFoundException('Template not found');
    }
    await this.templateRepo.deleteTemplate(templateId, workspaceId);
  }

  async useTemplate(dto: UseTemplateDto, userId: string, workspaceId: string) {
    const template = await this.templateRepo.findById(dto.templateId, workspaceId, {
      includeContent: true,
    });
    if (!template) {
      throw new NotFoundException('Template not found');
    }

    await this.validateSpaceAccess(userId, dto.spaceId);

    const slugId = generateSlugId();

    const page = await this.pageRepo.insertPage({
      title: template.title,
      content: template.content,
      icon: template.icon,
      slugId,
      spaceId: dto.spaceId,
      parentPageId: dto.parentPageId ?? null,
      workspaceId,
      creatorId: userId,
      lastUpdatedById: userId,
    });

    return page;
  }

  private async validateSpaceAccess(userId: string, spaceId: string) {
    const userSpaceIds = await this.spaceMemberRepo.getUserSpaceIds(userId);
    if (!userSpaceIds.includes(spaceId)) {
      throw new ForbiddenException('No access to this space');
    }
  }
}
