import { Inject, Injectable } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { PageRepo } from '@docmost/db/repos/page/page.repo';
import { Json } from '@docmost/db/types/db';
import { EventName } from '../../common/events/event.contants';
import { AuditEvent, AuditResource } from '../../common/events/audit-events';
import {
  AUDIT_SERVICE,
  IAuditService,
} from '../../integrations/audit/audit.service';
import { WsTreeService } from '../../ws/ws-tree.service';
import { DatabaseRepo } from './database.repo';
import { getPrimaryDatabaseFieldName } from './database.templates';

type PageUpdatedEvent = {
  pageIds: string[];
  workspaceId: string;
  databaseInvalidationHandled?: boolean;
};

@Injectable()
export class DatabasePageLifecycleListener {
  constructor(
    private readonly databaseRepo: DatabaseRepo,
    private readonly pageRepo: PageRepo,
    private readonly wsTreeService: WsTreeService,
    @Inject(AUDIT_SERVICE) private readonly auditService: IAuditService,
  ) {}

  @OnEvent(EventName.PAGE_UPDATED)
  async handlePageUpdated(event: PageUpdatedEvent): Promise<void> {
    for (const pageId of new Set(event.pageIds)) {
      await this.syncWorkItemTitle(pageId, event.workspaceId);
    }
  }

  @OnEvent(EventName.PAGE_SOFT_DELETED)
  async handlePageSoftDeleted(event: PageUpdatedEvent): Promise<void> {
    await this.handlePageLifecycleChanged(event);
  }

  @OnEvent(EventName.PAGE_RESTORED)
  async handlePageRestored(event: PageUpdatedEvent): Promise<void> {
    await this.handlePageLifecycleChanged(event);
  }

  async handlePageLifecycleChanged(event: PageUpdatedEvent): Promise<void> {
    if (event.databaseInvalidationHandled) return;

    const owners =
      await this.databaseRepo.listActiveDatabaseOwnersByRecordPages([
        ...new Set(event.pageIds),
      ]);
    for (const owner of owners) {
      if (owner.workspaceId !== event.workspaceId) continue;

      await this.wsTreeService.notifyPageQueriesInvalidated(
        { id: owner.databasePageId, spaceId: owner.spaceId },
        [
          { entity: 'database-records', id: owner.databaseId },
          { entity: 'sidebar-full-tree', id: owner.spaceId },
        ],
      );
    }
  }

  private async syncWorkItemTitle(
    pageId: string,
    workspaceId: string,
  ): Promise<void> {
    const page = await this.pageRepo.findById(pageId);
    if (!page || page.deletedAt || page.workspaceId !== workspaceId) return;

    const memberships = await this.databaseRepo.listActiveDatabaseRecordsByPage(
      page.id,
    );
    if (memberships.length !== 1) return;

    const record = memberships[0];
    const database = await this.databaseRepo.findById(record.databaseId);
    if (
      !database ||
      database.workspaceId !== page.workspaceId ||
      database.spaceId !== page.spaceId ||
      database.pageId !== page.parentPageId
    ) {
      return;
    }

    const primaryFieldName = getPrimaryDatabaseFieldName(database.fields);
    if (!primaryFieldName) return;

    const fields = (record.fields as Record<string, unknown>) ?? {};
    const title = page.title?.trim() || 'Untitled';
    if (fields[primaryFieldName] === title) return;

    await this.databaseRepo.updateDatabaseRecordFields(
      database.id,
      record.id,
      { ...fields, [primaryFieldName]: title } as unknown as Json,
      page.lastUpdatedById,
    );

    this.auditService.logWithContext(
      {
        event: AuditEvent.DATABASE_RECORD_UPDATED,
        resourceType: AuditResource.PAGE,
        resourceId: page.id,
        spaceId: page.spaceId,
        metadata: {
          databaseId: database.id,
          recordId: record.id,
          databasePageId: database.pageId,
          changedFields: [primaryFieldName],
          source: 'page_title',
        },
      },
      {
        workspaceId: page.workspaceId,
        actorId: page.lastUpdatedById,
        actorType: 'user',
      },
    );

    await this.wsTreeService.notifyPageQueriesInvalidated(
      { id: database.pageId, spaceId: database.spaceId },
      [{ entity: 'database-records', id: database.id }],
    );
  }
}
