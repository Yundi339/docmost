import { Injectable, Logger } from '@nestjs/common';
import { PageVisitorRepo } from '@docmost/db/repos/page/page-visitor.repo';
import { PaginationOptions } from '@docmost/db/pagination/pagination-options';

@Injectable()
export class PageVisitorService {
  private readonly logger = new Logger(PageVisitorService.name);

  constructor(private readonly pageVisitorRepo: PageVisitorRepo) {}

  /**
   * Fire-and-forget: never throws. Called from /pages/info so failures
   * (e.g. transient DB errors) must not break page rendering.
   */
  async recordVisit(args: {
    pageId: string;
    userId: string;
    workspaceId: string;
  }): Promise<void> {
    try {
      await this.pageVisitorRepo.recordVisit(args);
    } catch (err) {
      this.logger.warn(
        `recordVisit failed page=${args.pageId} user=${args.userId}: ${(err as Error)?.message}`,
      );
    }
  }

  async listVisitors(pageId: string, pagination: PaginationOptions) {
    return this.pageVisitorRepo.listVisitorsByPageId(pageId, pagination);
  }
}
