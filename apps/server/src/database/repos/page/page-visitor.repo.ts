import { Injectable } from '@nestjs/common';
import { InjectKysely } from 'nestjs-kysely';
import { KyselyDB } from '../../types/kysely.types';
import {
  InsertablePageVisitor,
  PageVisitor,
} from '@docmost/db/types/entity.types';
import { PaginationOptions } from '@docmost/db/pagination/pagination-options';
import { executeWithCursorPagination } from '@docmost/db/pagination/cursor-pagination';
import { jsonObjectFrom } from 'kysely/helpers/postgres';
import { ExpressionBuilder, sql } from 'kysely';
import { DB } from '@docmost/db/types/db';

@Injectable()
export class PageVisitorRepo {
  constructor(@InjectKysely() private readonly db: KyselyDB) {}

  /**
   * UPSERT a visit. New rows start at visit_count=1. On conflict (same user
   * revisiting the same page), increments visit_count and bumps last_visited_at
   * — but only when the previous visit is older than `dedupWindowSeconds` to
   * dampen rapid refresh / re-render storms.
   */
  async recordVisit(
    visitor: InsertablePageVisitor,
    dedupWindowSeconds = 60,
  ): Promise<void> {
    await this.db
      .insertInto('pageVisitors')
      .values({
        pageId: visitor.pageId,
        userId: visitor.userId,
        workspaceId: visitor.workspaceId,
      })
      .onConflict((oc) =>
        oc.columns(['pageId', 'userId']).doUpdateSet({
          lastVisitedAt: sql`now()`,
          visitCount: sql`CASE
              WHEN page_visitors.last_visited_at < now() - (${dedupWindowSeconds}::int * interval '1 second')
              THEN page_visitors.visit_count + 1
              ELSE page_visitors.visit_count
            END`,
        }),
      )
      .execute();
  }

  async listVisitorsByPageId(
    pageId: string,
    pagination: PaginationOptions,
  ): Promise<{ items: any[]; meta: { nextCursor?: string } }> {
    const query = this.db
      .selectFrom('pageVisitors')
      .select([
        'pageVisitors.id',
        'pageVisitors.pageId',
        'pageVisitors.userId',
        'pageVisitors.firstVisitedAt',
        'pageVisitors.lastVisitedAt',
        'pageVisitors.visitCount',
      ])
      .select((eb) => this.withUser(eb))
      .where('pageVisitors.pageId', '=', pageId);

    return executeWithCursorPagination(query, {
      perPage: pagination.limit,
      cursor: pagination.cursor,
      fields: [
        { expression: 'lastVisitedAt', direction: 'desc' },
        { expression: 'id', direction: 'desc' },
      ],
      parseCursor: (cursor) => ({
        lastVisitedAt: new Date(cursor.lastVisitedAt),
        id: cursor.id,
      }),
    }) as Promise<{ items: any[]; meta: { nextCursor?: string } }>;
  }

  // LEFT JOIN-style projection: returns NULL for users that have been deleted
  // so the visit row is preserved while the UI can render "Deleted user".
  private withUser(eb: ExpressionBuilder<DB, 'pageVisitors'>) {
    return jsonObjectFrom(
      eb
        .selectFrom('users')
        .select([
          'users.id',
          'users.name',
          'users.email',
          'users.avatarUrl',
          'users.deactivatedAt',
        ])
        .whereRef('users.id', '=', 'pageVisitors.userId'),
    ).as('user');
  }
}
