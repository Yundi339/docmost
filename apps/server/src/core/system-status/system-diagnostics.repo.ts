import { Injectable } from '@nestjs/common';
import { InjectKysely } from 'nestjs-kysely';
import { sql } from 'kysely';
import { KyselyDB } from '@docmost/db/types/kysely.types';
import { AuditEvent } from '../../common/events/audit-events';
import { SystemDiagnosticCodeType } from './system-diagnostics.types';

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
          host.deleted_at AS host_deleted_at,
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
          COUNT(*) FILTER (
            WHERE created_at < NOW() - INTERVAL '1 hour'
              AND (
                host_id IS NULL
                OR host_deleted_at IS NOT NULL
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
            OR work_item.deleted_at IS NOT NULL
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
