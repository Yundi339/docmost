import { Injectable } from '@nestjs/common';
import { InjectKysely } from 'nestjs-kysely';
import { KyselyDB, KyselyTransaction } from '@docmost/db/types/kysely.types';
import {
  DatabaseBlock,
  DatabaseRecord,
  InsertableDatabaseBlock,
  InsertableDatabaseRecord,
} from '@docmost/db/types/entity.types';
import { Json } from '@docmost/db/types/db';
import { dbOrTx } from '@docmost/db/utils';
import { sql } from 'kysely';

export type DatabasePagePolicyBinding = {
  role: 'host' | 'record';
  pageId: string;
  resourceId: string;
  databaseId: string;
  databasePageId: string;
  spaceId: string;
  workspaceId: string;
};

export type DatabaseRecordOwner = {
  databaseId: string;
  databasePageId: string;
  spaceId: string;
  workspaceId: string;
};

@Injectable()
export class DatabaseRepo {
  constructor(@InjectKysely() private readonly db: KyselyDB) {}

  async insertDatabaseBlock(
    data: InsertableDatabaseBlock,
    trx?: KyselyTransaction,
  ): Promise<DatabaseBlock> {
    return dbOrTx(this.db, trx)
      .insertInto('databaseBlocks')
      .values(data)
      .returningAll()
      .executeTakeFirstOrThrow();
  }

  async findById(databaseId: string): Promise<DatabaseBlock | undefined> {
    return this.db
      .selectFrom('databaseBlocks')
      .selectAll()
      .where('id', '=', databaseId)
      .where('deletedAt', 'is', null)
      .executeTakeFirst();
  }

  async findByPageAndBlock(
    pageId: string,
    blockId: string,
  ): Promise<DatabaseBlock | undefined> {
    return this.db
      .selectFrom('databaseBlocks')
      .selectAll()
      .where('pageId', '=', pageId)
      .where('blockId', '=', blockId)
      .where('deletedAt', 'is', null)
      .executeTakeFirst();
  }

  async listByWorkspace(workspaceId: string): Promise<DatabaseBlock[]> {
    return this.db
      .selectFrom('databaseBlocks')
      .selectAll()
      .where('workspaceId', '=', workspaceId)
      .where('deletedAt', 'is', null)
      .orderBy('updatedAt', 'desc')
      .limit(100)
      .execute();
  }

  async listActiveWorkspaceUserIds(
    workspaceId: string,
    userIds: string[],
  ): Promise<string[]> {
    if (userIds.length === 0) return [];

    const users = await this.db
      .selectFrom('users')
      .select('id')
      .where('workspaceId', '=', workspaceId)
      .where('id', 'in', [...new Set(userIds)])
      .where('deletedAt', 'is', null)
      .where('deactivatedAt', 'is', null)
      .execute();

    return users.map((user) => user.id);
  }

  async updateViews(
    databaseId: string,
    views: Json,
    activeViewId: string,
    userId: string,
  ): Promise<DatabaseBlock> {
    return this.db
      .updateTable('databaseBlocks')
      .set({ views, activeViewId, updatedById: userId, updatedAt: new Date() })
      .where('id', '=', databaseId)
      .returningAll()
      .executeTakeFirstOrThrow();
  }

  async updateTitle(
    databaseId: string,
    title: string,
    userId: string,
  ): Promise<DatabaseBlock> {
    return this.db
      .updateTable('databaseBlocks')
      .set({ title, updatedById: userId, updatedAt: new Date() })
      .where('id', '=', databaseId)
      .where('deletedAt', 'is', null)
      .returningAll()
      .executeTakeFirstOrThrow();
  }

  async updateFields(
    databaseId: string,
    fields: Json,
    userId: string,
    trx?: KyselyTransaction,
  ): Promise<DatabaseBlock> {
    return dbOrTx(this.db, trx)
      .updateTable('databaseBlocks')
      .set({ fields, updatedById: userId, updatedAt: new Date() })
      .where('id', '=', databaseId)
      .where('deletedAt', 'is', null)
      .returningAll()
      .executeTakeFirstOrThrow();
  }

  async backfillDatabaseRecordField(
    databaseId: string,
    fieldName: string,
    defaultValue: Json,
    userId: string,
    trx?: KyselyTransaction,
  ): Promise<void> {
    await dbOrTx(this.db, trx)
      .updateTable('databaseRecords')
      .set({
        fields: sql<Json>`jsonb_set(fields, array[${fieldName}]::text[], ${JSON.stringify(defaultValue)}::jsonb, true)`,
        updatedById: userId,
        updatedAt: new Date(),
      })
      .where('databaseId', '=', databaseId)
      .where('deletedAt', 'is', null)
      .where(sql<boolean>`not (fields ? ${fieldName})`)
      .execute();
  }

  async renameDatabaseRecordField(
    databaseId: string,
    oldName: string,
    newName: string,
    userId: string,
    trx?: KyselyTransaction,
  ): Promise<void> {
    await dbOrTx(this.db, trx)
      .updateTable('databaseRecords')
      .set({
        fields: sql<Json>`(fields - ${oldName}) || jsonb_build_object(${newName}, fields -> ${oldName})`,
        updatedById: userId,
        updatedAt: new Date(),
      })
      .where('databaseId', '=', databaseId)
      .where('deletedAt', 'is', null)
      .where(sql<boolean>`fields ? ${oldName}`)
      .execute();
  }

  async updateMetadata(
    databaseId: string,
    metadata: Json,
    userId: string,
  ): Promise<DatabaseBlock> {
    return this.db
      .updateTable('databaseBlocks')
      .set({ metadata, updatedById: userId, updatedAt: new Date() })
      .where('id', '=', databaseId)
      .returningAll()
      .executeTakeFirstOrThrow();
  }

  async insertDatabaseRecord(
    data: InsertableDatabaseRecord,
    trx?: KyselyTransaction,
  ): Promise<DatabaseRecord> {
    return dbOrTx(this.db, trx)
      .insertInto('databaseRecords')
      .values(data)
      .returningAll()
      .executeTakeFirstOrThrow();
  }

  async insertDatabaseRecords(
    data: InsertableDatabaseRecord[],
    trx?: KyselyTransaction,
  ): Promise<DatabaseRecord[]> {
    if (data.length === 0) return [];

    return dbOrTx(this.db, trx)
      .insertInto('databaseRecords')
      .values(data)
      .returningAll()
      .execute();
  }

  async listDatabaseRecords(databaseId: string): Promise<DatabaseRecord[]> {
    return this.db
      .selectFrom('databaseRecords')
      .selectAll()
      .where('databaseId', '=', databaseId)
      .where('deletedAt', 'is', null)
      .orderBy('sortOrder', 'asc')
      .orderBy('createdAt', 'asc')
      .execute();
  }

  async findDatabaseRecord(
    databaseId: string,
    recordId: string,
    trx?: KyselyTransaction,
  ): Promise<DatabaseRecord | undefined> {
    return dbOrTx(this.db, trx)
      .selectFrom('databaseRecords')
      .selectAll()
      .where('databaseId', '=', databaseId)
      .where('id', '=', recordId)
      .where('deletedAt', 'is', null)
      .executeTakeFirst();
  }

  async findDatabaseRecordByPage(
    databaseId: string,
    pageId: string,
    trx?: KyselyTransaction,
  ): Promise<DatabaseRecord | undefined> {
    return dbOrTx(this.db, trx)
      .selectFrom('databaseRecords')
      .selectAll()
      .where('databaseId', '=', databaseId)
      .where('pageId', '=', pageId)
      .where('deletedAt', 'is', null)
      .executeTakeFirst();
  }

  async listActiveDatabaseRecordsByPage(
    pageId: string,
    trx?: KyselyTransaction,
  ): Promise<DatabaseRecord[]> {
    return dbOrTx(this.db, trx)
      .selectFrom('databaseRecords')
      .innerJoin('databaseBlocks', (join) =>
        join
          .onRef('databaseBlocks.id', '=', 'databaseRecords.databaseId')
          .on('databaseBlocks.deletedAt', 'is', null),
      )
      .selectAll('databaseRecords')
      .where('databaseRecords.pageId', '=', pageId)
      .where('databaseRecords.deletedAt', 'is', null)
      .execute();
  }

  async listActiveDatabaseOwnersByRecordPages(
    pageIds: string[],
    trx?: KyselyTransaction,
  ): Promise<DatabaseRecordOwner[]> {
    if (pageIds.length === 0) return [];

    return dbOrTx(this.db, trx)
      .selectFrom('databaseRecords')
      .innerJoin('databaseBlocks', (join) =>
        join
          .onRef('databaseBlocks.id', '=', 'databaseRecords.databaseId')
          .on('databaseBlocks.deletedAt', 'is', null),
      )
      .select([
        'databaseBlocks.id as databaseId',
        'databaseBlocks.pageId as databasePageId',
        'databaseBlocks.spaceId',
        'databaseBlocks.workspaceId',
      ])
      .distinct()
      .where('databaseRecords.pageId', 'in', pageIds)
      .where('databaseRecords.deletedAt', 'is', null)
      .execute();
  }

  async listPagePolicyBindings(
    pageIds: string[],
    trx?: KyselyTransaction,
  ): Promise<DatabasePagePolicyBinding[]> {
    if (pageIds.length === 0) return [];

    const db = dbOrTx(this.db, trx);
    const [hosts, records] = await Promise.all([
      db
        .selectFrom('databaseBlocks')
        .select([
          'id as resourceId',
          'id as databaseId',
          'pageId',
          'pageId as databasePageId',
          'spaceId',
          'workspaceId',
        ])
        .where('pageId', 'in', pageIds)
        .where('deletedAt', 'is', null)
        .execute(),
      db
        .selectFrom('databaseRecords')
        .innerJoin('databaseBlocks', (join) =>
          join
            .onRef('databaseBlocks.id', '=', 'databaseRecords.databaseId')
            .on('databaseBlocks.deletedAt', 'is', null),
        )
        .select([
          'databaseRecords.id as resourceId',
          'databaseRecords.databaseId',
          'databaseRecords.pageId',
          'databaseBlocks.pageId as databasePageId',
          'databaseBlocks.spaceId',
          'databaseBlocks.workspaceId',
        ])
        .where('databaseRecords.pageId', 'in', pageIds)
        .where('databaseRecords.deletedAt', 'is', null)
        .execute(),
    ]);

    return [
      ...hosts.map((binding) => ({
        ...binding,
        role: 'host' as const,
      })),
      ...records.map((binding) => ({
        ...binding,
        role: 'record' as const,
      })),
    ];
  }

  async updateDatabaseRecordFields(
    databaseId: string,
    recordId: string,
    fields: Json,
    userId: string,
    trx?: KyselyTransaction,
  ): Promise<DatabaseRecord> {
    return dbOrTx(this.db, trx)
      .updateTable('databaseRecords')
      .set({ fields, updatedById: userId, updatedAt: new Date() })
      .where('databaseId', '=', databaseId)
      .where('id', '=', recordId)
      .where('deletedAt', 'is', null)
      .returningAll()
      .executeTakeFirstOrThrow();
  }

  async updateDatabaseRecordSort(
    databaseId: string,
    recordId: string,
    sortOrder: string,
    userId: string,
  ): Promise<DatabaseRecord> {
    return this.db
      .updateTable('databaseRecords')
      .set({ sortOrder, updatedById: userId, updatedAt: new Date() })
      .where('databaseId', '=', databaseId)
      .where('id', '=', recordId)
      .where('deletedAt', 'is', null)
      .returningAll()
      .executeTakeFirstOrThrow();
  }

  async updateDatabaseRecordPageId(
    databaseId: string,
    recordId: string,
    pageId: string,
    userId: string,
    trx?: KyselyTransaction,
  ): Promise<DatabaseRecord> {
    return dbOrTx(this.db, trx)
      .updateTable('databaseRecords')
      .set({ pageId, updatedById: userId, updatedAt: new Date() })
      .where('databaseId', '=', databaseId)
      .where('id', '=', recordId)
      .where('deletedAt', 'is', null)
      .returningAll()
      .executeTakeFirstOrThrow();
  }

  async detachDatabaseRecord(
    databaseId: string,
    recordId: string,
    userId: string,
    trx?: KyselyTransaction,
  ): Promise<DatabaseRecord> {
    return dbOrTx(this.db, trx)
      .updateTable('databaseRecords')
      .set({
        deletedAt: new Date(),
        updatedById: userId,
        updatedAt: new Date(),
      })
      .where('databaseId', '=', databaseId)
      .where('id', '=', recordId)
      .where('deletedAt', 'is', null)
      .returningAll()
      .executeTakeFirstOrThrow();
  }

  async getLastDatabaseRecordSortOrder(
    databaseId: string,
    trx?: KyselyTransaction,
  ): Promise<string | null> {
    const lastRecord = await dbOrTx(this.db, trx)
      .selectFrom('databaseRecords')
      .select('sortOrder')
      .where('databaseId', '=', databaseId)
      .where('deletedAt', 'is', null)
      .where('sortOrder', 'is not', null)
      .orderBy('sortOrder', (ob) => ob.collate('C').desc())
      .executeTakeFirst();

    return lastRecord?.sortOrder ?? null;
  }

  async getLastChildPagePosition(
    spaceId: string,
    parentPageId: string,
    trx?: KyselyTransaction,
  ): Promise<string | null> {
    const lastPage = await dbOrTx(this.db, trx)
      .selectFrom('pages')
      .select('position')
      .where('spaceId', '=', spaceId)
      .where('parentPageId', '=', parentPageId)
      .where('deletedAt', 'is', null)
      .orderBy('position', (ob) => ob.collate('C').desc())
      .executeTakeFirst();

    return lastPage?.position ?? null;
  }
}
