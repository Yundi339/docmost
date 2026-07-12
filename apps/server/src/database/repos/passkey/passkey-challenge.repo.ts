import { Injectable } from '@nestjs/common';
import { InjectKysely } from 'nestjs-kysely';
import { sql } from 'kysely';
import { KyselyDB, KyselyTransaction } from '@docmost/db/types/kysely.types';
import { dbOrTx } from '@docmost/db/utils';
import {
  InsertablePasskeyChallenge,
  PasskeyChallenge,
} from '@docmost/db/types/entity.types';

@Injectable()
export class PasskeyChallengeRepo {
  constructor(@InjectKysely() private readonly db: KyselyDB) {}

  async insert(
    challenge: InsertablePasskeyChallenge,
    trx?: KyselyTransaction,
  ): Promise<PasskeyChallenge> {
    return dbOrTx(this.db, trx)
      .insertInto('passkeyChallenges')
      .values(challenge)
      .returningAll()
      .executeTakeFirstOrThrow();
  }

  async deleteForSessionType(
    sessionId: string,
    type: string,
    trx?: KyselyTransaction,
  ): Promise<void> {
    await dbOrTx(this.db, trx)
      .deleteFrom('passkeyChallenges')
      .where('sessionId', '=', sessionId)
      .where('type', '=', type)
      .execute();
  }

  async consume(opts: {
    id: string;
    workspaceId: string;
    type: string;
    userId?: string;
    sessionId?: string;
    trx?: KyselyTransaction;
  }): Promise<PasskeyChallenge | undefined> {
    let query = dbOrTx(this.db, opts.trx)
      .deleteFrom('passkeyChallenges')
      .where('id', '=', opts.id)
      .where('workspaceId', '=', opts.workspaceId)
      .where('type', '=', opts.type)
      .where('expiresAt', '>', sql<Date>`now()`);

    if (opts.userId) {
      query = query.where('userId', '=', opts.userId);
    }
    if (opts.sessionId) {
      query = query.where('sessionId', '=', opts.sessionId);
    }

    return query.returningAll().executeTakeFirst();
  }

  async deleteExpired(): Promise<number> {
    const result = await this.db
      .deleteFrom('passkeyChallenges')
      .where('expiresAt', '<=', sql<Date>`now()`)
      .executeTakeFirst();
    return Number(result.numDeletedRows);
  }
}
