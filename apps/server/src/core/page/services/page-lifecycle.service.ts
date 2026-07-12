import {
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PageRepo } from '@docmost/db/repos/page/page.repo';
import type { Page, User, Workspace } from '@docmost/db/types/entity.types';
import SpaceAbilityFactory from '../../casl/abilities/space-ability.factory';
import {
  SpaceCaslAction,
  SpaceCaslSubject,
} from '../../casl/interfaces/space-ability.type';
import { PageAccessService } from '../page-access/page-access.service';
import { PageService } from './page.service';
import {
  AUDIT_SERVICE,
  IAuditService,
} from '../../../integrations/audit/audit.service';
import { AuditEvent, AuditResource } from '../../../common/events/audit-events';
import { getPageTitle } from '../../../common/helpers';

@Injectable()
export class PageLifecycleService {
  constructor(
    private readonly pageRepo: PageRepo,
    private readonly pageService: PageService,
    private readonly pageAccessService: PageAccessService,
    private readonly spaceAbility: SpaceAbilityFactory,
    @Inject(AUDIT_SERVICE) private readonly auditService: IAuditService,
  ) {}

  async trashPage(
    pageId: string,
    user: User,
    workspace: Workspace,
  ): Promise<Page> {
    const page = await this.findWorkspacePage(pageId, workspace.id);
    if (page.deletedAt) {
      throw new NotFoundException('Page not found');
    }

    await this.pageAccessService.validateCanEdit(page, user);
    await this.pageService.removePage(page.id, user.id, workspace.id);

    this.auditService.log({
      event: AuditEvent.PAGE_TRASHED,
      resourceType: AuditResource.PAGE,
      resourceId: page.id,
      spaceId: page.spaceId,
      changes: {
        before: {
          pageId: page.id,
          slugId: page.slugId,
          title: getPageTitle(page.title),
          spaceId: page.spaceId,
        },
      },
    });

    return page;
  }

  async restorePage(
    pageId: string,
    user: User,
    workspace: Workspace,
  ): Promise<Page> {
    const page = await this.findWorkspacePage(pageId, workspace.id);
    if (!page.deletedAt) {
      throw new NotFoundException('Page not found');
    }

    const ability = await this.spaceAbility.createForUser(user, page.spaceId);
    if (ability.cannot(SpaceCaslAction.Edit, SpaceCaslSubject.Page)) {
      throw new ForbiddenException();
    }
    await this.pageAccessService.validateCanEdit(page, user);
    await this.pageRepo.restorePage(page.id, workspace.id);

    this.auditService.log({
      event: AuditEvent.PAGE_RESTORED,
      resourceType: AuditResource.PAGE,
      resourceId: page.id,
      spaceId: page.spaceId,
      changes: {
        after: {
          title: getPageTitle(page.title),
          spaceId: page.spaceId,
        },
      },
    });

    const restored = await this.pageRepo.findById(page.id, {
      includeHasChildren: true,
    });
    if (!restored || restored.workspaceId !== workspace.id) {
      throw new NotFoundException('Page not found');
    }
    return restored;
  }

  private async findWorkspacePage(
    pageId: string,
    workspaceId: string,
  ): Promise<Page> {
    const page = await this.pageRepo.findById(pageId);
    if (!page || page.workspaceId !== workspaceId) {
      throw new NotFoundException('Page not found');
    }
    return page;
  }
}
