jest.mock('uuid', () => ({ v7: jest.fn(() => 'uuid_1') }));

import { DatabaseService } from './database.service';
import {
  DatabaseBlock,
  DatabaseRecord,
  Page,
  User,
} from '@docmost/db/types/entity.types';

describe('DatabaseService', () => {
  const user = { id: 'user_1' } as User;
  const page = {
    id: 'page_1',
    spaceId: 'space_1',
    workspaceId: 'workspace_1',
    deletedAt: null,
  } as Page;

  let databaseRepo: {
    findById: jest.Mock;
    findByPageAndBlock: jest.Mock;
    insertDatabaseBlock: jest.Mock;
    updateViews: jest.Mock;
    updateMetadata: jest.Mock;
    insertDatabaseRecord: jest.Mock;
    insertDatabaseRecords: jest.Mock;
    listDatabaseRecords: jest.Mock;
    findDatabaseRecord: jest.Mock;
    updateDatabaseRecordFields: jest.Mock;
  };
  let pageRepo: { findById: jest.Mock };
  let pageAccessService: {
    validateCanEdit: jest.Mock;
    validateCanView: jest.Mock;
  };
  let apitableClient: {
    createDatasheet: jest.Mock;
    listRecords: jest.Mock;
    createRecord: jest.Mock;
    updateRecord: jest.Mock;
    buildPublicEmbedUrl: jest.Mock;
  };
  let service: DatabaseService;

  beforeEach(() => {
    databaseRepo = {
      findById: jest.fn(),
      findByPageAndBlock: jest.fn(),
      insertDatabaseBlock: jest.fn(),
      updateViews: jest.fn(),
      updateMetadata: jest.fn(),
      insertDatabaseRecord: jest.fn(),
      insertDatabaseRecords: jest.fn(),
      listDatabaseRecords: jest.fn(),
      findDatabaseRecord: jest.fn(),
      updateDatabaseRecordFields: jest.fn(),
    };
    pageRepo = { findById: jest.fn() };
    pageAccessService = {
      validateCanEdit: jest.fn(),
      validateCanView: jest.fn(),
    };
    apitableClient = {
      createDatasheet: jest.fn(),
      listRecords: jest.fn(),
      createRecord: jest.fn(),
      updateRecord: jest.fn(),
      buildPublicEmbedUrl: jest.fn(),
    };

    service = new DatabaseService(
      databaseRepo as never,
      pageRepo as never,
      pageAccessService as never,
      apitableClient as never,
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
