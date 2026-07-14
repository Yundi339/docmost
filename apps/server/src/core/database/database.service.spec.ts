jest.mock('uuid', () => ({ v7: jest.fn(() => 'uuid_1') }));
jest.mock('../../common/helpers/prosemirror/utils', () => ({
  createYdocFromJson: jest.fn(() => undefined),
}));
jest.mock('../page/services/page.service', () => ({
  PageService: jest.fn(),
}));

import { DatabaseService } from './database.service';
import { buildDefaultFieldsForTemplate } from './database.templates';
import {
  DatabaseBlock,
  DatabaseRecord,
  Page,
  User,
} from '@docmost/db/types/entity.types';

describe('DatabaseService', () => {
  const user = { id: 'user_1', workspaceId: 'workspace_1' } as User;
  const page = {
    id: 'page_1',
    spaceId: 'space_1',
    workspaceId: 'workspace_1',
    deletedAt: null,
  } as Page;

  let databaseRepo: {
    findById: jest.Mock;
    listByWorkspace: jest.Mock;
    listActiveWorkspaceUserIds: jest.Mock;
    findByPageAndBlock: jest.Mock;
    insertDatabaseBlock: jest.Mock;
    updateViews: jest.Mock;
    updateFields: jest.Mock;
    updateMetadata: jest.Mock;
    insertDatabaseRecord: jest.Mock;
    insertDatabaseRecords: jest.Mock;
    listDatabaseRecords: jest.Mock;
    findDatabaseRecord: jest.Mock;
    findDatabaseRecordByPage: jest.Mock;
    listActiveDatabaseRecordsByPage: jest.Mock;
    updateDatabaseRecordFields: jest.Mock;
    backfillDatabaseRecordField: jest.Mock;
    renameDatabaseRecordField: jest.Mock;
    updateDatabaseRecordPageId: jest.Mock;
    updateDatabaseRecordSort: jest.Mock;
    detachDatabaseRecord: jest.Mock;
    getLastDatabaseRecordSortOrder: jest.Mock;
    getLastChildPagePosition: jest.Mock;
  };
  let pageRepo: {
    findById: jest.Mock;
    findByIds: jest.Mock;
    insertPage: jest.Mock;
    updatePage: jest.Mock;
    removePage: jest.Mock;
  };
  let pageAccessService: {
    validateCanEdit: jest.Mock;
    validateCanView: jest.Mock;
    validateCanViewWithPermissions: jest.Mock;
    filterViewablePagesWithPermissions: jest.Mock;
  };
  let pageService: {
    movePageToParent: jest.Mock;
    movePageToSpace: jest.Mock;
  };
  let pageOperationPolicy: { assertOperation: jest.Mock };
  let apitableClient: {
    createDatasheet: jest.Mock;
    listRecords: jest.Mock;
    createRecord: jest.Mock;
    updateRecord: jest.Mock;
    buildPublicEmbedUrl: jest.Mock;
  };
  let db: { transaction: jest.Mock };
  let wsTreeService: {
    capturePageAudience: jest.Mock;
    notifyPageRelocated: jest.Mock;
    notifyPageUpdated: jest.Mock;
    notifyPageQueriesInvalidated: jest.Mock;
  };
  let eventEmitter: { emit: jest.Mock };
  let auditService: { log: jest.Mock };
  let trx: Record<string, never>;
  let service: DatabaseService;

  beforeEach(() => {
    databaseRepo = {
      findById: jest.fn(),
      listByWorkspace: jest.fn(),
      listActiveWorkspaceUserIds: jest.fn().mockResolvedValue([]),
      findByPageAndBlock: jest.fn(),
      insertDatabaseBlock: jest.fn(),
      updateViews: jest.fn(),
      updateFields: jest.fn(),
      updateMetadata: jest.fn(),
      insertDatabaseRecord: jest.fn(),
      insertDatabaseRecords: jest.fn(),
      listDatabaseRecords: jest.fn(),
      findDatabaseRecord: jest.fn(),
      findDatabaseRecordByPage: jest.fn(),
      listActiveDatabaseRecordsByPage: jest.fn().mockResolvedValue([]),
      updateDatabaseRecordFields: jest.fn(),
      backfillDatabaseRecordField: jest.fn(),
      renameDatabaseRecordField: jest.fn(),
      updateDatabaseRecordPageId: jest.fn(),
      updateDatabaseRecordSort: jest.fn(),
      detachDatabaseRecord: jest.fn(),
      getLastDatabaseRecordSortOrder: jest.fn().mockResolvedValue(null),
      getLastChildPagePosition: jest.fn().mockResolvedValue(null),
    };
    pageRepo = {
      findById: jest.fn(),
      findByIds: jest.fn().mockResolvedValue([]),
      insertPage: jest.fn().mockImplementation(async (input) =>
        makePage({
          ...input,
          id: `record_page_${Math.random().toString(36).slice(2)}`,
          deletedAt: null,
        }),
      ),
      updatePage: jest.fn(),
      removePage: jest.fn().mockResolvedValue(['record_page_1']),
    };
    pageAccessService = {
      validateCanEdit: jest.fn(),
      validateCanView: jest.fn(),
      validateCanViewWithPermissions: jest
        .fn()
        .mockResolvedValue({ canEdit: true, hasRestriction: false }),
      filterViewablePagesWithPermissions: jest.fn().mockResolvedValue([]),
    };
    pageService = {
      movePageToParent: jest.fn(),
      movePageToSpace: jest.fn(),
    };
    pageOperationPolicy = {
      assertOperation: jest.fn().mockResolvedValue(undefined),
    };
    apitableClient = {
      createDatasheet: jest.fn(),
      listRecords: jest.fn(),
      createRecord: jest.fn(),
      updateRecord: jest.fn(),
      buildPublicEmbedUrl: jest.fn(),
    };
    trx = {};
    db = {
      transaction: jest.fn(() => ({
        execute: (callback: (trx: Record<string, never>) => Promise<unknown>) =>
          callback(trx),
      })),
    };
    wsTreeService = {
      capturePageAudience: jest.fn().mockResolvedValue({
        spaceId: 'space_1',
        userIds: [],
      }),
      notifyPageRelocated: jest.fn().mockResolvedValue(undefined),
      notifyPageUpdated: jest.fn().mockResolvedValue(undefined),
      notifyPageQueriesInvalidated: jest.fn().mockResolvedValue(undefined),
    };
    eventEmitter = { emit: jest.fn() };
    auditService = { log: jest.fn() };

    service = new DatabaseService(
      databaseRepo as never,
      pageRepo as never,
      pageAccessService as never,
      pageService as never,
      pageOperationPolicy as never,
      apitableClient as never,
      db as never,
      wsTreeService as never,
      eventEmitter as never,
      auditService as never,
    );
  });

  it('creates a tasks database only after validating page edit permission', async () => {
    pageRepo.findById.mockResolvedValue(page);
    databaseRepo.findByPageAndBlock.mockResolvedValue(undefined);
    apitableClient.createDatasheet.mockResolvedValue({
      datasheetId: 'native_datasheet_1',
      provider: 'docmost-native',
    });
    databaseRepo.insertDatabaseBlock.mockImplementation(async (input) =>
      makeDatabaseBlock({
        ...input,
        id: 'database_1',
        createdAt: new Date('2026-05-16T00:00:00.000Z'),
        updatedAt: new Date('2026-05-16T00:00:00.000Z'),
        deletedAt: null,
      }),
    );

    const result = await service.createDatabase(
      {
        pageId: page.id,
        blockId: 'block_1',
        template: 'tasks',
        viewType: 'kanban',
      },
      user,
    );

    expect(pageAccessService.validateCanEdit).toHaveBeenCalledWith(page, user);
    expect(apitableClient.createDatasheet).toHaveBeenCalledWith(
      expect.objectContaining({
        title: 'Tasks',
        fields: expect.arrayContaining([
          expect.objectContaining({ name: 'Status', type: 'singleSelect' }),
          expect.objectContaining({ name: 'Assignee', type: 'user' }),
          expect.objectContaining({ name: 'Due date', type: 'date' }),
        ]),
      }),
    );
    expect(databaseRepo.insertDatabaseBlock).toHaveBeenCalledWith(
      expect.objectContaining({
        activeViewId: 'kanban',
        apitableDatasheetId: 'native_datasheet_1',
        metadata: expect.objectContaining({
          provider: 'docmost-native',
        }),
      }),
      trx,
    );
    expect(databaseRepo.insertDatabaseRecords).toHaveBeenCalledWith(
      expect.arrayContaining([
        expect.objectContaining({
          databaseId: 'database_1',
          fields: expect.objectContaining({
            Title: 'Draft project brief',
            Status: 'Todo',
          }),
        }),
      ]),
      trx,
    );
    expect(result).toMatchObject({
      id: 'database_1',
      title: 'Tasks',
      activeViewId: 'kanban',
    });
  });

  it('lists native Docmost records after validating page view permission', async () => {
    const database = makeDatabaseBlock({
      metadata: { provider: 'docmost-native' },
    });
    databaseRepo.findById.mockResolvedValue(database);
    databaseRepo.listDatabaseRecords.mockResolvedValue([
      makeDatabaseRecord({
        id: 'record_1',
        pageId: 'record_page_1',
        fields: {
          Title: 'Ship APITable fusion',
          Status: 'In progress',
          Assignee: ['user_1'],
        },
      }),
    ]);
    const recordPage = makePage({
      id: 'record_page_1',
      parentPageId: database.pageId,
    });
    pageRepo.findById.mockResolvedValue(page);
    pageRepo.findByIds.mockResolvedValue([recordPage]);
    pageAccessService.filterViewablePagesWithPermissions.mockResolvedValue([
      { page: recordPage, canEdit: true },
    ]);

    const result = await service.listRecords(database.id, user);

    expect(pageAccessService.validateCanView).toHaveBeenCalledWith(page, user);
    expect(pageAccessService.validateCanEdit).not.toHaveBeenCalled();
    expect(databaseRepo.listDatabaseRecords).toHaveBeenCalledWith(database.id);
    expect(pageRepo.findByIds).toHaveBeenCalledWith(['record_page_1']);
    expect(
      pageAccessService.filterViewablePagesWithPermissions,
    ).toHaveBeenCalledWith([recordPage], user);
    expect(result.items).toEqual([
      expect.objectContaining({
        id: 'record_1',
        title: 'Ship APITable fusion',
        status: 'In progress',
        assigneeIds: ['user_1'],
      }),
    ]);
  });

  it('does not recreate a record page that was moved to trash', async () => {
    const database = makeDatabaseBlock({
      metadata: { provider: 'docmost-native' },
    });
    const deletedRecordPage = makePage({
      id: 'record_page_1',
      deletedAt: new Date('2026-06-01T00:00:00.000Z'),
    });
    databaseRepo.findById.mockResolvedValue(database);
    databaseRepo.listDatabaseRecords.mockResolvedValue([
      makeDatabaseRecord({
        id: 'record_1',
        pageId: deletedRecordPage.id,
        fields: { Title: 'Deleted task', Status: 'Todo' },
      }),
    ]);
    pageRepo.findById.mockResolvedValue(page);
    pageRepo.findByIds.mockResolvedValue([deletedRecordPage]);

    const result = await service.listRecords(database.id, user);

    expect(result.items).toEqual([]);
    expect(pageRepo.insertPage).not.toHaveBeenCalled();
    expect(databaseRepo.updateDatabaseRecordPageId).not.toHaveBeenCalled();
  });

  it('creates records with a renamed primary title field', async () => {
    const database = makeDatabaseBlock({
      metadata: { provider: 'docmost-native' },
      fields: [
        { name: 'Task', type: 'text', isPrimary: true },
        { name: 'Status', type: 'singleSelect', options: ['Todo', 'Done'] },
      ],
    });
    const recordPage = makePage({
      id: 'record_page_1',
      title: 'Renamed title',
      parentPageId: database.pageId,
    });
    databaseRepo.findById.mockResolvedValue(database);
    databaseRepo.insertDatabaseRecord.mockImplementation(async (input) =>
      makeDatabaseRecord({
        ...input,
        id: 'record_1',
        pageId: recordPage.id,
      }),
    );
    pageRepo.findById
      .mockResolvedValueOnce(page)
      .mockResolvedValueOnce(page)
      .mockResolvedValueOnce(recordPage);
    pageRepo.insertPage.mockResolvedValue(recordPage);

    const result = await service.createRecord(
      {
        databaseId: database.id,
        fields: { Task: 'Renamed title' },
      },
      user,
    );

    expect(pageRepo.insertPage).toHaveBeenCalledWith(
      expect.objectContaining({ title: 'Renamed title' }),
      trx,
      false,
    );
    expect(pageOperationPolicy.assertOperation).toHaveBeenCalledWith({
      operation: 'createChild',
      parentPage: page,
      actorId: user.id,
      trx,
    });
    expect(databaseRepo.insertDatabaseRecord).toHaveBeenCalledWith(
      expect.objectContaining({
        fields: expect.objectContaining({
          Task: 'Renamed title',
          Status: 'Todo',
        }),
      }),
      trx,
    );
    expect(result.title).toBe('Renamed title');
  });

  it('does not create a work item page when another page policy rejects children', async () => {
    const database = makeDatabaseBlock({
      metadata: { provider: 'docmost-native' },
    });
    const restriction = new Error('Children are restricted');
    databaseRepo.findById.mockResolvedValue(database);
    pageRepo.findById.mockResolvedValue(page);
    pageOperationPolicy.assertOperation.mockRejectedValue(restriction);

    await expect(
      service.createRecord(
        { databaseId: database.id, fields: { Title: 'Restricted task' } },
        user,
      ),
    ).rejects.toBe(restriction);

    expect(pageRepo.insertPage).not.toHaveBeenCalled();
    expect(databaseRepo.insertDatabaseRecord).not.toHaveBeenCalled();
  });

  it('rejects native record fields that are not defined by the board schema', async () => {
    const database = makeDatabaseBlock();
    databaseRepo.findById.mockResolvedValue(database);
    pageRepo.findById.mockResolvedValue(page);

    await expect(
      service.createRecord(
        {
          databaseId: database.id,
          fields: { Untrusted: 'value' },
        },
        user,
      ),
    ).rejects.toMatchObject({
      response: expect.objectContaining({
        code: 'DATABASE_RECORD_VALIDATION_FAILED',
        field: 'Untrusted',
      }),
    });

    expect(pageRepo.insertPage).not.toHaveBeenCalled();
    expect(databaseRepo.insertDatabaseRecord).not.toHaveBeenCalled();
  });

  it('rejects user references outside the active workspace membership', async () => {
    const database = makeDatabaseBlock();
    databaseRepo.findById.mockResolvedValue(database);
    databaseRepo.listActiveWorkspaceUserIds.mockResolvedValue([]);
    pageRepo.findById.mockResolvedValue(page);

    await expect(
      service.createRecord(
        {
          databaseId: database.id,
          fields: { Title: 'Task', Assignee: ['other_workspace_user'] },
        },
        user,
      ),
    ).rejects.toMatchObject({
      response: expect.objectContaining({
        code: 'DATABASE_RECORD_VALIDATION_FAILED',
        field: 'Assignee',
      }),
    });

    expect(databaseRepo.listActiveWorkspaceUserIds).toHaveBeenCalledWith(
      database.workspaceId,
      ['other_workspace_user'],
    );
    expect(pageRepo.insertPage).not.toHaveBeenCalled();
  });

  it('keeps the primary title field as a textual field', async () => {
    const database = makeDatabaseBlock();
    databaseRepo.findById.mockResolvedValue(database);
    pageRepo.findById.mockResolvedValue(page);

    await expect(
      service.updateField(
        {
          databaseId: database.id,
          fieldName: 'Title',
          type: 'number',
        },
        user,
      ),
    ).rejects.toThrow('The primary title field must remain a text field');

    expect(databaseRepo.updateFields).not.toHaveBeenCalled();
  });

  it('rejects reserved database field names before changing the schema', async () => {
    const database = makeDatabaseBlock();
    databaseRepo.findById.mockResolvedValue(database);
    pageRepo.findById.mockResolvedValue(page);

    await expect(
      service.createField(
        {
          databaseId: database.id,
          name: '__proto__',
          type: 'text',
        },
        user,
      ),
    ).rejects.toThrow('Database field name is reserved');

    expect(databaseRepo.updateFields).not.toHaveBeenCalled();
  });

  it('trashes a record page while preserving its board membership', async () => {
    const database = makeDatabaseBlock({
      metadata: { provider: 'docmost-native' },
    });
    const record = makeDatabaseRecord({
      id: 'record_1',
      pageId: 'record_page_1',
    });
    const recordPage = makePage({
      id: 'record_page_1',
      parentPageId: database.pageId,
    });
    databaseRepo.findById.mockResolvedValue(database);
    databaseRepo.findDatabaseRecord.mockResolvedValue(record);
    pageRepo.findById
      .mockResolvedValueOnce(page)
      .mockResolvedValueOnce(recordPage);

    const result = await service.trashRecordPage(
      { databaseId: database.id, recordId: record.id },
      user,
    );

    expect(pageAccessService.validateCanEdit).toHaveBeenCalledWith(page, user);
    expect(pageAccessService.validateCanEdit).toHaveBeenCalledWith(
      recordPage,
      user,
    );
    expect(db.transaction).toHaveBeenCalled();
    expect(databaseRepo.detachDatabaseRecord).not.toHaveBeenCalled();
    expect(pageRepo.removePage).toHaveBeenCalledWith(
      recordPage.id,
      user.id,
      database.workspaceId,
      trx,
      false,
    );
    expect(result).toEqual({
      recordId: record.id,
      pageId: record.pageId,
      trashedPageId: recordPage.id,
    });
  });

  it('rejects detaching a work item from its board', async () => {
    const database = makeDatabaseBlock({
      metadata: { provider: 'docmost-native' },
    });
    const record = makeDatabaseRecord({
      id: 'record_1',
      pageId: 'record_page_1',
    });
    databaseRepo.findById.mockResolvedValue(database);
    pageRepo.findById.mockResolvedValueOnce(page);

    await expect(
      service.detachRecord(
        {
          databaseId: database.id,
          recordId: record.id,
        },
        user,
      ),
    ).rejects.toMatchObject({
      response: expect.objectContaining({
        code: 'DATABASE_WORK_ITEM_DETACH_DISABLED',
      }),
    });

    expect(db.transaction).not.toHaveBeenCalled();
    expect(pageService.movePageToParent).not.toHaveBeenCalled();
  });

  it('lists editable native kanban databases as move targets', async () => {
    const currentDatabase = makeDatabaseBlock({ id: 'database_current' });
    const editableTarget = makeDatabaseBlock({
      id: 'database_target',
      pageId: 'target_page_1',
      title: 'Sprint board',
    });
    const blockedTarget = makeDatabaseBlock({
      id: 'database_blocked',
      pageId: 'blocked_page_1',
      title: 'Blocked board',
    });
    const tableOnlyTarget = makeDatabaseBlock({
      id: 'database_table',
      pageId: 'table_page_1',
      views: [{ id: 'table', name: 'Table', type: 'table' }],
    });
    const apitableTarget = makeDatabaseBlock({
      id: 'database_apitable',
      pageId: 'apitable_page_1',
      apitableDatasheetId: 'external_datasheet_1',
      metadata: { provider: 'apitable' },
    });
    databaseRepo.listByWorkspace.mockResolvedValue([
      currentDatabase,
      editableTarget,
      blockedTarget,
      tableOnlyTarget,
      apitableTarget,
    ]);
    const editableTargetPage = makePage({ id: 'target_page_1' });
    const blockedTargetPage = makePage({ id: 'blocked_page_1' });
    pageRepo.findByIds.mockResolvedValue([
      editableTargetPage,
      blockedTargetPage,
    ]);
    pageAccessService.filterViewablePagesWithPermissions.mockResolvedValue([
      { page: editableTargetPage, canEdit: true },
      { page: blockedTargetPage, canEdit: false },
    ]);

    const result = await service.listTargets(
      { excludeDatabaseId: currentDatabase.id },
      user,
    );

    expect(databaseRepo.listByWorkspace).toHaveBeenCalledWith(user.workspaceId);
    expect(pageRepo.findByIds).toHaveBeenCalledWith([
      editableTarget.pageId,
      blockedTarget.pageId,
    ]);
    expect(result.items).toEqual([
      expect.objectContaining({
        id: editableTarget.id,
        title: editableTarget.title,
        pageTitle: 'Page',
      }),
    ]);
  });

  it('moves an existing work item to another board atomically', async () => {
    const targetDatabase = makeDatabaseBlock({
      id: 'target_database',
      pageId: 'target_database_page',
    });
    const sourceDatabase = makeDatabaseBlock({
      id: 'source_database',
      pageId: 'source_database_page',
    });
    const movingPage = makePage({
      id: 'record_page_1',
      parentPageId: sourceDatabase.pageId,
    });
    const relocatedMovingPage = makePage({
      ...movingPage,
      parentPageId: targetDatabase.pageId,
    });
    const targetRecord = makeDatabaseRecord({
      id: 'target_record_1',
      databaseId: targetDatabase.id,
      pageId: movingPage.id,
    });
    const sourceRecord = makeDatabaseRecord({
      id: 'source_record_1',
      databaseId: sourceDatabase.id,
      pageId: movingPage.id,
    });
    databaseRepo.findById
      .mockResolvedValueOnce(targetDatabase)
      .mockResolvedValueOnce(sourceDatabase);
    databaseRepo.findDatabaseRecord.mockResolvedValue(sourceRecord);
    databaseRepo.listActiveDatabaseRecordsByPage.mockResolvedValue([
      sourceRecord,
    ]);
    databaseRepo.insertDatabaseRecord.mockResolvedValue(targetRecord);
    pageRepo.findById
      .mockResolvedValueOnce(makePage({ id: targetDatabase.pageId }))
      .mockResolvedValueOnce(movingPage)
      .mockResolvedValueOnce(makePage({ id: sourceDatabase.pageId }))
      .mockResolvedValueOnce(relocatedMovingPage)
      .mockResolvedValueOnce(relocatedMovingPage);

    const result = await service.attachPage(
      {
        databaseId: targetDatabase.id,
        pageId: movingPage.id,
        sourceDatabaseId: sourceDatabase.id,
        sourceRecordId: sourceRecord.id,
      },
      user,
    );

    expect(databaseRepo.insertDatabaseRecord).toHaveBeenCalledWith(
      expect.objectContaining({
        databaseId: targetDatabase.id,
        pageId: movingPage.id,
      }),
      trx,
    );
    expect(db.transaction).toHaveBeenCalled();
    expect(databaseRepo.detachDatabaseRecord).toHaveBeenCalledWith(
      sourceDatabase.id,
      sourceRecord.id,
      user.id,
      trx,
    );
    expect(pageService.movePageToParent).toHaveBeenCalledWith(
      movingPage,
      targetDatabase.pageId,
      user.id,
      trx,
      false,
    );
    expect(result).toEqual(
      expect.objectContaining({
        id: targetRecord.id,
        pageId: movingPage.id,
      }),
    );
  });

  it('rejects attaching Docmost pages to an external database provider', async () => {
    const database = makeDatabaseBlock({
      apitableDatasheetId: 'external_datasheet_1',
      metadata: { provider: 'apitable' },
    });
    databaseRepo.findById.mockResolvedValue(database);
    pageRepo.findById.mockResolvedValue(page);

    await expect(
      service.attachPage(
        { databaseId: database.id, pageId: 'record_page_1' },
        user,
      ),
    ).rejects.toMatchObject({
      response: expect.objectContaining({
        code: 'DATABASE_NATIVE_PAGE_RELATION_REQUIRED',
      }),
    });

    expect(databaseRepo.insertDatabaseRecord).not.toHaveBeenCalled();
    expect(pageService.movePageToParent).not.toHaveBeenCalled();
  });

  it('maps concurrent active-page membership conflicts to a stable response', async () => {
    const database = makeDatabaseBlock({ pageId: 'database_page_1' });
    const movingPage = makePage({ id: 'record_page_1' });
    databaseRepo.findById.mockResolvedValue(database);
    databaseRepo.listActiveDatabaseRecordsByPage.mockResolvedValue([]);
    databaseRepo.insertDatabaseRecord.mockRejectedValue({
      code: '23505',
      constraint: 'idx_database_records_active_page_unique',
    });
    pageRepo.findById
      .mockResolvedValueOnce(makePage({ id: database.pageId }))
      .mockResolvedValueOnce(movingPage);

    try {
      await service.attachPage(
        { databaseId: database.id, pageId: movingPage.id },
        user,
      );
      throw new Error('Expected attachPage to reject');
    } catch (error) {
      expect((error as { getResponse: () => unknown }).getResponse()).toEqual({
        code: 'DATABASE_PAGE_ALREADY_MANAGED',
        message: 'The page is already managed by a board',
      });
    }
  });

  it('keeps compatibility with legacy metadata records', async () => {
    const database = makeDatabaseBlock({
      apitableDatasheetId: 'local_datasheet_1',
      metadata: {
        provider: 'docmost-local',
        records: [
          {
            recordId: 'legacy_record_1',
            fields: {
              Title: 'Legacy fallback card',
              Status: 'Todo',
            },
          },
        ],
      },
    });
    databaseRepo.findById.mockResolvedValue(database);
    databaseRepo.listDatabaseRecords.mockResolvedValue([]);
    pageRepo.findById.mockResolvedValue(page);

    const result = await service.listRecords(database.id, user);

    expect(result.items).toEqual([
      expect.objectContaining({
        id: 'legacy_record_1',
        title: 'Legacy fallback card',
        status: 'Todo',
      }),
    ]);
  });

  it('updates native Docmost records after validating page edit permission', async () => {
    const database = makeDatabaseBlock({
      metadata: { provider: 'docmost-native' },
    });
    const record = makeDatabaseRecord({
      id: 'record_1',
      fields: {
        Title: 'Build board',
        Status: 'Todo',
      },
    });
    databaseRepo.findById.mockResolvedValue(database);
    databaseRepo.findDatabaseRecord.mockResolvedValue(record);
    databaseRepo.updateDatabaseRecordFields.mockImplementation(
      async (_databaseId, _recordId, fields) =>
        makeDatabaseRecord({ ...record, fields }),
    );
    const recordPage = makePage({
      id: record.pageId,
      parentPageId: database.pageId,
      title: 'Build board',
    });
    pageRepo.findById.mockResolvedValueOnce(page).mockResolvedValue(recordPage);

    const result = await service.updateRecord(
      {
        databaseId: database.id,
        recordId: 'record_1',
        fields: { Status: 'Done' },
      },
      user,
    );

    expect(pageAccessService.validateCanEdit).toHaveBeenCalledWith(page, user);
    expect(pageAccessService.validateCanEdit).toHaveBeenCalledWith(
      recordPage,
      user,
    );
    expect(databaseRepo.updateDatabaseRecordFields).toHaveBeenCalledWith(
      database.id,
      'record_1',
      expect.objectContaining({ Status: 'Done' }),
      user.id,
      trx,
    );
    expect(result.status).toBe('Done');
  });
});

function makeDatabaseBlock(
  overrides: Partial<DatabaseBlock> = {},
): DatabaseBlock {
  return {
    id: 'database_1',
    blockId: 'block_1',
    pageId: 'page_1',
    spaceId: 'space_1',
    workspaceId: 'workspace_1',
    createdById: 'user_1',
    updatedById: 'user_1',
    title: 'Tasks',
    template: 'tasks',
    activeViewId: 'kanban',
    apitableDatasheetId: 'native_datasheet_1',
    apitableViewId: 'kanban',
    fields: buildDefaultFieldsForTemplate(
      'tasks',
    ) as unknown as DatabaseBlock['fields'],
    views: [{ id: 'kanban', name: 'Board', type: 'kanban', groupBy: 'Status' }],
    metadata: { provider: 'docmost-native' },
    createdAt: new Date('2026-05-16T00:00:00.000Z'),
    updatedAt: new Date('2026-05-16T00:00:00.000Z'),
    deletedAt: null,
    ...overrides,
  };
}

function makePage(overrides: Partial<Page> = {}): Page {
  return {
    id: 'page_1',
    slugId: 'page_slug_1',
    title: 'Page',
    icon: null,
    coverPhoto: null,
    position: 'a0',
    parentPageId: null,
    creatorId: 'user_1',
    lastUpdatedById: 'user_1',
    spaceId: 'space_1',
    workspaceId: 'workspace_1',
    isLocked: false,
    createdAt: new Date('2026-05-16T00:00:00.000Z'),
    updatedAt: new Date('2026-05-16T00:00:00.000Z'),
    deletedAt: null,
    contributorIds: [],
    ...overrides,
  } as Page;
}

function makeDatabaseRecord(
  overrides: Partial<DatabaseRecord> = {},
): DatabaseRecord {
  return {
    id: 'record_1',
    databaseId: 'database_1',
    pageId: 'page_1',
    spaceId: 'space_1',
    workspaceId: 'workspace_1',
    createdById: 'user_1',
    updatedById: 'user_1',
    apitableRecordId: null,
    fields: {},
    sortOrder: null,
    createdAt: new Date('2026-05-16T00:00:00.000Z'),
    updatedAt: new Date('2026-05-16T00:00:00.000Z'),
    deletedAt: null,
    ...overrides,
  };
}
