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
    findByIdIncludingDeleted: jest.Mock;
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
    archiveDatabases: jest.Mock;
    findDatabaseRecord: jest.Mock;
    findDatabaseRecordByPage: jest.Mock;
    listActiveDatabaseRecordsByPage: jest.Mock;
    updateDatabaseRecordFields: jest.Mock;
    backfillDatabaseRecordField: jest.Mock;
    renameDatabaseRecordField: jest.Mock;
    replaceDatabaseRecordFieldValue: jest.Mock;
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
    lockPageTreeSpacesForUpdate: jest.Mock;
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
  let systemDiagnosticsService: { recordIncident: jest.Mock };
  let trx: Record<string, never>;
  let service: DatabaseService;

  beforeEach(() => {
    databaseRepo = {
      findById: jest.fn(),
      findByIdIncludingDeleted: jest.fn(),
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
      archiveDatabases: jest.fn().mockResolvedValue({
        databaseIds: [],
        recordCount: 0,
      }),
      findDatabaseRecord: jest.fn(),
      findDatabaseRecordByPage: jest.fn(),
      listActiveDatabaseRecordsByPage: jest.fn().mockResolvedValue([]),
      updateDatabaseRecordFields: jest.fn(),
      backfillDatabaseRecordField: jest.fn(),
      renameDatabaseRecordField: jest.fn(),
      replaceDatabaseRecordFieldValue: jest.fn(),
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
      lockPageTreeSpacesForUpdate: jest.fn().mockResolvedValue(undefined),
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
    systemDiagnosticsService = {
      recordIncident: jest.fn().mockResolvedValue(undefined),
    };

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
      systemDiagnosticsService as never,
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

  it('rejects whitespace and padded database block identifiers', async () => {
    await expect(
      service.createDatabase(
        {
          pageId: page.id,
          blockId: ' block_1 ',
          template: 'tasks',
          viewType: 'kanban',
        },
        user,
      ),
    ).rejects.toThrow('Invalid database block ID');

    expect(pageRepo.findById).not.toHaveBeenCalled();
    expect(databaseRepo.insertDatabaseBlock).not.toHaveBeenCalled();
  });

  it('returns the transaction winner when the same board is created concurrently', async () => {
    const existingDatabase = makeDatabaseBlock({
      id: 'existing_database',
      pageId: page.id,
      blockId: 'block_1',
    });
    pageRepo.findById.mockResolvedValue(page);
    databaseRepo.findByPageAndBlock
      .mockResolvedValueOnce(undefined)
      .mockResolvedValueOnce(existingDatabase);
    apitableClient.createDatasheet.mockResolvedValue({
      datasheetId: 'racing_datasheet',
      provider: 'docmost-native',
    });

    const result = await service.createDatabase(
      {
        pageId: page.id,
        blockId: existingDatabase.blockId,
        template: 'tasks',
      },
      user,
    );

    expect(databaseRepo.findByPageAndBlock).toHaveBeenLastCalledWith(
      page.id,
      existingDatabase.blockId,
      trx,
    );
    expect(databaseRepo.insertDatabaseBlock).not.toHaveBeenCalled();
    expect(databaseRepo.insertDatabaseRecords).not.toHaveBeenCalled();
    expect(auditService.log).not.toHaveBeenCalled();
    expect(result.id).toBe(existingDatabase.id);
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
      trx,
    );
    expect(pageRepo.insertPage).not.toHaveBeenCalled();
  });

  it('rejects field type changes until an explicit conversion exists', async () => {
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
    ).rejects.toMatchObject({
      response: expect.objectContaining({
        code: 'DATABASE_FIELD_TYPE_CHANGE_UNSUPPORTED',
      }),
    });

    expect(databaseRepo.updateFields).not.toHaveBeenCalled();
  });

  it('does not allow the primary title field to be renamed through the API', async () => {
    const database = makeDatabaseBlock();
    databaseRepo.findById.mockResolvedValue(database);
    pageRepo.findById.mockResolvedValue(page);

    await expect(
      service.updateField(
        {
          databaseId: database.id,
          fieldName: 'Title',
          name: 'Renamed title',
        },
        user,
      ),
    ).rejects.toMatchObject({
      response: expect.objectContaining({
        code: 'DATABASE_PRIMARY_FIELD_RENAME_UNSUPPORTED',
      }),
    });

    expect(databaseRepo.updateFields).not.toHaveBeenCalled();
  });

  it('rejects field types that the database editor cannot safely edit yet', async () => {
    const database = makeDatabaseBlock();
    databaseRepo.findById.mockResolvedValue(database);
    pageRepo.findById.mockResolvedValue(page);

    await expect(
      service.createField(
        {
          databaseId: database.id,
          name: 'Computed',
          type: 'formula',
        },
        user,
      ),
    ).rejects.toMatchObject({
      response: expect.objectContaining({
        code: 'DATABASE_FIELD_TYPE_UNSUPPORTED',
      }),
    });

    expect(databaseRepo.updateFields).not.toHaveBeenCalled();
  });

  it('keeps external database schema changes in the source provider', async () => {
    const database = makeDatabaseBlock({
      apitableDatasheetId: 'dst_external',
      metadata: { provider: 'apitable' },
    });
    databaseRepo.findById.mockResolvedValue(database);
    pageRepo.findById.mockResolvedValue(page);

    await expect(
      service.createField(
        {
          databaseId: database.id,
          name: 'Local only',
          type: 'text',
        },
        user,
      ),
    ).rejects.toMatchObject({
      response: expect.objectContaining({
        code: 'DATABASE_EXTERNAL_SCHEMA_MANAGED_BY_PROVIDER',
      }),
    });

    expect(databaseRepo.updateFields).not.toHaveBeenCalled();
  });

  it('rejects duplicate field options before changing the schema', async () => {
    const database = makeDatabaseBlock();
    databaseRepo.findById.mockResolvedValue(database);
    pageRepo.findById.mockResolvedValue(page);

    await expect(
      service.updateField(
        {
          databaseId: database.id,
          fieldName: 'Status',
          options: ['Todo', 'Todo'],
        },
        user,
      ),
    ).rejects.toMatchObject({
      response: expect.objectContaining({
        code: 'DATABASE_FIELD_OPTION_DUPLICATE',
      }),
    });

    expect(databaseRepo.updateFields).not.toHaveBeenCalled();
  });

  it('rejects options on a field type that does not support them', async () => {
    const database = makeDatabaseBlock();
    databaseRepo.findById.mockResolvedValue(database);
    pageRepo.findById.mockResolvedValue(page);

    await expect(
      service.createField(
        {
          databaseId: database.id,
          name: 'Notes',
          type: 'text',
          options: ['Unexpected'],
        },
        user,
      ),
    ).rejects.toMatchObject({
      response: expect.objectContaining({
        code: 'DATABASE_FIELD_OPTIONS_UNSUPPORTED',
      }),
    });

    expect(databaseRepo.updateFields).not.toHaveBeenCalled();
  });

  it('rejects option removal through the generic field update endpoint', async () => {
    const database = makeDatabaseBlock();
    databaseRepo.findById.mockResolvedValue(database);
    pageRepo.findById.mockResolvedValue(page);

    await expect(
      service.updateField(
        {
          databaseId: database.id,
          fieldName: 'Status',
          options: ['Todo', 'In progress'],
        },
        user,
      ),
    ).rejects.toMatchObject({
      response: expect.objectContaining({
        code: 'DATABASE_FIELD_OPTION_OPERATION_REQUIRED',
      }),
    });

    expect(databaseRepo.updateFields).not.toHaveBeenCalled();
    expect(databaseRepo.replaceDatabaseRecordFieldValue).not.toHaveBeenCalled();
  });

  it('renames a board option and all recoverable records atomically', async () => {
    const database = makeDatabaseBlock({
      metadata: {
        provider: 'docmost-native',
        records: [{ recordId: 'legacy_record_1', fields: { Status: 'Todo' } }],
      },
    });
    databaseRepo.findById.mockResolvedValue(database);
    pageRepo.findById.mockResolvedValue(page);
    databaseRepo.replaceDatabaseRecordFieldValue.mockResolvedValue(3);
    let updatedFields = database.fields;
    databaseRepo.updateFields.mockImplementation(async (_id, fields) => {
      updatedFields = fields;
      return makeDatabaseBlock({ ...database, fields });
    });
    databaseRepo.updateMetadata.mockImplementation(async (_id, metadata) =>
      makeDatabaseBlock({ ...database, fields: updatedFields, metadata }),
    );

    const result = await service.updateFieldOption(
      {
        databaseId: database.id,
        fieldName: 'Status',
        operation: 'rename',
        option: 'Todo',
        name: 'Backlog',
      },
      user,
    );

    expect(databaseRepo.replaceDatabaseRecordFieldValue).toHaveBeenCalledWith(
      database.id,
      'Status',
      'Todo',
      'Backlog',
      user.id,
      trx,
    );
    expect(databaseRepo.updateFields).toHaveBeenCalledWith(
      database.id,
      expect.arrayContaining([
        expect.objectContaining({
          name: 'Status',
          options: expect.arrayContaining(['Backlog', 'In progress', 'Done']),
        }),
      ]),
      user.id,
      trx,
    );
    expect(auditService.log).toHaveBeenCalledWith(
      expect.objectContaining({
        metadata: expect.objectContaining({
          optionOperation: 'rename',
          affectedRecordCount: 4,
        }),
      }),
    );
    expect(databaseRepo.updateMetadata).toHaveBeenCalledWith(
      database.id,
      expect.objectContaining({
        records: [expect.objectContaining({ fields: { Status: 'Backlog' } })],
      }),
      user.id,
      trx,
    );
    expect(result.fields).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          name: 'Status',
          options: expect.arrayContaining(['Backlog']),
        }),
      ]),
    );
  });

  it('treats a completed option rename retry as an idempotent success', async () => {
    const database = makeDatabaseBlock({
      fields: buildDefaultFieldsForTemplate('tasks').map((field) =>
        field.name === 'Status'
          ? { ...field, options: ['Backlog', 'In progress', 'Done'] }
          : field,
      ) as unknown as DatabaseBlock['fields'],
    });
    databaseRepo.findById.mockResolvedValue(database);
    pageRepo.findById.mockResolvedValue(page);

    const result = await service.updateFieldOption(
      {
        databaseId: database.id,
        fieldName: 'Status',
        operation: 'rename',
        option: 'Todo',
        name: 'Backlog',
      },
      user,
    );

    expect(result.fields).toEqual(database.fields);
    expect(databaseRepo.replaceDatabaseRecordFieldValue).not.toHaveBeenCalled();
    expect(databaseRepo.updateFields).not.toHaveBeenCalled();
    expect(auditService.log).not.toHaveBeenCalled();
  });

  it('rejects a conflicting option operation that lost a concurrent race', async () => {
    const original = makeDatabaseBlock();
    const changed = makeDatabaseBlock({
      fields: buildDefaultFieldsForTemplate('tasks').map((field) =>
        field.name === 'Status'
          ? { ...field, options: ['Backlog', 'In progress', 'Done'] }
          : field,
      ) as unknown as DatabaseBlock['fields'],
    });
    databaseRepo.findById
      .mockResolvedValueOnce(original)
      .mockResolvedValueOnce(changed);
    pageRepo.findById.mockResolvedValue(page);

    await expect(
      service.updateFieldOption(
        {
          databaseId: original.id,
          fieldName: 'Status',
          operation: 'delete',
          option: 'Todo',
          replacementOption: 'In progress',
        },
        user,
      ),
    ).rejects.toMatchObject({
      response: expect.objectContaining({
        code: 'DATABASE_FIELD_OPTION_CHANGED_RETRY',
      }),
    });

    expect(databaseRepo.replaceDatabaseRecordFieldValue).not.toHaveBeenCalled();
  });

  it('moves recoverable records before deleting an empty board option', async () => {
    const database = makeDatabaseBlock();
    databaseRepo.findById.mockResolvedValue(database);
    pageRepo.findById.mockResolvedValue(page);
    databaseRepo.replaceDatabaseRecordFieldValue.mockResolvedValue(1);
    databaseRepo.updateFields.mockImplementation(async (_id, fields) =>
      makeDatabaseBlock({ fields }),
    );

    await service.updateFieldOption(
      {
        databaseId: database.id,
        fieldName: 'Status',
        operation: 'delete',
        option: 'Done',
        replacementOption: 'Todo',
      },
      user,
    );

    expect(databaseRepo.replaceDatabaseRecordFieldValue).toHaveBeenCalledWith(
      database.id,
      'Status',
      'Done',
      'Todo',
      user.id,
      trx,
    );
    expect(databaseRepo.updateFields).toHaveBeenCalledWith(
      database.id,
      expect.arrayContaining([
        expect.objectContaining({
          name: 'Status',
          options: ['Todo', 'In progress'],
        }),
      ]),
      user.id,
      trx,
    );
  });

  it('keeps view grouping valid when a grouped field is renamed', async () => {
    const database = makeDatabaseBlock();
    databaseRepo.findById.mockResolvedValue(database);
    pageRepo.findById.mockResolvedValue(page);
    databaseRepo.updateFields.mockImplementation(async (_id, fields) =>
      makeDatabaseBlock({ fields }),
    );
    databaseRepo.updateViews.mockImplementation(
      async (_id, views, activeViewId) =>
        makeDatabaseBlock({ views, activeViewId }),
    );

    await service.updateField(
      {
        databaseId: database.id,
        fieldName: 'Status',
        name: 'Phase',
      },
      user,
    );

    expect(databaseRepo.renameDatabaseRecordField).toHaveBeenCalledWith(
      database.id,
      'Status',
      'Phase',
      user.id,
      trx,
    );
    expect(databaseRepo.updateViews).toHaveBeenCalledWith(
      database.id,
      [expect.objectContaining({ type: 'kanban', groupBy: 'Phase' })],
      database.activeViewId,
      user.id,
      trx,
    );
  });

  it('rejects a board view grouped by a missing field', async () => {
    const database = makeDatabaseBlock();
    databaseRepo.findById.mockResolvedValue(database);
    pageRepo.findById.mockResolvedValue(page);

    await expect(
      service.createView(
        {
          databaseId: database.id,
          name: 'Broken board',
          type: 'kanban',
          groupBy: 'Missing',
        },
        user,
      ),
    ).rejects.toMatchObject({
      response: expect.objectContaining({
        code: 'DATABASE_VIEW_GROUP_FIELD_INVALID',
      }),
    });

    expect(databaseRepo.updateViews).not.toHaveBeenCalled();
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
    pageRepo.findById.mockImplementation(async (pageId: string) =>
      pageId === recordPage.id ? recordPage : page,
    );

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

  it('deletes a board while preserving nested board relationships in trash', async () => {
    const database = makeDatabaseBlock();
    const recordPage = makePage({
      id: 'record_page_1',
      parentPageId: database.pageId,
      title: 'Work item',
    });
    const record = makeDatabaseRecord({ pageId: recordPage.id });

    databaseRepo.findByIdIncludingDeleted.mockResolvedValue(database);
    databaseRepo.listDatabaseRecords.mockResolvedValue([record]);
    databaseRepo.archiveDatabases.mockResolvedValue({
      databaseIds: [database.id],
      recordCount: 1,
    });
    pageRepo.findById.mockImplementation(async (pageId: string) => {
      if (pageId === database.pageId) return page;
      if (pageId === recordPage.id) return recordPage;
      return undefined;
    });
    pageRepo.removePage.mockResolvedValue([
      recordPage.id,
      'record_child_page_1',
    ]);

    const result = await service.deleteDatabase(
      {
        databaseId: database.id,
        pageId: database.pageId,
        blockId: database.blockId,
      },
      user,
    );

    expect(databaseRepo.findByIdIncludingDeleted).toHaveBeenCalledWith(
      database.id,
      trx,
      true,
    );
    expect(pageAccessService.validateCanEdit).toHaveBeenCalledWith(page, user);
    expect(pageAccessService.validateCanEdit).toHaveBeenCalledWith(
      recordPage,
      user,
    );
    expect(pageRepo.removePage).toHaveBeenCalledWith(
      recordPage.id,
      user.id,
      database.workspaceId,
      trx,
      false,
    );
    expect(databaseRepo.archiveDatabases).toHaveBeenCalledWith(
      [database.id],
      user.id,
      trx,
    );
    expect(eventEmitter.emit).toHaveBeenCalledWith('page.soft_deleted', {
      pageIds: [recordPage.id, 'record_child_page_1'],
      workspaceId: database.workspaceId,
      databaseInvalidationHandled: true,
    });
    expect(auditService.log).toHaveBeenCalledWith(
      expect.objectContaining({
        event: 'database.deleted',
        resourceId: database.pageId,
        metadata: expect.objectContaining({
          workItemCount: 1,
          trashedPageCount: 2,
          archivedDatabaseCount: 1,
          archivedRecordCount: 1,
        }),
      }),
    );
    expect(wsTreeService.notifyPageQueriesInvalidated).toHaveBeenCalledWith(
      { id: database.pageId, spaceId: database.spaceId },
      [
        { entity: 'database', id: database.id },
        { entity: 'database-records', id: database.id },
        { entity: 'sidebar-full-tree', id: database.spaceId },
      ],
    );
    expect(result).toEqual({
      databaseId: database.id,
      alreadyDeleted: false,
      workItemCount: 1,
      trashedPageCount: 2,
    });
  });

  it('does not delete a board when a work item page is not editable', async () => {
    const database = makeDatabaseBlock();
    const recordPage = makePage({
      id: 'record_page_1',
      parentPageId: database.pageId,
    });
    databaseRepo.findByIdIncludingDeleted.mockResolvedValue(database);
    databaseRepo.listDatabaseRecords.mockResolvedValue([
      makeDatabaseRecord({ pageId: recordPage.id }),
    ]);
    pageRepo.findById.mockImplementation(async (pageId: string) =>
      pageId === recordPage.id ? recordPage : page,
    );
    pageAccessService.validateCanEdit
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error('forbidden'));

    await expect(
      service.deleteDatabase(
        {
          databaseId: database.id,
          pageId: database.pageId,
          blockId: database.blockId,
        },
        user,
      ),
    ).rejects.toThrow('forbidden');

    expect(pageRepo.removePage).not.toHaveBeenCalled();
    expect(databaseRepo.archiveDatabases).not.toHaveBeenCalled();
    expect(auditService.log).not.toHaveBeenCalled();
  });

  it('does not silently detach an active work item with invalid page membership', async () => {
    const database = makeDatabaseBlock();
    const movedRecordPage = makePage({
      id: 'record_page_1',
      parentPageId: 'different_parent',
    });
    databaseRepo.findByIdIncludingDeleted.mockResolvedValue(database);
    databaseRepo.listDatabaseRecords.mockResolvedValue([
      makeDatabaseRecord({ pageId: movedRecordPage.id }),
    ]);
    pageRepo.findById.mockImplementation(async (pageId: string) =>
      pageId === movedRecordPage.id ? movedRecordPage : page,
    );

    await expect(
      service.deleteDatabase(
        {
          databaseId: database.id,
          pageId: database.pageId,
          blockId: database.blockId,
        },
        user,
      ),
    ).rejects.toMatchObject({
      response: expect.objectContaining({
        code: 'DATABASE_PAGE_MEMBERSHIP_INVALID',
      }),
    });

    expect(pageRepo.removePage).not.toHaveBeenCalled();
    expect(databaseRepo.archiveDatabases).not.toHaveBeenCalled();
  });

  it('treats a retried delete as success without duplicating side effects', async () => {
    const database = makeDatabaseBlock({
      deletedAt: new Date('2026-07-14T00:00:00.000Z'),
    });
    databaseRepo.findByIdIncludingDeleted.mockResolvedValue(database);
    pageRepo.findById.mockResolvedValue(page);

    const result = await service.deleteDatabase(
      {
        databaseId: database.id,
        pageId: database.pageId,
        blockId: database.blockId,
      },
      user,
    );

    expect(pageAccessService.validateCanEdit).toHaveBeenCalledWith(page, user);
    expect(databaseRepo.listDatabaseRecords).not.toHaveBeenCalled();
    expect(databaseRepo.archiveDatabases).not.toHaveBeenCalled();
    expect(eventEmitter.emit).not.toHaveBeenCalled();
    expect(auditService.log).not.toHaveBeenCalled();
    expect(wsTreeService.notifyPageQueriesInvalidated).not.toHaveBeenCalled();
    expect(result).toEqual({
      databaseId: database.id,
      alreadyDeleted: true,
      workItemCount: 0,
      trashedPageCount: 0,
    });
  });

  it('does not fail a committed delete when realtime publication fails', async () => {
    const database = makeDatabaseBlock();
    databaseRepo.findByIdIncludingDeleted.mockResolvedValue(database);
    databaseRepo.listDatabaseRecords.mockResolvedValue([]);
    databaseRepo.archiveDatabases.mockResolvedValue({
      databaseIds: [database.id],
      recordCount: 0,
    });
    pageRepo.findById.mockResolvedValue(page);
    wsTreeService.notifyPageQueriesInvalidated.mockRejectedValue(
      new Error('websocket unavailable'),
    );
    jest
      .spyOn(
        (service as unknown as { logger: { error: () => void } }).logger,
        'error',
      )
      .mockImplementation(() => undefined);

    await expect(
      service.deleteDatabase(
        {
          databaseId: database.id,
          pageId: database.pageId,
          blockId: database.blockId,
        },
        user,
      ),
    ).resolves.toMatchObject({
      databaseId: database.id,
      alreadyDeleted: false,
    });

    expect(auditService.log).toHaveBeenCalledWith(
      expect.objectContaining({ event: 'database.deleted' }),
    );
    expect(systemDiagnosticsService.recordIncident).toHaveBeenCalledWith(
      database.workspaceId,
      'realtime_invalidation_failure',
      { source: 'database_invalidation' },
    );
  });

  it('rejects delete context that does not match the owning block', async () => {
    const database = makeDatabaseBlock();
    databaseRepo.findByIdIncludingDeleted.mockResolvedValue(database);

    await expect(
      service.deleteDatabase(
        {
          databaseId: database.id,
          pageId: database.pageId,
          blockId: 'forged_block',
        },
        user,
      ),
    ).rejects.toThrow('Database not found');

    expect(pageRepo.findById).not.toHaveBeenCalled();
    expect(databaseRepo.archiveDatabases).not.toHaveBeenCalled();
  });

  it('ignores a database block removed from a page that does not own it', async () => {
    const database = makeDatabaseBlock();
    databaseRepo.findById.mockResolvedValue(database);

    const effect = await service.deleteDatabaseFromPageContent(
      database.id,
      'copied_block_page',
      database.blockId,
      user,
      trx as never,
    );

    expect(effect).toBeUndefined();
    expect(pageRepo.findById).not.toHaveBeenCalled();
    expect(databaseRepo.listDatabaseRecords).not.toHaveBeenCalled();
    expect(databaseRepo.archiveDatabases).not.toHaveBeenCalled();
  });

  it('ignores a database block with a forged block id on the owning page', async () => {
    const database = makeDatabaseBlock();
    databaseRepo.findById.mockResolvedValue(database);

    const effect = await service.deleteDatabaseFromPageContent(
      database.id,
      database.pageId,
      'forged_block',
      user,
      trx as never,
    );

    expect(effect).toBeUndefined();
    expect(pageRepo.findById).not.toHaveBeenCalled();
    expect(databaseRepo.archiveDatabases).not.toHaveBeenCalled();
  });

  it('requires explicit deletion before a direct content update removes an owned board', async () => {
    const database = makeDatabaseBlock();
    databaseRepo.findById.mockResolvedValue(database);

    await expect(
      service.deleteDatabaseFromPageContent(
        database.id,
        database.pageId,
        database.blockId,
        user,
        trx as never,
        true,
      ),
    ).rejects.toMatchObject({
      response: expect.objectContaining({
        code: 'DATABASE_EXPLICIT_DELETE_REQUIRED',
      }),
    });

    expect(pageRepo.findById).not.toHaveBeenCalled();
    expect(databaseRepo.archiveDatabases).not.toHaveBeenCalled();
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
      fields: {
        Title: 'Latest title snapshot',
        Status: 'In progress',
        Priority: 'High',
      },
    });
    databaseRepo.findById.mockImplementation(async (databaseId: string) =>
      databaseId === targetDatabase.id ? targetDatabase : sourceDatabase,
    );
    databaseRepo.findDatabaseRecord.mockResolvedValue(sourceRecord);
    databaseRepo.listActiveDatabaseRecordsByPage.mockResolvedValue([
      sourceRecord,
    ]);
    databaseRepo.insertDatabaseRecord.mockResolvedValue(targetRecord);
    wsTreeService.notifyPageRelocated.mockRejectedValue(
      new Error('websocket unavailable'),
    );
    jest
      .spyOn(
        (service as unknown as { logger: { error: () => void } }).logger,
        'error',
      )
      .mockImplementation(() => undefined);
    let movingPageLookupCount = 0;
    pageRepo.findById.mockImplementation(async (pageId: string) => {
      if (pageId === targetDatabase.pageId) {
        return makePage({ id: targetDatabase.pageId });
      }
      if (pageId === sourceDatabase.pageId) {
        return makePage({ id: sourceDatabase.pageId });
      }
      if (pageId === movingPage.id) {
        movingPageLookupCount += 1;
        return movingPageLookupCount <= 2 ? movingPage : relocatedMovingPage;
      }
      return undefined;
    });

    const result = await service.attachPage(
      {
        databaseId: targetDatabase.id,
        pageId: movingPage.id,
        sourceDatabaseId: sourceDatabase.id,
        sourceRecordId: sourceRecord.id,
        fields: { Status: 'Done' },
      },
      user,
    );

    expect(databaseRepo.insertDatabaseRecord).toHaveBeenCalledWith(
      expect.objectContaining({
        databaseId: targetDatabase.id,
        pageId: movingPage.id,
        fields: expect.objectContaining({
          Title: movingPage.title,
          Status: 'Done',
          Priority: 'High',
        }),
      }),
      trx,
    );
    expect(db.transaction).toHaveBeenCalled();
    expect(pageService.lockPageTreeSpacesForUpdate).toHaveBeenCalledWith(
      [movingPage.spaceId],
      trx,
    );
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
    pageRepo.findById.mockImplementation(async (pageId: string) => {
      if (pageId === database.pageId) {
        return makePage({ id: database.pageId });
      }
      if (pageId === movingPage.id) return movingPage;
      return undefined;
    });

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

  it('rejects an attach request when the page changes space before locking', async () => {
    const database = makeDatabaseBlock({ pageId: 'database_page_1' });
    const movingPage = makePage({ id: 'record_page_1' });
    const movedPage = makePage({
      ...movingPage,
      spaceId: 'space_2',
    });
    databaseRepo.findById.mockResolvedValue(database);
    let movingPageLookupCount = 0;
    pageRepo.findById.mockImplementation(async (pageId: string) => {
      if (pageId === database.pageId) {
        return makePage({ id: database.pageId });
      }
      if (pageId === movingPage.id) {
        movingPageLookupCount += 1;
        return movingPageLookupCount === 1 ? movingPage : movedPage;
      }
      return undefined;
    });

    await expect(
      service.attachPage(
        { databaseId: database.id, pageId: movingPage.id },
        user,
      ),
    ).rejects.toMatchObject({
      response: expect.objectContaining({
        code: 'DATABASE_PAGE_CHANGED_RETRY',
      }),
    });

    expect(databaseRepo.insertDatabaseRecord).not.toHaveBeenCalled();
    expect(pageService.movePageToParent).not.toHaveBeenCalled();
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
      pageId: 'record_page_1',
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
    pageRepo.findById.mockImplementation(async (pageId: string) =>
      pageId === recordPage.id ? recordPage : page,
    );

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

  it('validates new records against the schema locked inside the transaction', async () => {
    const databaseSnapshot = makeDatabaseBlock();
    const currentDatabase = makeDatabaseBlock({
      fields: [
        { name: 'Title', type: 'text', isPrimary: true },
      ] as unknown as DatabaseBlock['fields'],
    });
    databaseRepo.findById
      .mockResolvedValueOnce(databaseSnapshot)
      .mockResolvedValueOnce(currentDatabase);
    pageRepo.findById.mockResolvedValue(page);

    await expect(
      service.createRecord(
        {
          databaseId: databaseSnapshot.id,
          fields: { Title: 'Task', Status: 'Done' },
        },
        user,
      ),
    ).rejects.toMatchObject({
      response: expect.objectContaining({
        code: 'DATABASE_RECORD_VALIDATION_FAILED',
        field: 'Status',
      }),
    });

    expect(pageRepo.insertPage).not.toHaveBeenCalled();
    expect(databaseRepo.insertDatabaseRecord).not.toHaveBeenCalled();
  });

  it('preserves concurrent schema additions when creating a field', async () => {
    const databaseSnapshot = makeDatabaseBlock();
    const currentDatabase = makeDatabaseBlock({
      fields: [
        ...buildDefaultFieldsForTemplate('tasks'),
        { name: 'Concurrent field', type: 'text' },
      ] as unknown as DatabaseBlock['fields'],
    });
    databaseRepo.findById
      .mockResolvedValueOnce(databaseSnapshot)
      .mockResolvedValueOnce(currentDatabase);
    pageRepo.findById.mockResolvedValue(page);
    databaseRepo.updateFields.mockImplementation(async (_databaseId, fields) =>
      makeDatabaseBlock({ ...currentDatabase, fields }),
    );

    await service.createField(
      { databaseId: databaseSnapshot.id, name: 'New field', type: 'text' },
      user,
    );

    expect(databaseRepo.updateFields).toHaveBeenCalledWith(
      databaseSnapshot.id,
      expect.arrayContaining([
        expect.objectContaining({ name: 'Concurrent field' }),
        expect.objectContaining({ name: 'New field' }),
      ]),
      user.id,
      trx,
    );
  });

  it('merges record updates with the row locked inside the transaction', async () => {
    const database = makeDatabaseBlock();
    const recordSnapshot = makeDatabaseRecord({
      pageId: 'record_page_1',
      fields: { Title: 'Old title', Status: 'Todo', Priority: 'Low' },
    });
    const currentRecord = makeDatabaseRecord({
      pageId: 'record_page_1',
      fields: {
        Title: 'Concurrent title',
        Status: 'Todo',
        Priority: 'High',
      },
    });
    const recordPage = makePage({
      id: 'record_page_1',
      parentPageId: database.pageId,
      title: 'Concurrent title',
    });
    databaseRepo.findById.mockResolvedValue(database);
    databaseRepo.findDatabaseRecord
      .mockResolvedValueOnce(recordSnapshot)
      .mockResolvedValue(currentRecord);
    databaseRepo.updateDatabaseRecordFields.mockImplementation(
      async (_databaseId, _recordId, fields) =>
        makeDatabaseRecord({ ...currentRecord, fields }),
    );
    pageRepo.findById.mockImplementation(async (pageId: string) =>
      pageId === recordPage.id ? recordPage : page,
    );

    await service.updateRecord(
      {
        databaseId: database.id,
        recordId: currentRecord.id,
        fields: { Status: 'Done' },
      },
      user,
    );

    expect(databaseRepo.updateDatabaseRecordFields).toHaveBeenCalledWith(
      database.id,
      currentRecord.id,
      expect.objectContaining({
        Title: 'Concurrent title',
        Status: 'Done',
        Priority: 'High',
      }),
      user.id,
      trx,
    );
  });

  it('rejects trashing a damaged work-item relationship', async () => {
    const database = makeDatabaseBlock();
    const record = makeDatabaseRecord({ pageId: 'missing_page' });
    databaseRepo.findById.mockResolvedValue(database);
    databaseRepo.findDatabaseRecord.mockResolvedValue(record);
    pageRepo.findById.mockImplementation(async (pageId: string) =>
      pageId === database.pageId ? page : undefined,
    );

    await expect(
      service.trashRecordPage(
        { databaseId: database.id, recordId: record.id },
        user,
      ),
    ).rejects.toMatchObject({
      response: expect.objectContaining({
        code: 'DATABASE_PAGE_MEMBERSHIP_INVALID',
      }),
    });

    expect(pageRepo.removePage).not.toHaveBeenCalled();
  });

  it('rejects reorder anchors that disappeared before the row lock', async () => {
    const database = makeDatabaseBlock();
    const record = makeDatabaseRecord({ pageId: 'record_page_1' });
    const recordPage = makePage({
      id: 'record_page_1',
      parentPageId: database.pageId,
    });
    databaseRepo.findById.mockResolvedValue(database);
    databaseRepo.findDatabaseRecord.mockImplementation(
      async (_databaseId: string, recordId: string) =>
        recordId === record.id ? record : undefined,
    );
    pageRepo.findById.mockImplementation(async (pageId: string) =>
      pageId === recordPage.id ? recordPage : page,
    );

    await expect(
      service.reorderRecord(
        {
          databaseId: database.id,
          recordId: record.id,
          beforeRecordId: 'removed_anchor',
        },
        user,
      ),
    ).rejects.toMatchObject({
      response: expect.objectContaining({
        code: 'DATABASE_REORDER_TARGET_CHANGED_RETRY',
      }),
    });

    expect(databaseRepo.updateDatabaseRecordSort).not.toHaveBeenCalled();
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
