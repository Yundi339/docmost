import { Injectable } from '@nestjs/common';
import { Page } from '@docmost/db/types/entity.types';
import { PageRepo } from '@docmost/db/repos/page/page.repo';
import { WsService } from './ws.service';

type PageTreeAudience = {
  spaceId: string;
  userIds: string[];
};

type TreePage = Pick<
  Page,
  'id' | 'slugId' | 'title' | 'icon' | 'position' | 'spaceId' | 'parentPageId'
> & { creatorId?: string };

type PageQueryInvalidation = {
  entity: string;
  id?: string;
  mode?: 'invalidate' | 'remove';
};

@Injectable()
export class WsTreeService {
  constructor(
    private readonly wsService: WsService,
    private readonly pageRepo: PageRepo,
  ) {}

  async notifyPageCreated(page: TreePage, hasChildren = false): Promise<void> {
    await this.wsService.emitTreeEvent(
      await this.getPageCreatedEvent(page, hasChildren),
    );
  }

  async notifyPageDeleted(page: TreePage): Promise<void> {
    await this.wsService.emitTreeEvent(this.getPageDeletedEvent(page));
  }

  async capturePageAudience(page: TreePage): Promise<PageTreeAudience> {
    return {
      spaceId: page.spaceId,
      userIds: await this.wsService.getAuthorizedTreeUserIds(
        page.spaceId,
        page.id,
      ),
    };
  }

  async notifyPageRelocated(
    previousPage: TreePage,
    currentPage: TreePage,
    hasChildren: boolean,
    previousAudience: PageTreeAudience,
  ): Promise<void> {
    const currentAudience = await this.capturePageAudience(currentPage);
    const oldUserIds = new Set(previousAudience.userIds);
    const newUserIds = new Set(currentAudience.userIds);

    if (previousPage.spaceId !== currentPage.spaceId) {
      await this.wsService.emitToUsers(
        previousAudience.userIds,
        this.getPageDeletedEvent(previousPage),
      );
      await this.wsService.emitToUsers(
        currentAudience.userIds,
        await this.getPageCreatedEvent(currentPage, hasChildren),
      );
      return;
    }

    const removedUserIds = previousAudience.userIds.filter(
      (userId) => !newUserIds.has(userId),
    );
    const addedUserIds = currentAudience.userIds.filter(
      (userId) => !oldUserIds.has(userId),
    );
    const retainedUserIds = previousAudience.userIds.filter((userId) =>
      newUserIds.has(userId),
    );

    await this.wsService.emitToUsers(
      removedUserIds,
      this.getPageDeletedEvent(previousPage),
    );
    await this.wsService.emitToUsers(
      retainedUserIds,
      await this.getPageMovedEvent(previousPage, currentPage),
    );
    await this.wsService.emitToUsers(
      addedUserIds,
      await this.getPageCreatedEvent(currentPage, hasChildren),
    );
  }

  private async getPageCreatedEvent(page: TreePage, hasChildren: boolean) {
    const index = await this.pageRepo.getSiblingIndex(page);
    return {
      operation: 'addTreeNode',
      spaceId: page.spaceId,
      payload: {
        parentId: page.parentPageId ?? null,
        index,
        data: {
          id: page.id,
          slugId: page.slugId,
          name: page.title ?? '',
          title: page.title,
          icon: page.icon,
          position: page.position,
          spaceId: page.spaceId,
          parentPageId: page.parentPageId,
          creatorId: page.creatorId ?? '',
          hasChildren,
          children: [],
        },
      },
    };
  }

  private getPageDeletedEvent(page: TreePage) {
    return {
      operation: 'deleteTreeNode',
      spaceId: page.spaceId,
      payload: {
        node: {
          id: page.id,
          slugId: page.slugId,
          parentPageId: page.parentPageId,
        },
      },
    };
  }

  private async getPageMovedEvent(
    previousPage: TreePage,
    currentPage: TreePage,
  ) {
    return {
      operation: 'moveTreeNode',
      spaceId: currentPage.spaceId,
      payload: {
        id: currentPage.id,
        oldParentId: previousPage.parentPageId ?? null,
        parentId: currentPage.parentPageId ?? null,
        index: await this.pageRepo.getSiblingIndex(currentPage),
        position: currentPage.position,
        pageData: {
          id: currentPage.id,
          slugId: currentPage.slugId,
          title: currentPage.title,
          icon: currentPage.icon,
          position: currentPage.position,
          spaceId: currentPage.spaceId,
          parentPageId: currentPage.parentPageId,
        },
      },
    };
  }

  async notifyPageUpdated(page: Page): Promise<void> {
    await this.wsService.emitTreeEvent({
      operation: 'updateOne',
      spaceId: page.spaceId,
      entity: ['pages'],
      id: page.id,
      payload: {
        title: page.title,
        icon: page.icon,
        slugId: page.slugId,
        parentPageId: page.parentPageId,
        updatedAt: page.updatedAt,
        lastUpdatedById: page.lastUpdatedById,
      },
    });
  }

  async notifyPageQueriesInvalidated(
    page: Pick<Page, 'id' | 'spaceId'>,
    invalidations: PageQueryInvalidation[],
  ): Promise<void> {
    for (const invalidation of invalidations) {
      await this.wsService.emitPageEvent(page.spaceId, page.id, {
        operation:
          invalidation.mode === 'remove' ? 'removeQuery' : 'invalidate',
        spaceId: page.spaceId,
        entity: [invalidation.entity],
        id: invalidation.id,
      });
    }
  }

  async notifyPageRestricted(page: Page, excludeUserId: string): Promise<void> {
    await this.wsService.emitToSpaceExceptUsers(page.spaceId, [excludeUserId], {
      operation: 'deleteTreeNode',
      spaceId: page.spaceId,
      payload: {
        node: {
          id: page.id,
          slugId: page.slugId,
        },
      },
    });
  }

  async notifyPermissionGranted(page: Page, userIds: string[]): Promise<void> {
    if (userIds.length === 0) return;

    await this.wsService.emitToUsers(
      userIds,
      await this.getPageCreatedEvent(page, false),
    );
  }
}
