import { Injectable } from '@nestjs/common';
import { InjectKysely } from 'nestjs-kysely';
import { KyselyDB, KyselyTransaction } from '@docmost/db/types/kysely.types';
import { dbOrTx } from '@docmost/db/utils';
import {
  InsertableUserPasskey,
  UserPasskey,
} from '@docmost/db/types/entity.types';

@Injectable()
export class UserPasskeyRepo {
  constructor(@InjectKysely() private readonly db: KyselyDB) {}

  async listForUser(
    userId: string,
    workspaceId: string,
  ): Promise<UserPasskey[]> {
    return this.db
      .selectFrom('userPasskeys')
      .selectAll()
      .where('userId', '=', userId)
      .where('workspaceId', '=', workspaceId)
      .orderBy('createdAt', 'desc')
      .execute();
  }

  async countForUser(
    userId: string,
    workspaceId: string,
    trx?: KyselyTransaction,
  ): Promise<number> {
    const result = await dbOrTx(this.db, trx)
      .selectFrom('userPasskeys')
      .select((eb) => eb.fn.countAll<number>().as('count'))
      .where('userId', '=', userId)
      .where('workspaceId', '=', workspaceId)
      .executeTakeFirstOrThrow();
    return Number(result.count);
  }

  async findByIdForUser(
    id: string,
    userId: string,
    workspaceId: string,
    trx?: KyselyTransaction,
  ): Promise<UserPasskey | undefined> {
    return dbOrTx(this.db, trx)
      .selectFrom('userPasskeys')
      .selectAll()
      .where('id', '=', id)
      .where('userId', '=', userId)
      .where('workspaceId', '=', workspaceId)
      .executeTakeFirst();
  }

  async findByCredentialId(
    credentialId: string,
    workspaceId: string,
    opts?: { trx?: KyselyTransaction; forUpdate?: boolean },
  ): Promise<UserPasskey | undefined> {
    let query = dbOrTx(this.db, opts?.trx)
      .selectFrom('userPasskeys')
      .selectAll()
      .where('credentialId', '=', credentialId)
      .where('workspaceId', '=', workspaceId)
      .where('disabledAt', 'is', null);

    if (opts?.forUpdate) {
      query = query.forUpdate();
    }

    return query.executeTakeFirst();
  }

  async insert(
    passkey: InsertableUserPasskey,
    trx?: KyselyTransaction,
  ): Promise<UserPasskey> {
    return dbOrTx(this.db, trx)
      .insertInto('userPasskeys')
      .values(passkey)
      .returningAll()
      .executeTakeFirstOrThrow();
  }

  async rename(
    id: string,
    userId: string,
    workspaceId: string,
    name: string,
  ): Promise<UserPasskey | undefined> {
    return this.db
      .updateTable('userPasskeys')
      .set({ name, updatedAt: new Date() })
      .where('id', '=', id)
      .where('userId', '=', userId)
      .where('workspaceId', '=', workspaceId)
      .returningAll()
      .executeTakeFirst();
  }

  async updateAuthenticationState(
    id: string,
    counter: number,
    trx?: KyselyTransaction,
  ): Promise<void> {
    await dbOrTx(this.db, trx)
      .updateTable('userPasskeys')
      .set({ counter, lastUsedAt: new Date(), updatedAt: new Date() })
      .where('id', '=', id)
      .where('disabledAt', 'is', null)
      .execute();
  }

  async disable(
    id: string,
    reason: string,
    trx?: KyselyTransaction,
  ): Promise<void> {
    await dbOrTx(this.db, trx)
      .updateTable('userPasskeys')
      .set({
        disabledAt: new Date(),
        disabledReason: reason,
        updatedAt: new Date(),
      })
      .where('id', '=', id)
      .where('disabledAt', 'is', null)
      .execute();
  }

  async deleteForUser(
    id: string,
    userId: string,
    workspaceId: string,
    trx?: KyselyTransaction,
  ): Promise<UserPasskey | undefined> {
    return dbOrTx(this.db, trx)
      .deleteFrom('userPasskeys')
      .where('id', '=', id)
      .where('userId', '=', userId)
      .where('workspaceId', '=', workspaceId)
      .returningAll()
      .executeTakeFirst();
  }
}
