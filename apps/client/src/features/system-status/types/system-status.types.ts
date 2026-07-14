export interface ISystemStatusApp {
  version: string;
  nodeVersion: string;
  uptimeSeconds: number;
  cloud: boolean;
}

export interface ISystemStatusDatabase {
  status: "up" | "down";
  latencyMs: number | null;
  sizeBytes: number | null;
  sizePretty: string | null;
  version: string | null;
  activeConnections: number | null;
  maxConnections: number | null;
  error?: string;
}

export interface ISystemStatusRedis {
  status: "up" | "down";
  latencyMs: number | null;
  version: string | null;
  usedMemoryBytes: number | null;
  usedMemoryPretty: string | null;
  connectedClients: number | null;
  error?: string;
}

export type SystemDiagnosticCode =
  | "external_apitable_active"
  | "large_board"
  | "orphan_database_source"
  | "invalid_database_relation"
  | "realtime_invalidation_failure";

export interface ISystemDiagnosticCheck {
  code: SystemDiagnosticCode;
  status: "ok" | "attention";
  severity: "info" | "warning" | "error";
  count: number;
  value?: number;
  threshold?: number;
  windowHours?: number;
}

export interface ISystemDiagnosticHistoryEntry {
  id: string;
  code: SystemDiagnosticCode;
  state: "detected" | "resolved" | "occurred";
  severity: "info" | "warning" | "error";
  count: number;
  value?: number;
  threshold?: number;
  createdAt: string;
}

export interface ISystemDiagnostics {
  status: "up" | "down";
  checkedAt: string;
  checks: ISystemDiagnosticCheck[];
  history: ISystemDiagnosticHistoryEntry[];
  error?: string;
}

export interface ISystemStatus {
  app: ISystemStatusApp;
  database: ISystemStatusDatabase;
  redis: ISystemStatusRedis;
  diagnostics: ISystemDiagnostics;
  timestamp: string;
}
