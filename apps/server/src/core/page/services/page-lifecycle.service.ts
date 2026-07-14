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
import { PageOperationPolicyService } from '../policies/page-operation-policy.service';
import { InjectKysely } from 'nestjs-kysely';
import { KyselyDB } from '@docmost/db/types/kysely.types';
import { executeTx } from '@docmost/db/utils';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { EventName } from '../../../common/events/event.contants';

@Injectable()
export class PageLifecycleService {
  constructor(
    private readonly pageRepo: PageRepo,
    private readonly pageService: PageService,
    private readonly pageAccessService: PageAccessService,
    private readonly spaceAbility: SpaceAbilityFactory,
    private readonly pageOperationPolicy: PageOperationPolicyService,
    @InjectKysely() private readonly db: KyselyDB,
    private readonly eventEmitter: EventEmitter2,
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
    let restoredPageIds: string[] = [];
    await executeTx(this.db, async (trx) => {
      const currentPage = await this.pageRepo.findById(page.id, {
        withLock: true,
        trx,
      });
      if (
        !currentPage ||
        !currentPage.deletedAt ||
        currentPage.workspaceId !== workspace.id ||
        currentPage.spaceId !== page.spaceId ||
        currentPage.parentPageId !== page.parentPageId
      ) {
        throw new NotFoundException('Page not found');
      }

      await this.pageOperationPolicy.assertOperation({
        operation: 'restore',
        page: currentPage,
        actorId: user.id,
        trx,
      });
      restoredPageIds = await this.pageRepo.restorePage(
        currentPage.id,
        workspace.id,
        trx,
        false,
      );
    });

    if (restoredPageIds.length > 0) {
      this.eventEmitter.emit(EventName.PAGE_RESTORED, {
        pageIds: restoredPageIds,
        workspaceId: workspace.id,
      });
    }

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
