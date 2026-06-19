jest.mock('uuid', () => ({ v7: jest.fn(() => 'uuid_1') }));
jest.mock('../../common/helpers/prosemirror/utils', () => ({
  createYdocFromJson: jest.fn(() => undefined),
}));
jest.mock('../page/services/page.service', () => ({
  PageService: jest.fn(),
}));

import { DatabaseService } from './database.service';
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
    findByPageAndBlock: jest.Mock;
    insertDatabaseBlock: jest.Mock;
    updateViews: jest.Mock;
    updateMetadata: jest.Mock;
    insertDatabaseRecord: jest.Mock;
    insertDatabaseRecords: jest.Mock;
    listDatabaseRecords: jest.Mock;
    findDatabaseRecord: jest.Mock;
    findDatabaseRecordByPage: jest.Mock;
    updateDatabaseRecordFields: jest.Mock;
    updateDatabaseRecordPageId: jest.Mock;
    updateDatabaseRecordSort: jest.Mock;
    detachDatabaseRecord: jest.Mock;
    getLastDatabaseRecordSortOrder: jest.Mock;
    getLastChildPagePosition: jest.Mock;
  };
  let pageRepo: {
    findById: jest.Mock;
    insertPage: jest.Mock;
    updatePage: jest.Mock;
    removePage: jest.Mock;
  };
  let pageAccessService: {
    validateCanEdit: jest.Mock;
    validateCanView: jest.Mock;
  };
  let pageService: {
    movePageToParent: jest.Mock;
    movePageToSpace: jest.Mock;
  };
  let spaceAbility: {
    createForUser: jest.Mock;
  };
  let apitableClient: {
    createDatasheet: jest.Mock;
    listRecords: jest.Mock;
    createRecord: jest.Mock;
    updateRecord: jest.Mock;
    buildPublicEmbedUrl: jest.Mock;
  };
  let db: { transaction: jest.Mock };
  let trx: Record<string, never>;
  let service: DatabaseService;

  beforeEach(() => {
    databaseRepo = {
      findById: jest.fn(),
      listByWorkspace: jest.fn(),
      findByPageAndBlock: jest.fn(),
      insertDatabaseBlock: jest.fn(),
      updateViews: jest.fn(),
      updateMetadata: jest.fn(),
      insertDatabaseRecord: jest.fn(),
      insertDatabaseRecords: jest.fn(),
      listDatabaseRecords: jest.fn(),
      findDatabaseRecord: jest.fn(),
      findDatabaseRecordByPage: jest.fn(),
      updateDatabaseRecordFields: jest.fn(),
      updateDatabaseRecordPageId: jest.fn(),
      updateDatabaseRecordSort: jest.fn(),
      detachDatabaseRecord: jest.fn(),
      getLastDatabaseRecordSortOrder: jest.fn().mockResolvedValue(null),
      getLastChildPagePosition: jest.fn().mockResolvedValue(null),
    };
    pageRepo = {
      findById: jest.fn(),
      insertPage: jest.fn().mockImplementation(async (input) =>
        makePage({
          ...input,
          id: `record_page_${Math.random().toString(36).slice(2)}`,
          deletedAt: null,
        }),
      ),
      updatePage: jest.fn(),
      removePage: jest.fn(),
    };
    pageAccessService = {
      validateCanEdit: jest.fn(),
      validateCanView: jest.fn(),
    };
    pageService = {
      movePageToParent: jest.fn(),
      movePageToSpace: jest.fn(),
    };
    spaceAbility = {
      createForUser: jest
        .fn()
        .mockResolvedValue({ cannot: jest.fn(() => false) }),
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

    service = new DatabaseService(
      databaseRepo as never,
      pageRepo as never,
      pageAccessService as never,
      pageService as never,
      spaceAbility as never,
      apitableClient as never,
      db as never,
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
        fields: {
          Title: 'Ship APITable fusion',
          Status: 'In progress',
          Assignee: ['user_1'],
        },
      }),
    ]);
    pageRepo.findById.mockResolvedValue(page);

    const result = await service.listRecords(database.id, user);

    expect(pageAccessService.validateCanView).toHaveBeenCalledWith(page, user);
    expect(pageAccessService.validateCanEdit).not.toHaveBeenCalled();
    expect(databaseRepo.listDatabaseRecords).toHaveBeenCalledWith(database.id);
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
    pageRepo.findById
      .mockResolvedValueOnce(page)
      .mockResolvedValueOnce(deletedRecordPage);

    const result = await service.listRecords(database.id, user);

    expect(result.items).toEqual([]);
    expect(pageRepo.insertPage).not.toHaveBeenCalled();
    expect(databaseRepo.updateDatabaseRecordPageId).not.toHaveBeenCalled();
  });

  it('trashes a record page and detaches the database record atomically', async () => {
    const database = makeDatabaseBlock({
      metadata: { provider: 'docmost-native' },
    });
    const record = makeDatabaseRecord({
      id: 'record_1',
      pageId: 'record_page_1',
    });
    const recordPage = makePage({ id: 'record_page_1' });
    databaseRepo.findById.mockResolvedValue(database);
    databaseRepo.findDatabaseRecord.mockResolvedValue(record);
    databaseRepo.detachDatabaseRecord.mockResolvedValue({
      ...record,
      deletedAt: new Date('2026-06-01T00:00:00.000Z'),
    });
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
    expect(databaseRepo.detachDatabaseRecord).toHaveBeenCalledWith(
      database.id,
      record.id,
      user.id,
      trx,
    );
    expect(pageRepo.removePage).toHaveBeenCalledWith(
      recordPage.id,
      user.id,
      database.workspaceId,
      trx,
    );
    expect(result).toEqual({
      recordId: record.id,
      pageId: record.pageId,
      trashedPageId: recordPage.id,
    });
  });

  it('moves a record page to a target page and detaches the record in one transaction', async () => {
    const database = makeDatabaseBlock({
      metadata: { provider: 'docmost-native' },
    });
    const record = makeDatabaseRecord({
      id: 'record_1',
      pageId: 'record_page_1',
    });
    const recordPage = makePage({ id: 'record_page_1' });
    const targetPage = makePage({ id: 'target_page_1' });
    databaseRepo.findById.mockResolvedValue(database);
    databaseRepo.findDatabaseRecord.mockResolvedValue(record);
    databaseRepo.detachDatabaseRecord.mockResolvedValue({
      ...record,
      deletedAt: new Date('2026-06-01T00:00:00.000Z'),
    });
    pageRepo.findById
      .mockResolvedValueOnce(page)
      .mockResolvedValueOnce(recordPage)
      .mockResolvedValueOnce(targetPage);

    const result = await service.detachRecord(
      {
        databaseId: database.id,
        recordId: record.id,
        targetPageId: targetPage.id,
      },
      user,
    );

    expect(db.transaction).toHaveBeenCalled();
    expect(pageService.movePageToParent).toHaveBeenCalledWith(
      recordPage,
      targetPage.id,
      trx,
    );
    expect(databaseRepo.detachDatabaseRecord).toHaveBeenCalledWith(
      database.id,
      record.id,
      user.id,
      trx,
    );
    expect(result.targetPageId).toBe(targetPage.id);
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
      metadata: { provider: 'apitable' },
    });
    databaseRepo.listByWorkspace.mockResolvedValue([
      currentDatabase,
      editableTarget,
      blockedTarget,
      tableOnlyTarget,
      apitableTarget,
    ]);
    pageRepo.findById
      .mockResolvedValueOnce(makePage({ id: 'target_page_1' }))
      .mockResolvedValueOnce(makePage({ id: 'blocked_page_1' }));
    pageAccessService.validateCanEdit.mockImplementation(async (targetPage) => {
      if (targetPage.id === 'blocked_page_1') throw new Error('Forbidden');
    });

    const result = await service.listTargets(
      { excludeDatabaseId: currentDatabase.id },
      user,
    );

    expect(databaseRepo.listByWorkspace).toHaveBeenCalledWith(
      user.workspaceId,
    );
    expect(result.items).toEqual([
      expect.objectContaining({
        id: editableTarget.id,
        title: editableTarget.title,
        pageTitle: 'Page',
      }),
    ]);
  });

  it('detaches the source record when attaching to a board that already has the page', async () => {
    const targetDatabase = makeDatabaseBlock({
      id: 'target_database',
      pageId: 'target_database_page',
    });
    const sourceDatabase = makeDatabaseBlock({
      id: 'source_database',
      pageId: 'source_database_page',
    });
    const movingPage = makePage({ id: 'record_page_1' });
    const existingTargetRecord = makeDatabaseRecord({
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
    databaseRepo.findDatabaseRecordByPage.mockResolvedValue(
      existingTargetRecord,
    );
    databaseRepo.findDatabaseRecord.mockResolvedValue(sourceRecord);
    pageRepo.findById
      .mockResolvedValueOnce(makePage({ id: targetDatabase.pageId }))
      .mockResolvedValueOnce(movingPage)
      .mockResolvedValueOnce(makePage({ id: sourceDatabase.pageId }))
      .mockResolvedValueOnce(movingPage);

    const result = await service.attachPage(
      {
        databaseId: targetDatabase.id,
        pageId: movingPage.id,
        sourceDatabaseId: sourceDatabase.id,
        sourceRecordId: sourceRecord.id,
      },
      user,
    );

    expect(databaseRepo.insertDatabaseRecord).not.toHaveBeenCalled();
    expect(db.transaction).toHaveBeenCalled();
    expect(databaseRepo.detachDatabaseRecord).toHaveBeenCalledWith(
      sourceDatabase.id,
      sourceRecord.id,
      user.id,
      trx,
    );
    expect(result).toEqual(
      expect.objectContaining({
        id: existingTargetRecord.id,
        pageId: movingPage.id,
      }),
    );
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
    pageRepo.findById.mockResolvedValue(page);

    const result = await service.updateRecord(
      {
        databaseId: database.id,
        recordId: 'record_1',
        fields: { Status: 'Done' },
      },
      user,
    );

    expect(pageAccessService.validateCanEdit).toHaveBeenCalledWith(page, user);
    expect(databaseRepo.updateDatabaseRecordFields).toHaveBeenCalledWith(
      database.id,
      'record_1',
      expect.objectContaining({ Status: 'Done' }),
      user.id,
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
    fields: [],
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
