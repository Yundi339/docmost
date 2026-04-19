import { Injectable } from '@nestjs/common';
import { InjectKysely } from 'nestjs-kysely';
import { KyselyDB } from '@docmost/db/types/kysely.types';
import { InsertableAudit, Audit } from '@docmost/db/types/entity.types';
import { PaginationOptions } from '@docmost/db/pagination/pagination-options';
import { executeWithCursorPagination } from '@docmost/db/pagination/cursor-pagination';
import { ExpressionBuilder, sql } from 'kysely';
import { DB } from '@docmost/db/types/db';
import { jsonObjectFrom } from 'kysely/helpers/postgres';

export interface AuditQueryParams extends PaginationOptions {
  event?: string;
  resourceType?: string;
  actorId?: string;
  spaceId?: string;
  startDate?: string;
  endDate?: string;
}

@Injectable()
export class AuditRepo {
  constructor(@InjectKysely() private readonly db: KyselyDB) {}

  async insertAudit(data: InsertableAudit): Promise<void> {
    await this.db
      .insertInto('audit')
      .values(data)
      .execute();
  }

  async findAuditLogs(workspaceId: string, params: AuditQueryParams) {
    let query = this.db
      .selectFrom('audit')
      .selectAll('audit')
      .select((eb) => this.withActor(eb))
      .where('audit.workspaceId', '=', workspaceId);

    if (params.event) {
      query = query.where('audit.event', '=', params.event);
    }
    if (params.resourceType) {
      query = query.where('audit.resourceType', '=', params.resourceType);
    }
    if (params.actorId) {
      query = query.where('audit.actorId', '=', params.actorId);
    }
    if (params.spaceId) {
      query = query.where('audit.spaceId', '=', params.spaceId);
    }
    if (params.startDate) {
      query = query.where('audit.createdAt', '>=', new Date(params.startDate));
    }
    if (params.endDate) {
      query = query.where('audit.createdAt', '<=', new Date(params.endDate));
    }

    return executeWithCursorPagination(query, {
      perPage: params.limit,
      cursor: params.cursor,
      beforeCursor: params.beforeCursor,
      fields: [{ expression: 'createdAt', direction: 'desc' }, { expression: 'id', direction: 'desc' }],
      parseCursor: (cursor) => ({ createdAt: new Date(cursor.createdAt), id: cursor.id }),
    });
  }

  async deleteOldAuditLogs(workspaceId: string, retentionDays: number): Promise<void> {
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - retentionDays);

    await this.db
      .deleteFrom('audit')
      .where('workspaceId', '=', workspaceId)
      .where('createdAt', '<', cutoff)
      .execute();
  }

  private withActor(eb: ExpressionBuilder<DB, 'audit'>) {
    return jsonObjectFrom(
      eb
        .selectFrom('users')
        .select(['users.id', 'users.name', 'users.avatarUrl'])
        .whereRef('users.id', '=', 'audit.actorId'),
    ).as('actor');
  }
}
