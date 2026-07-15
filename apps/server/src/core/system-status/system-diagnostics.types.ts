export const SystemDiagnosticCode = {
  EXTERNAL_APITABLE_ACTIVE: 'external_apitable_active',
  LARGE_BOARD: 'large_board',
  ORPHAN_DATABASE_SOURCE: 'orphan_database_source',
  INVALID_DATABASE_RELATION: 'invalid_database_relation',
  REALTIME_INVALIDATION_FAILURE: 'realtime_invalidation_failure',
} as const;

export type SystemDiagnosticCodeType =
  (typeof SystemDiagnosticCode)[keyof typeof SystemDiagnosticCode];

export type SystemDiagnosticSeverity = 'info' | 'warning' | 'error';

export interface SystemDiagnosticCheck {
  code: SystemDiagnosticCodeType;
  status: 'ok' | 'attention';
  severity: SystemDiagnosticSeverity;
  count: number;
  value?: number;
  threshold?: number;
  windowHours?: number;
}

export interface SystemDiagnosticHistoryEntry {
  id: string;
  code: SystemDiagnosticCodeType;
  state: 'detected' | 'resolved' | 'occurred';
  severity: SystemDiagnosticSeverity;
  count: number;
  value?: number;
  threshold?: number;
  createdAt: string;
}

export interface SystemDiagnosticsResponse {
  status: 'up' | 'down';
  checkedAt: string;
  checks: SystemDiagnosticCheck[];
  history: SystemDiagnosticHistoryEntry[];
  error?: string;
}

export type SystemDiagnosticDataSourceState =
  | 'healthy'
  | 'pending'
  | 'orphaned'
  | 'trashed';

export type SystemDiagnosticDataSourceIssue =
  | 'missing_host_page'
  | 'workspace_mismatch'
  | 'space_mismatch'
  | 'database_block_missing';

export interface SystemDiagnosticDataSource {
  id: string;
  title: string | null;
  provider: string;
  state: SystemDiagnosticDataSourceState;
  issue: SystemDiagnosticDataSourceIssue | null;
  recordCount: number | null;
  createdAt: string;
  hostPage: {
    id: string;
    title: string | null;
    slugId: string;
    deletedAt: string | null;
  } | null;
  space: {
    id: string;
    name: string | null;
    slug: string;
  } | null;
}

export interface SystemDiagnosticDataSourceList {
  items: SystemDiagnosticDataSource[];
  nextCursor: string | null;
}
