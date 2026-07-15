import { Injectable } from '@nestjs/common';
import { InjectKysely } from 'nestjs-kysely';
import { sql } from 'kysely';
import { KyselyDB } from '@docmost/db/types/kysely.types';
import { AuditEvent } from '../../common/events/audit-events';
import {
  SystemDiagnosticCodeType,
  SystemDiagnosticDataSourceIssue,
  SystemDiagnosticDataSourceList,
  SystemDiagnosticDataSourceState,
} from './system-diagnostics.types';

export const LARGE_BOARD_RECORD_THRESHOLD = 500;

export interface SystemDiagnosticSignals {
  externalDataSourceCount: number;
  largeBoardCount: number;
  maxRecordCount: number;
  orphanDataSourceCount: number;
  invalidRelationCount: number;
  realtimeFailureCount: number;
}

export interface SystemDiagnosticAuditRow {
  id: string;
  event: string;
  metadata: unknown;
  createdAt: Date;
}

interface SystemDiagnosticDataSourceRow {
  id: string;
  title: string;
  provider: string;
  state: SystemDiagnosticDataSourceState;
  issue: SystemDiagnosticDataSourceIssue | null;
  recordCount: number | string;
  createdAt: Date;
  hostPageId: string | null;
  hostPageTitle: string | null;
  hostPageSlugId: string | null;
  hostPageDeletedAt: Date | null;
  spaceId: string | null;
  spaceName: string | null;
  spaceSlug: string | null;
}

const TRANSITION_EVENTS = [
  AuditEvent.SYSTEM_DIAGNOSTIC_DETECTED,
  AuditEvent.SYSTEM_DIAGNOSTIC_RESOLVED,
];

const HISTORY_EVENTS = [
  ...TRANSITION_EVENTS,
  AuditEvent.SYSTEM_DIAGNOSTIC_OCCURRED,
];

@Injectable()
export class SystemDiagnosticsRepo {
  constructor(@InjectKysely() private readonly db: KyselyDB) {}

  async listWorkspaceIds(): Promise<string[]> {
    const rows = await this.db
      .selectFrom('workspaces')
      .select('id')
      .where('deletedAt', 'is', null)
      .execute();
    return rows.map((row) => row.id);
  }

  async getSignals(workspaceId: string): Promise<SystemDiagnosticSignals> {
    const result = await sql<{
      externalDataSourceCount: number | string;
      largeBoardCount: number | string;
      maxRecordCount: number | string;
      orphanDataSourceCount: number | string;
      invalidRelationCount: number | string;
      realtimeFailureCount: number | string;
    }>`
      WITH active_databases AS (
        SELECT
          db.*,
          host.id AS host_id,
          host.workspace_id AS host_workspace_id,
          host.space_id AS host_space_id,
          host.content AS host_content,
          COALESCE(records.record_count, 0) AS record_count
        FROM database_blocks db
        LEFT JOIN pages host ON host.id = db.page_id
        LEFT JOIN LATERAL (
          SELECT COUNT(*)::int AS record_count
          FROM database_records record
          WHERE record.database_id = db.id
            AND record.deleted_at IS NULL
        ) records ON TRUE
        WHERE db.workspace_id = ${workspaceId}
          AND db.deleted_at IS NULL
      ),
      database_summary AS (
        SELECT
          COUNT(*) FILTER (
            WHERE apitable_datasheet_id IS NOT NULL
              AND apitable_datasheet_id NOT LIKE 'native\\_%' ESCAPE '\\'
              AND apitable_datasheet_id NOT LIKE 'local\\_%' ESCAPE '\\'
              AND COALESCE(metadata ->> 'provider', '') NOT IN (
                'docmost-native',
                'docmost-local'
              )
          )::int AS external_data_source_count,
          COUNT(*) FILTER (
            WHERE record_count >= ${LARGE_BOARD_RECORD_THRESHOLD}
          )::int AS large_board_count,
          COALESCE(MAX(record_count), 0)::int AS max_record_count,
          -- A trashed host remains restorable while its database block is intact.
          COUNT(*) FILTER (
            WHERE created_at < NOW() - INTERVAL '1 hour'
              AND (
                host_id IS NULL
                OR host_workspace_id <> workspace_id
                OR host_space_id <> space_id
                OR NOT jsonb_path_exists(
                  COALESCE(host_content, '{}'::jsonb),
                  '$.** ? (@.type == "databaseBlock" && @.attrs.databaseId == $databaseId && @.attrs.blockId == $blockId)',
                  jsonb_build_object(
                    'databaseId', to_jsonb(id),
                    'blockId', to_jsonb(block_id)
                  )
                )
              )
          )::int AS orphan_data_source_count
        FROM active_databases
      ),
      invalid_relations AS (
        -- Trashed work-item pages intentionally retain their active record so a
        -- page restore can put the item back on the board.
        SELECT COUNT(*)::int AS invalid_relation_count
        FROM database_records record
        LEFT JOIN database_blocks db ON db.id = record.database_id
        LEFT JOIN pages work_item ON work_item.id = record.page_id
        WHERE record.workspace_id = ${workspaceId}
          AND record.deleted_at IS NULL
          AND (
            db.id IS NULL
            OR db.deleted_at IS NOT NULL
            OR work_item.id IS NULL
            OR record.page_id = db.page_id
            OR record.workspace_id <> db.workspace_id
            OR record.space_id <> db.space_id
            OR work_item.workspace_id <> record.workspace_id
            OR work_item.space_id <> record.space_id
            OR work_item.parent_page_id <> db.page_id
          )
      ),
      realtime_failures AS (
        SELECT COUNT(*)::int AS realtime_failure_count
        FROM audit
        WHERE workspace_id = ${workspaceId}
          AND event = ${AuditEvent.SYSTEM_DIAGNOSTIC_OCCURRED}
          AND metadata ->> 'diagnosticCode' = 'realtime_invalidation_failure'
          AND created_at >= NOW() - INTERVAL '24 hours'
      )
      SELECT
        database_summary.external_data_source_count AS "externalDataSourceCount",
        database_summary.large_board_count AS "largeBoardCount",
        database_summary.max_record_count AS "maxRecordCount",
        database_summary.orphan_data_source_count AS "orphanDataSourceCount",
        invalid_relations.invalid_relation_count AS "invalidRelationCount",
        realtime_failures.realtime_failure_count AS "realtimeFailureCount"
      FROM database_summary, invalid_relations, realtime_failures
    `.execute(this.db);

    const row = result.rows[0];
    return {
      externalDataSourceCount: toNumber(row?.externalDataSourceCount),
      largeBoardCount: toNumber(row?.largeBoardCount),
      maxRecordCount: toNumber(row?.maxRecordCount),
      orphanDataSourceCount: toNumber(row?.orphanDataSourceCount),
      invalidRelationCount: toNumber(row?.invalidRelationCount),
      realtimeFailureCount: toNumber(row?.realtimeFailureCount),
    };
  }

  async listDataSources(
    workspaceId: string,
    options: {
      filter: 'issues' | 'all';
      limit: number;
      cursor?: string;
    },
  ): Promise<SystemDiagnosticDataSourceList> {
    const result = await sql<SystemDiagnosticDataSourceRow>`
      WITH active_sources AS (
        SELECT
          db.id,
          db.block_id,
          db.title,
          db.workspace_id,
          db.space_id AS database_space_id,
          db.created_at,
          COALESCE(NULLIF(db.metadata ->> 'provider', ''), 'docmost-native') AS provider,
          host.id AS host_page_id,
          host.title AS host_page_title,
          host.slug_id AS host_page_slug_id,
          host.deleted_at AS host_page_deleted_at,
          host.workspace_id AS host_workspace_id,
          host.space_id AS host_space_id,
          host.content AS host_content,
          space.id AS space_id,
          space.name AS space_name,
          space.slug AS space_slug,
          COALESCE(records.record_count, 0)::int AS record_count,
          CASE
            WHEN host.id IS NULL THEN false
            ELSE jsonb_path_exists(
              COALESCE(host.content, '{}'::jsonb),
              '$.** ? (@.type == "databaseBlock" && @.attrs.databaseId == $databaseId && @.attrs.blockId == $blockId)',
              jsonb_build_object(
                'databaseId', to_jsonb(db.id),
                'blockId', to_jsonb(db.block_id)
              )
            )
          END AS block_present
        FROM database_blocks db
        LEFT JOIN pages host ON host.id = db.page_id
        LEFT JOIN spaces space
          ON space.id = host.space_id
          AND space.workspace_id = db.workspace_id
        LEFT JOIN LATERAL (
          SELECT COUNT(*)::int AS record_count
          FROM database_records record
          WHERE record.database_id = db.id
            AND record.deleted_at IS NULL
        ) records ON TRUE
        WHERE db.workspace_id = ${workspaceId}
          AND db.deleted_at IS NULL
      ), classified AS (
        SELECT *,
          CASE
            WHEN host_page_id IS NULL THEN 'missing_host_page'
            WHEN host_workspace_id IS DISTINCT FROM workspace_id THEN 'workspace_mismatch'
            WHEN host_space_id IS DISTINCT FROM database_space_id THEN 'space_mismatch'
            WHEN NOT block_present THEN 'database_block_missing'
            ELSE NULL
          END AS issue
        FROM active_sources
      ), states AS (
        SELECT *,
          CASE
            WHEN issue IS NOT NULL
              AND created_at < NOW() - INTERVAL '1 hour' THEN 'orphaned'
            WHEN issue IS NOT NULL THEN 'pending'
            WHEN host_page_deleted_at IS NOT NULL THEN 'trashed'
            ELSE 'healthy'
          END AS state
        FROM classified
      )
      SELECT
        id,
        title,
        provider,
        state,
        issue,
        record_count AS "recordCount",
        created_at AS "createdAt",
        CASE WHEN host_workspace_id = workspace_id THEN host_page_id END AS "hostPageId",
        CASE WHEN host_workspace_id = workspace_id THEN host_page_title END AS "hostPageTitle",
        CASE WHEN host_workspace_id = workspace_id THEN host_page_slug_id END AS "hostPageSlugId",
        CASE WHEN host_workspace_id = workspace_id THEN host_page_deleted_at END AS "hostPageDeletedAt",
        space_id AS "spaceId",
        space_name AS "spaceName",
        space_slug AS "spaceSlug"
      FROM states
      WHERE (${options.filter === 'issues'} = false OR state = 'orphaned')
        AND (${options.cursor ?? null}::uuid IS NULL OR id < ${options.cursor ?? null}::uuid)
      ORDER BY id DESC
      LIMIT ${options.limit + 1}
    `.execute(this.db);

    const hasNextPage = result.rows.length > options.limit;
    const rows = hasNextPage
      ? result.rows.slice(0, options.limit)
      : result.rows;
    return {
      items: rows.map((row) => ({
        id: row.id,
        title: row.title,
        provider: row.provider,
        state: row.state,
        issue: row.issue,
        recordCount: toNumber(row.recordCount),
        createdAt: row.createdAt.toISOString(),
        hostPage: row.hostPageId
          ? {
              id: row.hostPageId,
              title: row.hostPageTitle,
              slugId: row.hostPageSlugId!,
              deletedAt: row.hostPageDeletedAt?.toISOString() ?? null,
            }
          : null,
        space:
          row.spaceId && row.spaceSlug
            ? {
                id: row.spaceId,
                name: row.spaceName,
                slug: row.spaceSlug,
              }
            : null,
      })),
      nextCursor: hasNextPage ? (rows[rows.length - 1]?.id ?? null) : null,
    };
  }

  async findLatestTransition(
    workspaceId: string,
    code: SystemDiagnosticCodeType,
  ): Promise<SystemDiagnosticAuditRow | undefined> {
    return this.db
      .selectFrom('audit')
      .select(['id', 'event', 'metadata', 'createdAt'])
      .where('workspaceId', '=', workspaceId)
      .where('event', 'in', TRANSITION_EVENTS)
      .where(sql<boolean>`metadata ->> 'diagnosticCode' = ${code}`)
      .orderBy('createdAt', 'desc')
      .orderBy('id', 'desc')
      .executeTakeFirst();
  }

  async listHistory(
    workspaceId: string,
    limit = 50,
  ): Promise<SystemDiagnosticAuditRow[]> {
    return this.db
      .selectFrom('audit')
      .select(['id', 'event', 'metadata', 'createdAt'])
      .where('workspaceId', '=', workspaceId)
      .where('event', 'in', HISTORY_EVENTS)
      .orderBy('createdAt', 'desc')
      .orderBy('id', 'desc')
      .limit(limit)
      .execute();
  }
}

function toNumber(value: number | string | null | undefined): number {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}
