import { Injectable } from '@nestjs/common';
import { InjectKysely } from 'nestjs-kysely';
import { KyselyDB, KyselyTransaction } from '@docmost/db/types/kysely.types';
import { dbOrTx } from '@docmost/db/utils';

@Injectable()
export class CredentialRevocationService {
  constructor(@InjectKysely() private readonly db: KyselyDB) {}

  lockActiveUserForIssuance(
    userId: string,
    workspaceId: string,
    trx: KyselyTransaction,
  ) {
    return trx
      .selectFrom('users')
      .selectAll()
      .where('id', '=', userId)
      .where('workspaceId', '=', workspaceId)
      .where('deletedAt', 'is', null)
      .where('deactivatedAt', 'is', null)
      .forUpdate()
      .executeTakeFirst();
  }

  async revokeForUser(
    userId: string,
    workspaceId: string,
    trx?: KyselyTransaction,
  ): Promise<void> {
    const db = dbOrTx(this.db, trx);
    const now = new Date();

    await db
      .updateTable('apiKeys')
      .set({ deletedAt: now, updatedAt: now })
      .where('creatorId', '=', userId)
      .where('workspaceId', '=', workspaceId)
      .where('deletedAt', 'is', null)
      .execute();

    await db
      .updateTable('oauthAuthorizations')
      .set({ revokedAt: now, updatedAt: now })
      .where('userId', '=', userId)
      .where('workspaceId', '=', workspaceId)
      .where('revokedAt', 'is', null)
      .execute();

    await db
      .updateTable('oauthRefreshTokens')
      .set({ revokedAt: now })
      .where('userId', '=', userId)
      .where('workspaceId', '=', workspaceId)
      .where('revokedAt', 'is', null)
      .execute();

    await db
      .updateTable('oauthAuthorizationCodes')
      .set({ consumedAt: now })
      .where('userId', '=', userId)
      .where('workspaceId', '=', workspaceId)
      .where('consumedAt', 'is', null)
      .execute();
  }
}
