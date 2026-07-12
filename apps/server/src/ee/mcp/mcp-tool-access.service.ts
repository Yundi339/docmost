import { ForbiddenException, Injectable } from '@nestjs/common';
import { PageRepo } from '@docmost/db/repos/page/page.repo';
import type { Page, User } from '@docmost/db/types/entity.types';
import { PaginationOptions } from '../../database/pagination/pagination-options';
import SpaceAbilityFactory from '../../core/casl/abilities/space-ability.factory';
import {
  SpaceCaslAction,
  SpaceCaslSubject,
} from '../../core/casl/interfaces/space-ability.type';
import { PageAccessService } from '../../core/page/page-access/page-access.service';

const MAX_LIMIT = 200;

@Injectable()
export class McpToolAccessService {
  constructor(
    private readonly pageRepo: PageRepo,
    private readonly spaceAbility: SpaceAbilityFactory,
    private readonly pageAccessService: PageAccessService,
  ) {}

  paginate(limit?: number): PaginationOptions {
    const options = new PaginationOptions();
    options.limit = Math.min(Math.max(1, limit ?? 50), MAX_LIMIT);
    options.query = '';
    options.adminView = false;
    return options;
  }

  async findActiveWorkspacePage(
    pageId: string,
    workspaceId: string,
    options?: Parameters<PageRepo['findById']>[1],
  ): Promise<Page | null> {
    const page = await this.pageRepo.findById(pageId, options);
    if (!page || page.workspaceId !== workspaceId || page.deletedAt) {
      return null;
    }
    return page;
  }

  async assertSpacePageAccess(
    user: User,
    spaceId: string,
    action: SpaceCaslAction = SpaceCaslAction.Read,
  ): Promise<void> {
    const ability = await this.spaceAbility.createForUser(user, spaceId);
    if (ability.cannot(action, SpaceCaslSubject.Page)) {
      throw new ForbiddenException('Forbidden: insufficient space permissions');
    }
  }

  async getSpacePageEditAccess(user: User, spaceId: string): Promise<boolean> {
    const ability = await this.spaceAbility.createForUser(user, spaceId);
    if (ability.cannot(SpaceCaslAction.Read, SpaceCaslSubject.Page)) {
      throw new ForbiddenException('Forbidden: insufficient space permissions');
    }
    return ability.can(SpaceCaslAction.Edit, SpaceCaslSubject.Page);
  }

  async assertSpaceSettingsManage(user: User, spaceId: string): Promise<void> {
    const ability = await this.spaceAbility.createForUser(user, spaceId);
    if (ability.cannot(SpaceCaslAction.Manage, SpaceCaslSubject.Settings)) {
      throw new ForbiddenException(
        'Forbidden: space settings management required',
      );
    }
  }

  async assertSpaceSettingsRead(user: User, spaceId: string): Promise<void> {
    const ability = await this.spaceAbility.createForUser(user, spaceId);
    if (ability.cannot(SpaceCaslAction.Read, SpaceCaslSubject.Settings)) {
      throw new ForbiddenException('Forbidden: space settings read required');
    }
  }

  validateCanView(page: Page, user: User): Promise<void> {
    return this.pageAccessService.validateCanView(page, user);
  }

  async validateCanEdit(page: Page, user: User): Promise<void> {
    await this.pageAccessService.validateCanEdit(page, user);
  }

  async validateCanComment(
    page: Page,
    user: User,
    workspaceId: string,
  ): Promise<void> {
    await this.pageAccessService.validateCanComment(page, user, workspaceId);
  }
}
