import { Injectable, Logger } from '@nestjs/common';
import { Interval } from '@nestjs/schedule';
import { AuditRepo } from '@docmost/db/repos/audit/audit.repo';
import { PageRepo } from '@docmost/db/repos/page/page.repo';
import { User } from '@docmost/db/types/entity.types';
import { AuditEvent, AuditResource } from '../../common/events/audit-events';
import { PageAccessService } from '../page/page-access/page-access.service';
import {
  LARGE_BOARD_RECORD_THRESHOLD,
  SystemDiagnosticAuditRow,
  SystemDiagnosticsRepo,
  SystemDiagnosticSignals,
} from './system-diagnostics.repo';
import {
  SystemDiagnosticCheck,
  SystemDiagnosticCode,
  SystemDiagnosticCodeType,
  SystemDiagnosticHistoryEntry,
  SystemDiagnosticsResponse,
  SystemDiagnosticSeverity,
} from './system-diagnostics.types';
import { ListSystemDiagnosticDataSourcesDto } from './system-diagnostics.dto';

const CACHE_TTL_MS = 60_000;
const INCIDENT_THROTTLE_MS = 5 * 60_000;
const SCAN_INTERVAL_MS = 15 * 60_000;
const TRANSITION_CODES = new Set<SystemDiagnosticCodeType>([
  SystemDiagnosticCode.EXTERNAL_APITABLE_ACTIVE,
  SystemDiagnosticCode.LARGE_BOARD,
  SystemDiagnosticCode.ORPHAN_DATABASE_SOURCE,
  SystemDiagnosticCode.INVALID_DATABASE_RELATION,
]);

type DiagnosticSnapshot = {
  checkedAt: string;
  checks: SystemDiagnosticCheck[];
};

@Injectable()
export class SystemDiagnosticsService {
  private readonly logger = new Logger(SystemDiagnosticsService.name);
  private readonly cache = new Map<
    string,
    DiagnosticSnapshot & { expiresAt: number }
  >();
  private readonly workspaceScans = new Map<
    string,
    Promise<DiagnosticSnapshot>
  >();
  private readonly incidentThrottle = new Map<string, number>();
  private scanningAllWorkspaces = false;

  constructor(
    private readonly diagnosticsRepo: SystemDiagnosticsRepo,
    private readonly auditRepo: AuditRepo,
    private readonly pageRepo: PageRepo,
    private readonly pageAccessService: PageAccessService,
  ) {}

  async getDiagnostics(
    workspaceId: string,
  ): Promise<SystemDiagnosticsResponse> {
    try {
      const snapshot = await this.getOrScanWorkspace(workspaceId);
      const history = await this.diagnosticsRepo.listHistory(workspaceId);
      return {
        status: 'up',
        checkedAt: snapshot.checkedAt,
        checks: snapshot.checks,
        history: history
          .map((entry) => this.toHistoryEntry(entry))
          .filter((entry): entry is SystemDiagnosticHistoryEntry =>
            Boolean(entry),
          ),
      };
    } catch (error) {
      this.logger.error(
        `Failed to collect system diagnostics for workspace ${workspaceId}`,
        error,
      );
      return {
        status: 'down',
        checkedAt: new Date().toISOString(),
        checks: [],
        history: [],
        error: 'System diagnostics are temporarily unavailable',
      };
    }
  }

  async listDataSources(
    user: User,
    options: ListSystemDiagnosticDataSourcesDto,
  ) {
    const result = await this.diagnosticsRepo.listDataSources(
      user.workspaceId,
      options,
    );
    const pageIds = [
      ...new Set(
        result.items.flatMap((item) =>
          item.hostPage ? [item.hostPage.id] : [],
        ),
      ),
    ];
    if (pageIds.length === 0) return result;

    const pages = (await this.pageRepo.findByIds(pageIds)).filter(
      (page) => page.workspaceId === user.workspaceId,
    );
    const visiblePageIds = new Set(
      (
        await this.pageAccessService.filterViewablePagesWithPermissions(
          pages,
          user,
        )
      ).map(({ page }) => page.id),
    );

    return {
      ...result,
      items: result.items.map((item) =>
        item.hostPage && visiblePageIds.has(item.hostPage.id)
          ? item
          : {
              ...item,
              title: null,
              recordCount: null,
              hostPage: null,
              space: null,
            },
      ),
    };
  }

  @Interval('system-diagnostics-scan', SCAN_INTERVAL_MS)
  async scanAllWorkspaces(): Promise<void> {
    if (this.scanningAllWorkspaces) return;
    this.scanningAllWorkspaces = true;
    try {
      const workspaceIds = await this.diagnosticsRepo.listWorkspaceIds();
      for (const workspaceId of workspaceIds) {
        try {
          await this.getOrScanWorkspace(workspaceId, true);
        } catch (error) {
          this.logger.error(
            `Scheduled diagnostics failed for workspace ${workspaceId}`,
            error,
          );
        }
      }
    } catch (error) {
      this.logger.error(
        'Failed to list workspaces for system diagnostics',
        error,
      );
    } finally {
      this.scanningAllWorkspaces = false;
    }
  }

  async recordIncident(
    workspaceId: string,
    code: typeof SystemDiagnosticCode.REALTIME_INVALIDATION_FAILURE,
    metadata: { source: string },
  ): Promise<void> {
    const throttleKey = `${workspaceId}:${code}`;
    const now = Date.now();
    if ((this.incidentThrottle.get(throttleKey) ?? 0) > now) return;
    this.incidentThrottle.set(throttleKey, now + INCIDENT_THROTTLE_MS);

    try {
      await this.auditRepo.insertAudit({
        workspaceId,
        actorType: 'system',
        actorId: null,
        event: AuditEvent.SYSTEM_DIAGNOSTIC_OCCURRED,
        resourceType: AuditResource.WORKSPACE,
        resourceId: workspaceId,
        metadata: {
          diagnosticCode: code,
          severity: 'warning',
          count: 1,
          sampled: true,
          source: metadata.source,
        },
      });
      this.cache.delete(workspaceId);
    } catch (error) {
      this.logger.error(
        `Failed to persist system diagnostic incident for workspace ${workspaceId}`,
        error,
      );
      this.incidentThrottle.delete(throttleKey);
    }
  }

  private async getOrScanWorkspace(
    workspaceId: string,
    force = false,
  ): Promise<DiagnosticSnapshot> {
    const cached = this.cache.get(workspaceId);
    if (!force && cached && cached.expiresAt > Date.now()) return cached;

    const activeScan = this.workspaceScans.get(workspaceId);
    if (activeScan) return activeScan;

    const scan = this.scanWorkspace(workspaceId).finally(() => {
      this.workspaceScans.delete(workspaceId);
    });
    this.workspaceScans.set(workspaceId, scan);
    return scan;
  }

  private async scanWorkspace(
    workspaceId: string,
  ): Promise<DiagnosticSnapshot> {
    const signals = await this.diagnosticsRepo.getSignals(workspaceId);
    const checks = this.toChecks(signals);
    await this.persistTransitions(workspaceId, checks);

    const snapshot = {
      checkedAt: new Date().toISOString(),
      checks,
      expiresAt: Date.now() + CACHE_TTL_MS,
    };
    this.cache.set(workspaceId, snapshot);
    return snapshot;
  }

  private toChecks(signals: SystemDiagnosticSignals): SystemDiagnosticCheck[] {
    return [
      this.check(
        SystemDiagnosticCode.EXTERNAL_APITABLE_ACTIVE,
        'info',
        signals.externalDataSourceCount,
      ),
      this.check(
        SystemDiagnosticCode.LARGE_BOARD,
        'warning',
        signals.largeBoardCount,
        {
          value: signals.maxRecordCount,
          threshold: LARGE_BOARD_RECORD_THRESHOLD,
        },
      ),
      this.check(
        SystemDiagnosticCode.ORPHAN_DATABASE_SOURCE,
        'warning',
        signals.orphanDataSourceCount,
      ),
      this.check(
        SystemDiagnosticCode.INVALID_DATABASE_RELATION,
        'error',
        signals.invalidRelationCount,
      ),
      this.check(
        SystemDiagnosticCode.REALTIME_INVALIDATION_FAILURE,
        'warning',
        signals.realtimeFailureCount,
        { windowHours: 24 },
      ),
    ];
  }

  private check(
    code: SystemDiagnosticCodeType,
    severity: SystemDiagnosticSeverity,
    count: number,
    details: Pick<
      SystemDiagnosticCheck,
      'value' | 'threshold' | 'windowHours'
    > = {},
  ): SystemDiagnosticCheck {
    return {
      code,
      severity,
      count,
      status: count > 0 ? 'attention' : 'ok',
      ...details,
    };
  }

  private async persistTransitions(
    workspaceId: string,
    checks: SystemDiagnosticCheck[],
  ): Promise<void> {
    for (const check of checks) {
      if (!TRANSITION_CODES.has(check.code)) continue;
      const latest = await this.diagnosticsRepo.findLatestTransition(
        workspaceId,
        check.code,
      );
      const wasActive = latest?.event === AuditEvent.SYSTEM_DIAGNOSTIC_DETECTED;
      const isActive = check.status === 'attention';
      if (isActive === wasActive) continue;
      if (!isActive && !latest) continue;

      await this.auditRepo.insertAudit({
        workspaceId,
        actorType: 'system',
        actorId: null,
        event: isActive
          ? AuditEvent.SYSTEM_DIAGNOSTIC_DETECTED
          : AuditEvent.SYSTEM_DIAGNOSTIC_RESOLVED,
        resourceType: AuditResource.WORKSPACE,
        resourceId: workspaceId,
        metadata: {
          diagnosticCode: check.code,
          severity: check.severity,
          count: check.count,
          ...(check.value === undefined ? {} : { value: check.value }),
          ...(check.threshold === undefined
            ? {}
            : { threshold: check.threshold }),
          source: 'system_diagnostics',
        },
      });
    }
  }

  private toHistoryEntry(
    entry: SystemDiagnosticAuditRow,
  ): SystemDiagnosticHistoryEntry | null {
    const metadata = asRecord(entry.metadata);
    const code = metadata.diagnosticCode;
    if (!isDiagnosticCode(code)) return null;

    const state =
      entry.event === AuditEvent.SYSTEM_DIAGNOSTIC_DETECTED
        ? 'detected'
        : entry.event === AuditEvent.SYSTEM_DIAGNOSTIC_RESOLVED
          ? 'resolved'
          : entry.event === AuditEvent.SYSTEM_DIAGNOSTIC_OCCURRED
            ? 'occurred'
            : null;
    if (!state) return null;

    return {
      id: entry.id,
      code,
      state,
      severity: isSeverity(metadata.severity) ? metadata.severity : 'warning',
      count: toNumber(metadata.count),
      ...(toOptionalNumber(metadata.value) === undefined
        ? {}
        : { value: toOptionalNumber(metadata.value) }),
      ...(toOptionalNumber(metadata.threshold) === undefined
        ? {}
        : { threshold: toOptionalNumber(metadata.threshold) }),
      createdAt: entry.createdAt.toISOString(),
    };
  }
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function isDiagnosticCode(value: unknown): value is SystemDiagnosticCodeType {
  return Object.values(SystemDiagnosticCode).includes(
    value as SystemDiagnosticCodeType,
  );
}

function isSeverity(value: unknown): value is SystemDiagnosticSeverity {
  return value === 'info' || value === 'warning' || value === 'error';
}

function toNumber(value: unknown): number {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

function toOptionalNumber(value: unknown): number | undefined {
  if (value === null || value === undefined || value === '') return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}
