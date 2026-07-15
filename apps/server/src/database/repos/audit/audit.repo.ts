import { Injectable } from '@nestjs/common';
import { InjectKysely } from 'nestjs-kysely';
import { KyselyDB } from '@docmost/db/types/kysely.types';
import { InsertableAudit, Audit } from '@docmost/db/types/entity.types';
import { PaginationOptions } from '@docmost/db/pagination/pagination-options';
import { executeWithCursorPagination } from '@docmost/db/pagination/cursor-pagination';
import { ExpressionBuilder, sql } from 'kysely';
import { DB } from '@docmost/db/types/db';
import { jsonObjectFrom } from 'kysely/helpers/postgres';

export type AuditResourceDetails = {
  id: string;
  type: string;
  name: string;
  slug?: string;
  slugId?: string;
  path?: string;
  spaceId?: string;
  spaceName?: string;
  spaceSlug?: string;
  deleted?: boolean;
};

type ResourceCache = Map<string, Promise<AuditResourceDetails | null>>;

export interface AuditQueryParams extends PaginationOptions {
  event?: string;
  resourceType?: string;
  resourceTypes?: string[];
  actorId?: string;
  relatedUserId?: string;
  spaceId?: string;
  startDate?: string;
  endDate?: string;
}

@Injectable()
export class AuditRepo {
  constructor(@InjectKysely() private readonly db: KyselyDB) {}

  async insertAudit(data: InsertableAudit): Promise<void> {
    let enrichedData = data;
    try {
      const resource = await this.resolveAuditResource(
        data as unknown as Audit,
        data.workspaceId as string,
        new Map(),
      );
      if (resource) {
        enrichedData = {
          ...data,
          spaceId: data.spaceId ?? resource.spaceId ?? null,
          metadata: {
            ...asRecord(data.metadata),
            resourceSnapshot: resource,
          },
        };
      }
    } catch {
      // Resource enrichment must never prevent the audit event from persisting.
    }

    await this.db.insertInto('audit').values(enrichedData).execute();
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
    if (params.resourceTypes?.length) {
      query = query.where('audit.resourceType', 'in', params.resourceTypes);
    }
    if (params.relatedUserId) {
      query = query.where((eb) =>
        eb.or([
          eb('audit.actorId', '=', params.relatedUserId!),
          sql<boolean>`audit.metadata ->> 'authorizationUserId' = ${params.relatedUserId!}`,
        ]),
      );
    } else if (params.actorId) {
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

    const result = await executeWithCursorPagination(query, {
      perPage: params.limit,
      cursor: params.cursor,
      beforeCursor: params.beforeCursor,
      fields: [
        { expression: 'createdAt', direction: 'desc' },
        { expression: 'id', direction: 'desc' },
      ],
      parseCursor: (cursor) => ({
        createdAt: new Date(cursor.createdAt),
        id: cursor.id,
      }),
    });

    const cache: ResourceCache = new Map();
    return {
      ...result,
      items: await Promise.all(
        result.items.map(async (item) => ({
          ...item,
          resource: await this.resolveAuditResource(
            item as Audit,
            workspaceId,
            cache,
          ),
        })),
      ),
    };
  }

  async deleteOldAuditLogs(
    workspaceId: string,
    retentionDays: number,
  ): Promise<void> {
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - retentionDays);

    await this.db
      .deleteFrom('audit')
      .where('workspaceId', '=', workspaceId)
      .where('createdAt', '<', cutoff)
      .execute();
  }

  async deleteExpiredAuditLogs(): Promise<void> {
    await sql`
      DELETE FROM audit AS a
      USING workspaces AS w
      WHERE a.workspace_id = w.id
        AND a.created_at < NOW() - (
          COALESCE(w.audit_retention_days, 365) * INTERVAL '1 day'
        )
    `.execute(this.db);
  }

  private withActor(eb: ExpressionBuilder<DB, 'audit'>) {
    return jsonObjectFrom(
      eb
        .selectFrom('users')
        .select(['users.id', 'users.name', 'users.email', 'users.avatarUrl'])
        .whereRef('users.id', '=', 'audit.actorId'),
    ).as('actor');
  }

  private async resolveAuditResource(
    entry: Audit,
    workspaceId: string,
    cache: ResourceCache,
  ): Promise<AuditResourceDetails | null> {
    const metadata = asRecord(entry.metadata);
    const snapshot = asResourceDetails(metadata.resourceSnapshot);
    const auditSpaceId = getAuditSpaceId(entry);
    const needsPageSnapshotBackfill =
      snapshot?.type === 'page' &&
      !snapshot.spaceName &&
      !!auditSpaceId;
    if (snapshot && !needsPageSnapshotBackfill) return snapshot;

    if (entry.resourceType === 'mcp_tool' && metadata.success === false) {
      return null;
    }

    const target = asRecord(metadata.target);
    const result = asRecord(metadata.result);
    const toolName =
      typeof metadata.toolName === 'string' ? metadata.toolName : '';

    let pageId = getString(target.pageId);
    const parentPageId = getString(target.parentPageId);
    let commentId = getString(target.commentId);
    let spaceId =
      getString(target.spaceId) ??
      getString(result.spaceId) ??
      auditSpaceId;

    if (entry.resourceType === 'page') pageId ??= entry.resourceId ?? undefined;
    if (entry.resourceType === 'comment')
      commentId ??= entry.resourceId ?? undefined;
    if (
      entry.resourceType === 'space' ||
      entry.resourceType === 'space_member'
    ) {
      spaceId ??= entry.spaceId ?? entry.resourceId ?? undefined;
    }

    if (entry.resourceType === 'mcp_tool') {
      if (toolName.includes('page')) {
        pageId ??=
          getString(result.id) ?? entry.resourceId ?? parentPageId ?? undefined;
      } else if (toolName.includes('comment')) {
        commentId ??= getString(result.id) ?? entry.resourceId ?? undefined;
      } else if (toolName.includes('space')) {
        spaceId ??= getString(result.id) ?? entry.resourceId ?? undefined;
      }
    }

    pageId ??= parentPageId;

    if (commentId && !pageId) {
      const comment = await this.cached(
        cache,
        `comment:${commentId}`,
        async () => {
          const row = await this.db
            .selectFrom('comments')
            .select(['id', 'pageId'])
            .where('id', '=', commentId!)
            .where('workspaceId', '=', workspaceId)
            .executeTakeFirst();
          return row
            ? ({
                id: row.id,
                type: 'comment',
                name: row.id,
                path: row.pageId,
              } as AuditResourceDetails)
            : null;
        },
      );
      pageId = comment?.path;
    }

    if (entry.resourceType === 'share' && entry.resourceId && !pageId) {
      const share = await this.db
        .selectFrom('shares')
        .select(['pageId', 'spaceId'])
        .where('id', '=', entry.resourceId)
        .where('workspaceId', '=', workspaceId)
        .executeTakeFirst();
      pageId = share?.pageId ?? undefined;
      spaceId ??= share?.spaceId;
    }

    if (entry.resourceType === 'attachment' && entry.resourceId && !pageId) {
      const attachment = await this.db
        .selectFrom('attachments')
        .select(['pageId', 'spaceId', 'fileName'])
        .where('id', '=', entry.resourceId)
        .where('workspaceId', '=', workspaceId)
        .executeTakeFirst();
      pageId = attachment?.pageId ?? undefined;
      spaceId ??= attachment?.spaceId ?? undefined;
      if (!pageId && attachment) {
        return {
          id: entry.resourceId,
          type: 'attachment',
          name: attachment.fileName,
          spaceId,
        };
      }
    }

    if (pageId) {
      if (needsPageSnapshotBackfill) {
        const backfilledSnapshot = await this.resolveDeletedPageResource(
          entry,
          pageId,
          spaceId,
          workspaceId,
          cache,
          snapshot,
        );
        if (backfilledSnapshot) return backfilledSnapshot;
      }

      const page = await this.cached(cache, `page:${pageId}`, () =>
        this.resolvePageResource(pageId!, workspaceId),
      );
      if (page) return page;

      if (entry.resourceType === 'page' || snapshot?.type === 'page') {
        const deletedPage = await this.resolveDeletedPageResource(
          entry,
          pageId,
          spaceId,
          workspaceId,
          cache,
          snapshot,
        );
        if (deletedPage) return deletedPage;
      }
    }

    if (spaceId) {
      const space = await this.resolveNamedResource(
        cache,
        'space',
        spaceId,
        workspaceId,
      );
      if (space) return space;
    }

    const resourceId = entry.resourceId;
    if (!resourceId) return null;

    if (entry.resourceType === 'group') {
      return this.resolveNamedResource(cache, 'group', resourceId, workspaceId);
    }
    if (entry.resourceType === 'user') {
      return this.resolveNamedResource(cache, 'user', resourceId, workspaceId);
    }
    if (entry.resourceType === 'api_key') {
      return this.resolveNamedResource(
        cache,
        'api_key',
        resourceId,
        workspaceId,
      );
    }
    if (entry.resourceType === 'workspace_invitation') {
      return this.resolveNamedResource(
        cache,
        'workspace_invitation',
        resourceId,
        workspaceId,
      );
    }

    const fallbackName = getAuditFallbackName(entry);
    return fallbackName
      ? { id: resourceId, type: entry.resourceType, name: fallbackName }
      : null;
  }

  private async resolvePageResource(
    pageId: string,
    workspaceId: string,
  ): Promise<AuditResourceDetails | null> {
    const result = await sql<{
      id: string;
      slugId: string;
      title: string | null;
      spaceId: string;
      spaceName: string | null;
      spaceSlug: string;
      deletedAt: Date | null;
      titles: string[];
    }>`
      WITH RECURSIVE page_path AS (
        SELECT
          p.id AS start_id,
          p.id,
          p.parent_page_id,
          p.title,
          0 AS depth,
          ARRAY[p.id]::uuid[] AS visited
        FROM pages p
        WHERE p.id = ${pageId}
          AND p.workspace_id = ${workspaceId}

        UNION ALL

        SELECT
          pp.start_id,
          parent.id,
          parent.parent_page_id,
          parent.title,
          pp.depth + 1,
          pp.visited || parent.id
        FROM pages parent
        INNER JOIN page_path pp ON pp.parent_page_id = parent.id
        WHERE parent.workspace_id = ${workspaceId}
          AND pp.depth < 100
          AND NOT parent.id = ANY(pp.visited)
      )
      SELECT
        leaf.id,
        leaf.slug_id AS "slugId",
        leaf.title,
        leaf.space_id AS "spaceId",
        space.name AS "spaceName",
        space.slug AS "spaceSlug",
        leaf.deleted_at AS "deletedAt",
        array_agg(COALESCE(page_path.title, 'Untitled') ORDER BY page_path.depth DESC) AS titles
      FROM page_path
      INNER JOIN pages leaf ON leaf.id = page_path.start_id
      INNER JOIN spaces space ON space.id = leaf.space_id
      GROUP BY leaf.id, space.id
    `.execute(this.db);

    const row = result.rows[0];
    if (!row) return null;
    const spaceName = row.spaceName || row.spaceSlug;
    return {
      id: row.id,
      type: 'page',
      name: row.title || 'Untitled',
      slugId: row.slugId,
      path: [spaceName, ...row.titles].join(' / '),
      spaceId: row.spaceId,
      spaceName,
      spaceSlug: row.spaceSlug,
      deleted: !!row.deletedAt,
    };
  }

  private async resolveDeletedPageResource(
    entry: Audit,
    pageId: string,
    spaceId: string | undefined,
    workspaceId: string,
    cache: ResourceCache,
    snapshot: AuditResourceDetails | null,
  ): Promise<AuditResourceDetails | null> {
    const name = snapshot?.name ?? getAuditFallbackName(entry);
    if (!name) return snapshot;

    const space = spaceId
      ? await this.resolveNamedResource(
          cache,
          'space',
          spaceId,
          workspaceId,
        )
      : null;
    const resolvedSpaceName = space?.spaceName ?? snapshot?.spaceName;
    const resolvedSpaceSlug = space?.spaceSlug ?? snapshot?.spaceSlug;

    return {
      ...snapshot,
      id: pageId,
      type: 'page',
      name,
      slugId: snapshot?.slugId ?? getAuditSlugId(entry),
      path: resolvedSpaceName
        ? `${resolvedSpaceName} / ${name}`
        : snapshot?.path,
      spaceId: spaceId ?? snapshot?.spaceId,
      spaceName: resolvedSpaceName,
      spaceSlug: resolvedSpaceSlug,
      deleted: snapshot
        ? (snapshot.deleted ?? entry.event === 'page.deleted')
        : true,
    };
  }

  private async resolveNamedResource(
    cache: ResourceCache,
    type: 'space' | 'group' | 'user' | 'api_key' | 'workspace_invitation',
    id: string,
    workspaceId: string,
  ): Promise<AuditResourceDetails | null> {
    return this.cached(cache, `${type}:${id}`, async () => {
      if (type === 'space') {
        const row = await this.db
          .selectFrom('spaces')
          .select(['id', 'name', 'slug', 'deletedAt'])
          .where('id', '=', id)
          .where('workspaceId', '=', workspaceId)
          .executeTakeFirst();
        return row
          ? {
              id: row.id,
              type,
              name: row.name || row.slug,
              slug: row.slug,
              spaceId: row.id,
              spaceName: row.name || row.slug,
              spaceSlug: row.slug,
              deleted: !!row.deletedAt,
            }
          : null;
      }

      if (type === 'group') {
        const row = await this.db
          .selectFrom('groups')
          .select(['id', 'name', 'deletedAt'])
          .where('id', '=', id)
          .where('workspaceId', '=', workspaceId)
          .executeTakeFirst();
        return row
          ? { id: row.id, type, name: row.name, deleted: !!row.deletedAt }
          : null;
      }

      if (type === 'user') {
        const row = await this.db
          .selectFrom('users')
          .select(['id', 'name', 'email', 'deletedAt'])
          .where('id', '=', id)
          .where('workspaceId', '=', workspaceId)
          .executeTakeFirst();
        return row
          ? {
              id: row.id,
              type,
              name: row.name || row.email,
              path: row.email,
              deleted: !!row.deletedAt,
            }
          : null;
      }

      if (type === 'api_key') {
        const row = await this.db
          .selectFrom('apiKeys')
          .select(['id', 'name', 'deletedAt'])
          .where('id', '=', id)
          .where('workspaceId', '=', workspaceId)
          .executeTakeFirst();
        return row
          ? {
              id: row.id,
              type,
              name: row.name || 'API key',
              deleted: !!row.deletedAt,
            }
          : null;
      }

      const row = await this.db
        .selectFrom('workspaceInvitations')
        .select(['id', 'email'])
        .where('id', '=', id)
        .where('workspaceId', '=', workspaceId)
        .executeTakeFirst();
      return row ? { id: row.id, type, name: row.email || 'Invitation' } : null;
    });
  }

  private cached(
    cache: ResourceCache,
    key: string,
    loader: () => Promise<AuditResourceDetails | null>,
  ) {
    const existing = cache.get(key);
    if (existing) return existing;
    const value = loader();
    cache.set(key, value);
    return value;
  }
}

function asRecord(value: unknown): Record<string, any> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, any>)
    : {};
}

function getString(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

function asResourceDetails(value: unknown): AuditResourceDetails | null {
  const resource = asRecord(value);
  return getString(resource.id) &&
    getString(resource.type) &&
    getString(resource.name)
    ? (resource as AuditResourceDetails)
    : null;
}

function getAuditFallbackName(entry: Audit): string | undefined {
  const changes = asRecord(entry.changes);
  const before = asRecord(changes.before);
  const after = asRecord(changes.after);
  const metadata = asRecord(entry.metadata);
  return [
    after.title,
    before.title,
    metadata.title,
    after.name,
    before.name,
    metadata.name,
  ]
    .map(getString)
    .find(Boolean);
}

function getAuditSpaceId(entry: Audit): string | undefined {
  const changes = asRecord(entry.changes);
  const before = asRecord(changes.before);
  const after = asRecord(changes.after);
  return (
    getString(entry.spaceId) ??
    getString(after.spaceId) ??
    getString(before.spaceId)
  );
}

function getAuditSlugId(entry: Audit): string | undefined {
  const changes = asRecord(entry.changes);
  const before = asRecord(changes.before);
  const after = asRecord(changes.after);
  return getString(after.slugId) ?? getString(before.slugId);
}
