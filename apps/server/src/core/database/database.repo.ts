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

@Injectable()
export class DatabaseRepo {
  constructor(@InjectKysely() private readonly db: KyselyDB) {}

  async insertDatabaseBlock(
    data: InsertableDatabaseBlock,
  ): Promise<DatabaseBlock> {
    return this.db
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
  ): Promise<DatabaseBlock> {
    return this.db
      .updateTable('databaseBlocks')
      .set({ fields, updatedById: userId, updatedAt: new Date() })
      .where('id', '=', databaseId)
      .where('deletedAt', 'is', null)
      .returningAll()
      .executeTakeFirstOrThrow();
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
  ): Promise<DatabaseRecord[]> {
    if (data.length === 0) return [];

    return this.db
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

  async updateDatabaseRecordFields(
    databaseId: string,
    recordId: string,
    fields: Json,
    userId: string,
  ): Promise<DatabaseRecord> {
    return this.db
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
