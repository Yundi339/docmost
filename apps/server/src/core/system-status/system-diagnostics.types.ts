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
