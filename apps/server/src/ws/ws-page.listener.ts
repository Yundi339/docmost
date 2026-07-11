import { Injectable } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { EventName } from '../common/events/event.contants';
import { PageRepo } from '@docmost/db/repos/page/page.repo';
import { Page } from '@docmost/db/types/entity.types';
import { WsTreeService } from './ws-tree.service';

type PageLifecycleEvent = {
  pageIds: string[];
  workspaceId: string;
};

@Injectable()
export class WsPageListener {
  constructor(
    private readonly pageRepo: PageRepo,
    private readonly wsTreeService: WsTreeService,
  ) {}

  @OnEvent(EventName.PAGE_CREATED)
  async handlePageCreated(event: PageLifecycleEvent): Promise<void> {
    for (const page of await this.getRootPages(event.pageIds)) {
      await this.wsTreeService.notifyPageCreated(
        page.page,
        page.hasChildren,
      );
    }
  }

  @OnEvent(EventName.PAGE_SOFT_DELETED)
  async handlePageSoftDeleted(event: PageLifecycleEvent): Promise<void> {
    for (const page of await this.getRootPages(event.pageIds)) {
      await this.wsTreeService.notifyPageDeleted(page.page);
    }
  }

  @OnEvent(EventName.PAGE_RESTORED)
  async handlePageRestored(event: PageLifecycleEvent): Promise<void> {
    for (const page of await this.getRootPages(event.pageIds)) {
      await this.wsTreeService.notifyPageCreated(
        page.page,
        page.hasChildren,
      );
    }
  }

  private async getRootPages(pageIds: string[]): Promise<
    Array<{ page: Page; hasChildren: boolean }>
  > {
    const pages = (
      await Promise.all(
        pageIds.map(async (pageId) => {
          const page = await this.pageRepo.findById(pageId, {
            includeHasChildren: true,
          });
          if (!page) return null;
          const pageWithChildren = page as Page & { hasChildren?: boolean };
          return {
            page,
            hasChildren: Boolean(pageWithChildren.hasChildren),
          };
        }),
      )
    ).filter((page): page is { page: Page; hasChildren: boolean } => !!page);

    const pageIdSet = new Set(pages.map(({ page }) => page.id));
    return pages.filter(({ page }) => !page.parentPageId || !pageIdSet.has(page.parentPageId));
  }
}
