import { DatabasePageLifecycleListener } from './database-page-lifecycle.listener';

describe('DatabasePageLifecycleListener', () => {
  const page = {
    id: 'page_1',
    title: 'Updated title',
    spaceId: 'space_1',
    workspaceId: 'workspace_1',
    parentPageId: 'database_page_1',
    lastUpdatedById: 'user_1',
    deletedAt: null,
  };
  const record = {
    id: 'record_1',
    databaseId: 'database_1',
    fields: { Task: 'Old title', Status: 'Todo' },
  };
  const database = {
    id: 'database_1',
    pageId: 'database_page_1',
    spaceId: 'space_1',
    workspaceId: 'workspace_1',
    fields: [
      { name: 'Task', type: 'text', isPrimary: true },
      { name: 'Status', type: 'singleSelect' },
    ],
  };

  function createListener() {
    const databaseRepo = {
      listActiveDatabaseRecordsByPage: jest.fn().mockResolvedValue([record]),
      listActiveDatabaseOwnersByRecordPages: jest.fn().mockResolvedValue([]),
      findById: jest.fn().mockResolvedValue(database),
      updateDatabaseRecordFields: jest.fn().mockResolvedValue(undefined),
    };
    const pageRepo = { findById: jest.fn().mockResolvedValue(page) };
    const wsTreeService = {
      notifyPageQueriesInvalidated: jest.fn().mockResolvedValue(undefined),
    };
    const auditService = { logWithContext: jest.fn() };
    return {
      listener: new DatabasePageLifecycleListener(
        databaseRepo as never,
        pageRepo as never,
        wsTreeService as never,
        auditService as never,
      ),
      auditService,
      databaseRepo,
      wsTreeService,
    };
  }

  it('syncs a renamed primary field after a generic page title update', async () => {
    const { listener, auditService, databaseRepo, wsTreeService } =
      createListener();

    await listener.handlePageUpdated({
      pageIds: [page.id],
      workspaceId: page.workspaceId,
    });

    expect(databaseRepo.updateDatabaseRecordFields).toHaveBeenCalledWith(
      database.id,
      record.id,
      { Task: page.title, Status: 'Todo' },
      page.lastUpdatedById,
    );
    expect(auditService.logWithContext).toHaveBeenCalledWith(
      expect.objectContaining({
        resourceId: page.id,
        metadata: expect.objectContaining({ changedFields: ['Task'] }),
      }),
      expect.objectContaining({ actorId: page.lastUpdatedById }),
    );
    expect(wsTreeService.notifyPageQueriesInvalidated).toHaveBeenCalled();
  });

  it('does nothing when the record title already matches', async () => {
    const { listener, databaseRepo } = createListener();
    databaseRepo.listActiveDatabaseRecordsByPage.mockResolvedValue([
      { ...record, fields: { ...record.fields, Task: page.title } },
    ]);

    await listener.handlePageUpdated({
      pageIds: [page.id],
      workspaceId: page.workspaceId,
    });

    expect(databaseRepo.updateDatabaseRecordFields).not.toHaveBeenCalled();
  });

  it('invalidates board and tree queries after generic trash or restore', async () => {
    const { listener, databaseRepo, wsTreeService } = createListener();
    databaseRepo.listActiveDatabaseOwnersByRecordPages.mockResolvedValue([
      {
        databaseId: database.id,
        databasePageId: database.pageId,
        spaceId: database.spaceId,
        workspaceId: database.workspaceId,
      },
    ]);

    await listener.handlePageLifecycleChanged({
      pageIds: [page.id],
      workspaceId: page.workspaceId,
    });

    expect(wsTreeService.notifyPageQueriesInvalidated).toHaveBeenCalledWith(
      { id: database.pageId, spaceId: database.spaceId },
      [
        { entity: 'database-records', id: database.id },
        { entity: 'sidebar-full-tree', id: database.spaceId },
      ],
    );
  });
});
