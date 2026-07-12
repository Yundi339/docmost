import { Injectable } from '@nestjs/common';
import { InjectKysely } from 'nestjs-kysely';
import { sql } from 'kysely';
import { KyselyDB } from '@docmost/db/types/kysely.types';
import { SpaceGraphDto } from './dto/space-graph.dto';

export type SpaceGraphNode = {
  id: string;
  slugId: string;
  title: string | null;
  icon: string | null;
  parentPageId: string | null;
  updatedAt: Date;
  distance: number | null;
};

export type SpaceGraphEdge = {
  id: string;
  sourcePageId: string;
  targetPageId: string;
};

@Injectable()
export class SpaceGraphRepo {
  constructor(@InjectKysely() private readonly db: KyselyDB) {}

  async findVisibleNodes(
    dto: Required<Pick<SpaceGraphDto, 'spaceId' | 'limit' | 'depth'>> &
      Pick<SpaceGraphDto, 'centerPageId' | 'query'>,
    userId: string,
    workspaceId: string,
  ): Promise<{ nodes: SpaceGraphNode[]; truncated: boolean }> {
    const centerPageId = dto.centerPageId ?? null;
    const queryPattern = dto.query ? `%${escapeLikePattern(dto.query)}%` : null;

    const result = await sql<SpaceGraphNode>`
      WITH RECURSIVE page_tree AS (
        SELECT
          p.id,
          p.slug_id,
          p.title,
          p.icon,
          p.parent_page_id,
          p.updated_at,
          ARRAY[p.id] AS path,
          (
            pa.id IS NULL OR (
              pa.workspace_id = ${workspaceId}::uuid
              AND pa.space_id = ${dto.spaceId}::uuid
              AND EXISTS (
                SELECT 1
                FROM page_permissions pp
                WHERE pp.page_access_id = pa.id
                  AND (
                    pp.user_id = ${userId}::uuid
                    OR pp.group_id IN (
                      SELECT gu.group_id
                      FROM group_users gu
                      WHERE gu.user_id = ${userId}::uuid
                    )
                  )
              )
            )
          ) AS can_access
        FROM pages p
        LEFT JOIN page_access pa ON pa.page_id = p.id
        WHERE p.workspace_id = ${workspaceId}::uuid
          AND p.space_id = ${dto.spaceId}::uuid
          AND p.deleted_at IS NULL
          AND NOT EXISTS (
            SELECT 1
            FROM pages parent
            WHERE parent.id = p.parent_page_id
              AND parent.workspace_id = ${workspaceId}::uuid
              AND parent.space_id = ${dto.spaceId}::uuid
          )

        UNION ALL

        SELECT
          p.id,
          p.slug_id,
          p.title,
          p.icon,
          p.parent_page_id,
          p.updated_at,
          pt.path || p.id,
          pt.can_access AND (
            pa.id IS NULL OR (
              pa.workspace_id = ${workspaceId}::uuid
              AND pa.space_id = ${dto.spaceId}::uuid
              AND EXISTS (
                SELECT 1
                FROM page_permissions pp
                WHERE pp.page_access_id = pa.id
                  AND (
                    pp.user_id = ${userId}::uuid
                    OR pp.group_id IN (
                      SELECT gu.group_id
                      FROM group_users gu
                      WHERE gu.user_id = ${userId}::uuid
                    )
                  )
              )
            )
          ) AS can_access
        FROM pages p
        JOIN page_tree pt ON pt.id = p.parent_page_id
        LEFT JOIN page_access pa ON pa.page_id = p.id
        WHERE p.workspace_id = ${workspaceId}::uuid
          AND p.space_id = ${dto.spaceId}::uuid
          AND p.deleted_at IS NULL
          AND NOT p.id = ANY(pt.path)
      ),
      reachable AS (
        SELECT
          p.id AS page_id,
          0 AS depth,
          ARRAY[p.id] AS path
        FROM pages p
        WHERE p.id = ${centerPageId}::uuid
          AND p.workspace_id = ${workspaceId}::uuid
          AND p.space_id = ${dto.spaceId}::uuid
          AND p.deleted_at IS NULL

        UNION ALL

        SELECT
          CASE
            WHEN b.source_page_id = r.page_id THEN b.target_page_id
            ELSE b.source_page_id
          END AS page_id,
          r.depth + 1,
          r.path || CASE
            WHEN b.source_page_id = r.page_id THEN b.target_page_id
            ELSE b.source_page_id
          END
        FROM reachable r
        JOIN backlinks b
          ON b.workspace_id = ${workspaceId}::uuid
          AND (
            b.source_page_id = r.page_id
            OR b.target_page_id = r.page_id
          )
        WHERE r.depth < ${dto.depth}
          AND NOT (
            CASE
              WHEN b.source_page_id = r.page_id THEN b.target_page_id
              ELSE b.source_page_id
            END
          ) = ANY(r.path)
      ),
      visible_pages AS (
        SELECT
          pt.id,
          pt.slug_id,
          pt.title,
          pt.icon,
          pt.parent_page_id,
          pt.updated_at
        FROM page_tree pt
        WHERE pt.can_access
      )
      SELECT
        vp.id,
        vp.slug_id AS "slugId",
        vp.title,
        vp.icon,
        vp.parent_page_id AS "parentPageId",
        vp.updated_at AS "updatedAt",
        CASE
          WHEN ${centerPageId}::uuid IS NULL THEN NULL
          ELSE (
            SELECT MIN(r.depth)
            FROM reachable r
            WHERE r.page_id = vp.id
          )
        END AS distance
      FROM visible_pages vp
      WHERE (
        ${centerPageId}::uuid IS NULL
        OR EXISTS (
          SELECT 1 FROM reachable r WHERE r.page_id = vp.id
        )
      )
        AND (
          ${queryPattern}::text IS NULL
          OR COALESCE(vp.title, '') ILIKE ${queryPattern} ESCAPE '\'
        )
      ORDER BY
        CASE WHEN vp.id = ${centerPageId}::uuid THEN 0 ELSE 1 END,
        vp.updated_at DESC,
        vp.id ASC
      LIMIT ${dto.limit + 1}
    `.execute(this.db);

    const nodes = result.rows;
    const truncated = nodes.length > dto.limit;
    if (truncated) nodes.pop();
    return { nodes, truncated };
  }

  async findEdges(
    pageIds: string[],
    workspaceId: string,
  ): Promise<SpaceGraphEdge[]> {
    if (pageIds.length < 2) return [];

    return this.db
      .selectFrom('backlinks')
      .select(['id', 'sourcePageId', 'targetPageId'])
      .where('workspaceId', '=', workspaceId)
      .where('sourcePageId', 'in', pageIds)
      .where('targetPageId', 'in', pageIds)
      .orderBy('id', 'asc')
      .execute();
  }
}

function escapeLikePattern(value: string): string {
  return value.replace(/[\\%_]/g, '\\$&');
}
