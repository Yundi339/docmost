import { Injectable } from '@nestjs/common';
import { InjectKysely } from 'nestjs-kysely';
import { KyselyDB, KyselyTransaction } from '@docmost/db/types/kysely.types';
import { dbOrTx } from '@docmost/db/utils';
import { ApiKey, InsertableApiKey, UpdatableApiKey } from '@docmost/db/types/entity.types';
import { PaginationOptions } from '@docmost/db/pagination/pagination-options';
import { executeWithCursorPagination } from '@docmost/db/pagination/cursor-pagination';
import { ExpressionBuilder } from 'kysely';
import { DB } from '@docmost/db/types/db';
import { jsonObjectFrom } from 'kysely/helpers/postgres';

@Injectable()
export class ApiKeyRepo {
  constructor(@InjectKysely() private readonly db: KyselyDB) {}

  async findById(
    apiKeyId: string,
    workspaceId: string,
  ): Promise<ApiKey | undefined> {
    return this.db
      .selectFrom('apiKeys')
      .selectAll('apiKeys')
      .select((eb) => this.withCreator(eb))
      .where('id', '=', apiKeyId)
      .where('workspaceId', '=', workspaceId)
      .where('deletedAt', 'is', null)
      .executeTakeFirst();
  }

  async findApiKeys(workspaceId: string, pagination: PaginationOptions) {
    const query = this.db
      .selectFrom('apiKeys')
      .selectAll('apiKeys')
      .select((eb) => this.withCreator(eb))
      .where('workspaceId', '=', workspaceId)
      .where('deletedAt', 'is', null);

    return executeWithCursorPagination(query, {
      perPage: pagination.limit,
      cursor: pagination.cursor,
      beforeCursor: pagination.beforeCursor,
      fields: [{ expression: 'createdAt', direction: 'desc' }, { expression: 'id', direction: 'desc' }],
      parseCursor: (cursor) => ({ createdAt: new Date(cursor.createdAt), id: cursor.id }),
    });
  }

  async insertApiKey(
    insertable: InsertableApiKey,
    trx?: KyselyTransaction,
  ): Promise<ApiKey> {
    const db = dbOrTx(this.db, trx);
    return db
      .insertInto('apiKeys')
      .values(insertable)
      .returningAll()
      .executeTakeFirst();
  }

  async updateApiKey(
    updatable: UpdatableApiKey,
    apiKeyId: string,
    workspaceId: string,
  ): Promise<void> {
    await this.db
      .updateTable('apiKeys')
      .set({ ...updatable, updatedAt: new Date() })
      .where('id', '=', apiKeyId)
      .where('workspaceId', '=', workspaceId)
      .where('deletedAt', 'is', null)
      .execute();
  }

  async softDelete(apiKeyId: string, workspaceId: string): Promise<void> {
    await this.db
      .updateTable('apiKeys')
      .set({ deletedAt: new Date() })
      .where('id', '=', apiKeyId)
      .where('workspaceId', '=', workspaceId)
      .where('deletedAt', 'is', null)
      .execute();
  }

  async updateLastUsed(apiKeyId: string): Promise<void> {
    await this.db
      .updateTable('apiKeys')
      .set({ lastUsedAt: new Date() })
      .where('id', '=', apiKeyId)
      .execute();
  }

  private withCreator(eb: ExpressionBuilder<DB, 'apiKeys'>) {
    return jsonObjectFrom(
      eb
        .selectFrom('users')
        .select(['users.id', 'users.name', 'users.avatarUrl'])
        .whereRef('users.id', '=', 'apiKeys.creatorId'),
    ).as('creator');
  }
}
