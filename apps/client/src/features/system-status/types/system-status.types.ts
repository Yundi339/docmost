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

export interface IMcpSessionStatus {
  limits: {
    global: number;
    perCredential: number;
    idleTimeoutSeconds: number;
  };
  summary: {
    globalSessions: number;
    workspaceSessions: number;
    busySessions: number;
    idleSessions: number;
    users: number;
    credentials: number;
  };
  users: Array<{
    userId: string;
    name: string | null;
    email: string;
    sessions: number;
    busySessions: number;
    idleSessions: number;
    credentials: number;
    lastActivityAt: string;
  }>;
  sessions: Array<{
    sessionId: string;
    userId: string;
    userName: string | null;
    userEmail: string;
    authType: "api_key" | "oauth";
    credentialId: string;
    mode: "off" | "read-only" | "read-write";
    scopes: string[];
    spaceAccessMode: string;
    effectiveSpaceCount: number;
    status: "busy" | "idle";
    activeOperations: number;
    idleSeconds: number;
    createdAt: string;
    lastActivityAt: string;
    expiresAt: string | null;
    userAgent: string | null;
  }>;
}

export type ReleaseMcpSessionsInput =
  | { sessionId: string; idleOnly?: never }
  | { sessionId?: never; idleOnly: true };

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

export type SystemDiagnosticDataSourceState =
  | "healthy"
  | "pending"
  | "orphaned"
  | "trashed";

export type SystemDiagnosticDataSourceIssue =
  | "missing_host_page"
  | "workspace_mismatch"
  | "space_mismatch"
  | "database_block_missing";

export interface ISystemDiagnosticDataSource {
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

export interface ISystemDiagnosticDataSourceList {
  items: ISystemDiagnosticDataSource[];
  nextCursor: string | null;
}

export interface ISystemStatus {
  app: ISystemStatusApp;
  database: ISystemStatusDatabase;
  redis: ISystemStatusRedis;
  diagnostics: ISystemDiagnostics;
  timestamp: string;
}
