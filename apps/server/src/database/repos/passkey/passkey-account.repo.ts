import { Injectable } from '@nestjs/common';
import { InjectKysely } from 'nestjs-kysely';
import { KyselyDB, KyselyTransaction } from '@docmost/db/types/kysely.types';
import { dbOrTx } from '@docmost/db/utils';
import {
  InsertablePasskeyAccount,
  PasskeyAccount,
} from '@docmost/db/types/entity.types';

@Injectable()
export class PasskeyAccountRepo {
  constructor(@InjectKysely() private readonly db: KyselyDB) {}

  async findByUser(
    userId: string,
    workspaceId: string,
    opts?: { trx?: KyselyTransaction; forUpdate?: boolean },
  ): Promise<PasskeyAccount | undefined> {
    let query = dbOrTx(this.db, opts?.trx)
      .selectFrom('passkeyAccounts')
      .selectAll()
      .where('userId', '=', userId)
      .where('workspaceId', '=', workspaceId);

    if (opts?.forUpdate) {
      query = query.forUpdate();
    }
    return query.executeTakeFirst();
  }

  async insert(
    account: InsertablePasskeyAccount,
    trx?: KyselyTransaction,
  ): Promise<PasskeyAccount | undefined> {
    return dbOrTx(this.db, trx)
      .insertInto('passkeyAccounts')
      .values(account)
      .onConflict((oc) => oc.column('userId').doNothing())
      .returningAll()
      .executeTakeFirst();
  }
}
