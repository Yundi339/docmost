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

export interface ISystemStatus {
  app: ISystemStatusApp;
  database: ISystemStatusDatabase;
  redis: ISystemStatusRedis;
  timestamp: string;
}
