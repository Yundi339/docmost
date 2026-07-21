import {
  ForbiddenException,
  HttpException,
  Inject,
  Injectable,
  Logger,
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
import { KyselyDB, KyselyTransaction } from '@docmost/db/types/kysely.types';
import { executeTx } from '@docmost/db/utils';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { EventName } from '../../../common/events/event.contants';

export type PageBatchOperationResult = {
  succeededPageIds: string[];
  failedPageIds: string[];
};

@Injectable()
export class PageLifecycleService {
  private readonly logger = new Logger(PageLifecycleService.name);

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
    allowedSpaceIds?: readonly string[],
  ): Promise<Page> {
    const page = await this.findWorkspacePage(pageId, workspace.id);
    this.assertAllowedSpace(page.spaceId, allowedSpaceIds);
    if (page.deletedAt) {
      throw new NotFoundException('Page not found');
    }

    let trashedPageIds: string[] = [];
    await executeTx(this.db, async (trx) => {
      const descendants = await this.lockDescendantPages(
        page.id,
        workspace.id,
        false,
        trx,
      );
      const currentPage = descendants.find(
        (descendant) => descendant.id === page.id,
      );
      if (
        !currentPage ||
        currentPage.deletedAt ||
        currentPage.spaceId !== page.spaceId ||
        currentPage.parentPageId !== page.parentPageId
      ) {
        throw new NotFoundException('Page not found');
      }

      await this.validateCanEditDescendants(
        descendants,
        user,
        workspace.id,
        allowedSpaceIds,
      );
      trashedPageIds = await this.pageRepo.removePage(
        currentPage.id,
        user.id,
        workspace.id,
        trx,
        false,
      );
      this.assertSamePageSet(descendants, trashedPageIds);
    });

    this.eventEmitter.emit(EventName.PAGE_SOFT_DELETED, {
      pageIds: trashedPageIds,
      workspaceId: workspace.id,
    });

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
    allowedSpaceIds?: readonly string[],
  ): Promise<Page> {
    const page = await this.findWorkspacePage(pageId, workspace.id);
    this.assertAllowedSpace(page.spaceId, allowedSpaceIds);
    if (!page.deletedAt) {
      throw new NotFoundException('Page not found');
    }

    let restoredPageIds: string[] = [];
    await executeTx(this.db, async (trx) => {
      if (page.parentPageId) {
        await this.pageRepo.findById(page.parentPageId, {
          withLock: true,
          trx,
        });
      }
      const descendants = await this.lockDescendantPages(
        page.id,
        workspace.id,
        true,
        trx,
      );
      const currentPage = descendants.find(
        (descendant) => descendant.id === page.id,
      );
      if (
        !currentPage ||
        !currentPage.deletedAt ||
        currentPage.workspaceId !== workspace.id ||
        currentPage.spaceId !== page.spaceId ||
        currentPage.parentPageId !== page.parentPageId
      ) {
        throw new NotFoundException('Page not found');
      }
      await this.validateCanEditDescendants(
        descendants,
        user,
        workspace.id,
        allowedSpaceIds,
      );

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
      this.assertSamePageSet(descendants, restoredPageIds);
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

  async restorePages(
    pageIds: string[],
    user: User,
    workspace: Workspace,
  ): Promise<PageBatchOperationResult> {
    return this.runBatchOperation('restore', pageIds, (pageId) =>
      this.restorePage(pageId, user, workspace),
    );
  }

  async permanentlyDeletePage(
    pageId: string,
    user: User,
    workspace: Workspace,
  ): Promise<Page> {
    const page = await this.findWorkspacePage(pageId, workspace.id);
    if (!page.deletedAt) {
      throw new NotFoundException('Page not found');
    }

    const ability = await this.spaceAbility.createForUser(user, page.spaceId);
    if (ability.cannot(SpaceCaslAction.Manage, SpaceCaslSubject.Settings)) {
      throw new ForbiddenException(
        'Only space admins can permanently delete pages',
      );
    }

    let deletedPageIds: string[] = [];
    await executeTx(this.db, async (trx) => {
      const descendants = await this.lockDescendantPages(
        page.id,
        workspace.id,
        true,
        trx,
      );
      const currentPage = descendants.find(
        (descendant) => descendant.id === page.id,
      );
      if (
        !currentPage ||
        !currentPage.deletedAt ||
        currentPage.workspaceId !== workspace.id ||
        currentPage.spaceId !== page.spaceId ||
        currentPage.parentPageId !== page.parentPageId
      ) {
        throw new NotFoundException('Page not found');
      }

      await this.pageAccessService.validateCanViewPages(descendants, user);
      for (const spaceId of new Set(
        descendants.map((descendant) => descendant.spaceId),
      )) {
        const descendantAbility = await this.spaceAbility.createForUser(
          user,
          spaceId,
        );
        if (
          descendantAbility.cannot(
            SpaceCaslAction.Manage,
            SpaceCaslSubject.Settings,
          )
        ) {
          throw new ForbiddenException(
            'Only space admins can permanently delete pages',
          );
        }
      }

      deletedPageIds = await this.pageService.forceDelete(
        currentPage.id,
        workspace.id,
        trx,
        false,
      );
      this.assertSamePageSet(descendants, deletedPageIds);
    });

    await this.pageService.finalizeForceDelete(deletedPageIds, workspace.id);

    this.auditService.log({
      event: AuditEvent.PAGE_DELETED,
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

  async permanentlyDeletePages(
    pageIds: string[],
    user: User,
    workspace: Workspace,
  ): Promise<PageBatchOperationResult> {
    return this.runBatchOperation('permanently delete', pageIds, (pageId) =>
      this.permanentlyDeletePage(pageId, user, workspace),
    );
  }

  private async runBatchOperation(
    operation: string,
    pageIds: string[],
    handler: (pageId: string) => Promise<Page>,
  ): Promise<PageBatchOperationResult> {
    const succeededPageIds: string[] = [];
    const failedPageIds: string[] = [];

    for (const pageId of new Set(pageIds)) {
      try {
        await handler(pageId);
        succeededPageIds.push(pageId);
      } catch (error) {
        failedPageIds.push(pageId);
        if (!(error instanceof HttpException)) {
          this.logger.error(
            `Failed to ${operation} page ${pageId}`,
            error instanceof Error ? error.stack : undefined,
          );
        }
      }
    }

    return { succeededPageIds, failedPageIds };
  }

  private async lockDescendantPages(
    pageId: string,
    workspaceId: string,
    includeDeleted: boolean,
    trx: KyselyTransaction,
  ): Promise<Page[]> {
    const pages = (await trx
      .withRecursive('page_descendants', (db) =>
        db
          .selectFrom('pages')
          .select('id')
          .where('id', '=', pageId)
          .where('workspaceId', '=', workspaceId)
          .$if(!includeDeleted, (query) => query.where('deletedAt', 'is', null))
          .unionAll((expression) =>
            expression
              .selectFrom('pages as child')
              .select('child.id')
              .innerJoin(
                'page_descendants as parent',
                'parent.id',
                'child.parentPageId',
              )
              .where('child.workspaceId', '=', workspaceId)
              .$if(!includeDeleted, (query) =>
                query.where('child.deletedAt', 'is', null),
              ),
          ),
      )
      .selectFrom('pages')
      .innerJoin('page_descendants', 'page_descendants.id', 'pages.id')
      .selectAll('pages')
      .orderBy('pages.id')
      .forUpdate('pages')
      .execute()) as Page[];

    const pageIds = pages.map((page) => page.id);
    if (pageIds.length === 0) return pages;

    const pageAccessRows = await trx
      .selectFrom('pageAccess')
      .select('id')
      .where('pageId', 'in', pageIds)
      .orderBy('id')
      .forUpdate()
      .execute();
    const pageAccessIds = pageAccessRows.map((row) => row.id);
    if (pageAccessIds.length > 0) {
      await trx
        .selectFrom('pagePermissions')
        .select('id')
        .where('pageAccessId', 'in', pageAccessIds)
        .orderBy('id')
        .forUpdate()
        .execute();
    }

    return pages;
  }

  private async validateCanEditDescendants(
    pages: Page[],
    user: User,
    workspaceId: string,
    allowedSpaceIds?: readonly string[],
  ) {
    if (pages.length === 0) {
      throw new NotFoundException('Page not found');
    }
    for (const page of pages) {
      if (page.workspaceId !== workspaceId) {
        throw new NotFoundException('Page not found');
      }
      this.assertAllowedSpace(page.spaceId, allowedSpaceIds);
    }
    await this.pageAccessService.validateCanEditPages(pages, user);
  }

  private assertSamePageSet(pages: Page[], affectedPageIds: string[]) {
    const expectedPageIds = new Set(pages.map((page) => page.id));
    if (
      affectedPageIds.length !== expectedPageIds.size ||
      affectedPageIds.some((pageId) => !expectedPageIds.has(pageId))
    ) {
      throw new ForbiddenException();
    }
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

  private assertAllowedSpace(
    spaceId: string,
    allowedSpaceIds?: readonly string[],
  ) {
    if (allowedSpaceIds && !allowedSpaceIds.includes(spaceId)) {
      throw new NotFoundException('Page not found');
    }
  }
}
