import {
  Injectable,
  NotFoundException,
  ForbiddenException,
} from '@nestjs/common';
import { InjectKysely } from 'nestjs-kysely';
import { KyselyDB } from '@docmost/db/types/kysely.types';
import { TemplateRepo } from '@docmost/db/repos/template/template.repo';
import { PageRepo } from '@docmost/db/repos/page/page.repo';
import { SpaceMemberRepo } from '@docmost/db/repos/space/space-member.repo';
import {
  CreateTemplateDto,
  UpdateTemplateDto,
  UseTemplateDto,
} from './dto/template.dto';
import { Template, User, Workspace } from '@docmost/db/types/entity.types';
import { PaginationOptions } from '@docmost/db/pagination/pagination-options';
import { generateSlugId } from '../../common/helpers';
import { PageOperationPolicyService } from '../page/policies/page-operation-policy.service';
import WorkspaceAbilityFactory from '../casl/abilities/workspace-ability.factory';
import SpaceAbilityFactory from '../casl/abilities/space-ability.factory';
import {
  WorkspaceCaslAction,
  WorkspaceCaslSubject,
} from '../casl/interfaces/workspace-ability.type';
import {
  SpaceCaslAction,
  SpaceCaslSubject,
} from '../casl/interfaces/space-ability.type';
import { PageAccessService } from '../page/page-access/page-access.service';

@Injectable()
export class TemplateService {
  constructor(
    private readonly templateRepo: TemplateRepo,
    private readonly pageRepo: PageRepo,
    private readonly spaceMemberRepo: SpaceMemberRepo,
    private readonly pageOperationPolicy: PageOperationPolicyService,
    private readonly pageAccessService: PageAccessService,
    private readonly workspaceAbility: WorkspaceAbilityFactory,
    private readonly spaceAbility: SpaceAbilityFactory,
    @InjectKysely() private readonly db: KyselyDB,
  ) {}

  async findTemplates(
    workspace: Workspace,
    user: User,
    pagination: PaginationOptions,
    spaceId?: string,
  ) {
    const isWorkspaceAdmin = this.isWorkspaceAdmin(user, workspace);
    const accessibleSpaceIds = isWorkspaceAdmin
      ? (
          await this.db
            .selectFrom('spaces')
            .select('id')
            .where('workspaceId', '=', workspace.id)
            .execute()
        ).map((space) => space.id)
      : await this.spaceMemberRepo.getUserSpaceIds(user.id);

    return this.templateRepo.findTemplates(
      workspace.id,
      accessibleSpaceIds,
      pagination,
      { spaceId },
    );
  }

  async findById(templateId: string, user: User, workspace: Workspace) {
    const template = await this.getTemplateOrThrow(templateId, workspace.id, {
      includeContent: true,
    });
    await this.assertCanReadTemplate(template, user, workspace);
    return template;
  }

  async create(dto: CreateTemplateDto, user: User, workspace: Workspace) {
    await this.assertCanCreateTemplate(dto.spaceId, user, workspace);

    const result = await this.templateRepo.insertTemplate({
      title: dto.title,
      description: dto.description,
      content: dto.content,
      icon: dto.icon,
      spaceId: dto.spaceId,
      workspaceId: workspace.id,
      creatorId: user.id,
      lastUpdatedById: user.id,
    });

    return this.templateRepo.findById(result.id, workspace.id, {
      includeContent: true,
    });
  }

  async update(dto: UpdateTemplateDto, user: User, workspace: Workspace) {
    const template = await this.getTemplateOrThrow(
      dto.templateId,
      workspace.id,
    );
    await this.assertCanManageTemplate(template, user, workspace);

    if (dto.spaceId !== undefined && dto.spaceId !== template.spaceId) {
      await this.assertCanCreateTemplate(dto.spaceId, user, workspace);
    }

    await this.templateRepo.updateTemplate(
      {
        title: dto.title,
        description: dto.description,
        content: dto.content,
        icon: dto.icon,
        spaceId: dto.spaceId,
        lastUpdatedById: user.id,
      },
      dto.templateId,
      workspace.id,
    );

    return this.templateRepo.findById(dto.templateId, workspace.id, {
      includeContent: true,
    });
  }

  async delete(templateId: string, user: User, workspace: Workspace) {
    const template = await this.getTemplateOrThrow(templateId, workspace.id);
    await this.assertCanManageTemplate(template, user, workspace);
    await this.templateRepo.deleteTemplate(templateId, workspace.id);
  }

  async useTemplate(dto: UseTemplateDto, user: User, workspace: Workspace) {
    const template = await this.getTemplateOrThrow(
      dto.templateId,
      workspace.id,
      { includeContent: true },
    );
    await this.assertCanReadTemplate(template, user, workspace);
    await this.assertCanEditSpace(dto.spaceId, user, workspace.id);

    if (dto.parentPageId) {
      const parentPage = await this.pageRepo.findById(dto.parentPageId);
      if (
        !parentPage ||
        parentPage.deletedAt ||
        parentPage.workspaceId !== workspace.id ||
        parentPage.spaceId !== dto.spaceId
      ) {
        throw new NotFoundException('Parent page not found');
      }

      await this.pageAccessService.validateCanEdit(parentPage, user);
      await this.pageOperationPolicy.assertOperation({
        operation: 'createChild',
        parentPage,
        actorId: user.id,
      });
    }

    const slugId = generateSlugId();

    return this.pageRepo.insertPage({
      title: template.title,
      content: template.content,
      icon: template.icon,
      slugId,
      spaceId: dto.spaceId,
      parentPageId: dto.parentPageId ?? null,
      workspaceId: workspace.id,
      creatorId: user.id,
      lastUpdatedById: user.id,
    });
  }

  private async getTemplateOrThrow(
    templateId: string,
    workspaceId: string,
    opts?: { includeContent?: boolean },
  ) {
    const template = await this.templateRepo.findById(
      templateId,
      workspaceId,
      opts,
    );
    if (!template) {
      throw new NotFoundException('Template not found');
    }
    return template;
  }

  private async assertCanReadTemplate(
    template: Template,
    user: User,
    workspace: Workspace,
  ) {
    if (!template.spaceId || this.isWorkspaceAdmin(user, workspace)) {
      return;
    }

    try {
      const ability = await this.spaceAbility.createForUser(
        user,
        template.spaceId,
      );
      if (ability.cannot(SpaceCaslAction.Read, SpaceCaslSubject.Page)) {
        throw new Error('Space is not readable');
      }
    } catch {
      throw new NotFoundException('Template not found');
    }
  }

  private async assertCanCreateTemplate(
    spaceId: string | null | undefined,
    user: User,
    workspace: Workspace,
  ) {
    const isWorkspaceAdmin = this.isWorkspaceAdmin(user, workspace);
    if (!spaceId) {
      if (!isWorkspaceAdmin) {
        throw new ForbiddenException();
      }
      return;
    }

    await this.assertWorkspaceSpace(spaceId, workspace.id);
    if (isWorkspaceAdmin) {
      return;
    }

    this.assertMemberTemplatesEnabled(workspace);
    await this.assertCanEditSpace(spaceId, user, workspace.id);
  }

  private async assertCanManageTemplate(
    template: Template,
    user: User,
    workspace: Workspace,
  ) {
    if (this.isWorkspaceAdmin(user, workspace)) {
      return;
    }

    if (!template.spaceId) {
      throw new ForbiddenException();
    }

    this.assertMemberTemplatesEnabled(workspace);
    await this.assertCanEditSpace(template.spaceId, user, workspace.id);
  }

  private assertMemberTemplatesEnabled(workspace: Workspace) {
    const settings = workspace.settings as {
      templates?: { allowMemberTemplates?: boolean };
    } | null;
    if (settings?.templates?.allowMemberTemplates !== true) {
      throw new ForbiddenException();
    }
  }

  private async assertCanEditSpace(
    spaceId: string,
    user: User,
    workspaceId: string,
  ) {
    await this.assertWorkspaceSpace(spaceId, workspaceId);
    try {
      const ability = await this.spaceAbility.createForUser(user, spaceId);
      if (ability.cannot(SpaceCaslAction.Edit, SpaceCaslSubject.Page)) {
        throw new ForbiddenException();
      }
    } catch (error) {
      if (error instanceof ForbiddenException) {
        throw error;
      }
      throw new ForbiddenException();
    }
  }

  private async assertWorkspaceSpace(spaceId: string, workspaceId: string) {
    const space = await this.db
      .selectFrom('spaces')
      .select('id')
      .where('id', '=', spaceId)
      .where('workspaceId', '=', workspaceId)
      .executeTakeFirst();
    if (!space) {
      throw new NotFoundException('Space not found');
    }
  }

  private isWorkspaceAdmin(user: User, workspace: Workspace) {
    const ability = this.workspaceAbility.createForUser(user, workspace);
    return ability.can(
      WorkspaceCaslAction.Manage,
      WorkspaceCaslSubject.Settings,
    );
  }
}
