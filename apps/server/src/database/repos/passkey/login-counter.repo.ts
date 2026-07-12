import { Injectable } from '@nestjs/common';
import { InjectKysely } from 'nestjs-kysely';
import { sql } from 'kysely';
import { KyselyDB } from '@docmost/db/types/kysely.types';
import { AuthLoginCounter } from '@docmost/db/types/entity.types';

export type LoginMethod = 'password' | 'passkey' | 'mfa';

@Injectable()
export class LoginCounterRepo {
  constructor(@InjectKysely() private readonly db: KyselyDB) {}

  async find(
    workspaceId: string,
    userId: string,
    method: LoginMethod,
  ): Promise<AuthLoginCounter | undefined> {
    return this.db
      .selectFrom('authLoginCounters')
      .selectAll()
      .where('workspaceId', '=', workspaceId)
      .where('userId', '=', userId)
      .where('method', '=', method)
      .executeTakeFirst();
  }

  async recordFailure(
    workspaceId: string,
    userId: string,
    method: LoginMethod,
  ): Promise<AuthLoginCounter> {
    const expiredWindow = sql<boolean>`auth_login_counters.window_started_at <= now() - interval '30 minutes'`;
    const nextCount = sql<number>`CASE WHEN ${expiredWindow} THEN 1 ELSE auth_login_counters.failure_count + 1 END`;

    return this.db
      .insertInto('authLoginCounters')
      .values({
        workspaceId,
        userId,
        method,
        failureCount: 1,
        windowStartedAt: sql`now()`,
        lastFailedAt: sql`now()`,
        lockedUntil: null,
        updatedAt: sql`now()`,
      })
      .onConflict((oc) =>
        oc.columns(['workspaceId', 'userId', 'method']).doUpdateSet({
          failureCount: nextCount,
          windowStartedAt: sql`CASE WHEN ${expiredWindow} THEN now() ELSE auth_login_counters.window_started_at END`,
          lastFailedAt: sql`now()`,
          lockedUntil: sql`
            CASE
              WHEN ${expiredWindow} THEN NULL
              WHEN auth_login_counters.failure_count + 1 >= 10 THEN now() + interval '15 minutes'
              WHEN auth_login_counters.failure_count + 1 >= 8 THEN now() + interval '5 minutes'
              WHEN auth_login_counters.failure_count + 1 >= 5 THEN now() + interval '1 minute'
              ELSE auth_login_counters.locked_until
            END
          `,
          updatedAt: sql`now()`,
        }),
      )
      .returningAll()
      .executeTakeFirstOrThrow();
  }

  async clearForUser(workspaceId: string, userId: string): Promise<void> {
    await this.db
      .deleteFrom('authLoginCounters')
      .where('workspaceId', '=', workspaceId)
      .where('userId', '=', userId)
      .execute();
  }
}
