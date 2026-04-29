import { Injectable } from '@nestjs/common';
import { InjectKysely } from 'nestjs-kysely';
import { sql } from 'kysely';
import { Redis } from 'ioredis';
import { KyselyDB } from '@docmost/db/types/kysely.types';
import { EnvironmentService } from '../../integrations/environment/environment.service';

export interface SystemStatusResponse {
  app: {
    version: string;
    nodeVersion: string;
    uptimeSeconds: number;
    cloud: boolean;
  };
  database: {
    status: 'up' | 'down';
    latencyMs: number | null;
    sizeBytes: number | null;
    sizePretty: string | null;
    version: string | null;
    activeConnections: number | null;
    maxConnections: number | null;
    error?: string;
  };
  redis: {
    status: 'up' | 'down';
    latencyMs: number | null;
    version: string | null;
    usedMemoryBytes: number | null;
    usedMemoryPretty: string | null;
    connectedClients: number | null;
    error?: string;
  };
  timestamp: string;
}

@Injectable()
export class SystemStatusService {
  constructor(
    @InjectKysely() private readonly db: KyselyDB,
    private readonly environmentService: EnvironmentService,
  ) {}

  async getStatus(): Promise<SystemStatusResponse> {
    const [database, redis] = await Promise.all([
      this.getDatabaseStatus(),
      this.getRedisStatus(),
    ]);

    return {
      app: {
        version: process.env.APP_VERSION || 'dev',
        nodeVersion: process.version,
        uptimeSeconds: Math.floor(process.uptime()),
        cloud: this.environmentService.isCloud(),
      },
      database,
      redis,
      timestamp: new Date().toISOString(),
    };
  }

  private async getDatabaseStatus(): Promise<SystemStatusResponse['database']> {
    const start = Date.now();
    try {
      // Liveness ping
      await sql`SELECT 1`.execute(this.db);
      const latencyMs = Date.now() - start;

      // Stats — best effort. Wrap each in a try/catch so a perms issue
      // doesn't fail the whole response.
      // NOTE: we use pg_stat_database.numbackends instead of counting
      // pg_stat_activity rows because non-superuser roles can only see their
      // OWN activity rows (would always return 1). pg_stat_database is
      // readable by every role on managed services (RDS, Cloud SQL, Supabase,
      // etc.) and reports the real backend count for the current database.
      const [sizeRow, versionRow, connStats, maxConnRow] = await Promise.all([
        sql<{
          bytes: string;
          pretty: string;
        }>`SELECT pg_database_size(current_database())::text AS bytes,
                pg_size_pretty(pg_database_size(current_database())) AS pretty`
          .execute(this.db)
          .then((r) => r.rows[0])
          .catch(() => null),
        sql<{
          version: string;
        }>`SHOW server_version`
          .execute(this.db)
          .then((r) => r.rows[0])
          .catch(() => null),
        sql<{
          count: string;
        }>`SELECT numbackends::text AS count FROM pg_stat_database WHERE datname = current_database()`
          .execute(this.db)
          .then((r) => r.rows[0])
          .catch(() => null),
        sql<{
          max: string;
        }>`SELECT setting AS max FROM pg_settings WHERE name = 'max_connections'`
          .execute(this.db)
          .then((r) => r.rows[0])
          .catch(() => null),
      ]);

      return {
        status: 'up',
        latencyMs,
        sizeBytes: sizeRow ? Number(sizeRow.bytes) : null,
        sizePretty: sizeRow?.pretty ?? null,
        version: versionRow?.version ?? null,
        activeConnections: connStats ? Number(connStats.count) : null,
        maxConnections: maxConnRow ? Number(maxConnRow.max) : null,
      };
    } catch (e: any) {
      return {
        status: 'down',
        latencyMs: null,
        sizeBytes: null,
        sizePretty: null,
        version: null,
        activeConnections: null,
        maxConnections: null,
        error: e?.message ?? 'unknown error',
      };
    }
  }

  private async getRedisStatus(): Promise<SystemStatusResponse['redis']> {
    const start = Date.now();
    let client: Redis | null = null;
    try {
      client = new Redis(this.environmentService.getRedisUrl(), {
        maxRetriesPerRequest: 2,
        connectTimeout: 3000,
        lazyConnect: false,
      });

      await client.ping();
      const latencyMs = Date.now() - start;
      const info = await client.info();
      const parsed = parseRedisInfo(info);

      const usedBytes = parsed['used_memory']
        ? Number(parsed['used_memory'])
        : null;

      return {
        status: 'up',
        latencyMs,
        version: parsed['redis_version'] ?? null,
        usedMemoryBytes: usedBytes,
        usedMemoryPretty:
          parsed['used_memory_human'] ??
          (usedBytes != null ? formatBytes(usedBytes) : null),
        connectedClients: parsed['connected_clients']
          ? Number(parsed['connected_clients'])
          : null,
      };
    } catch (e: any) {
      return {
        status: 'down',
        latencyMs: null,
        version: null,
        usedMemoryBytes: null,
        usedMemoryPretty: null,
        connectedClients: null,
        error: e?.message ?? 'unknown error',
      };
    } finally {
      if (client) {
        client.disconnect();
      }
    }
  }
}

function parseRedisInfo(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const line of text.split(/\r?\n/)) {
    if (!line || line.startsWith('#')) continue;
    const idx = line.indexOf(':');
    if (idx === -1) continue;
    out[line.slice(0, idx).trim()] = line.slice(idx + 1).trim();
  }
  return out;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const units = ['KB', 'MB', 'GB', 'TB'];
  let v = bytes / 1024;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v.toFixed(2)} ${units[i]}`;
}
