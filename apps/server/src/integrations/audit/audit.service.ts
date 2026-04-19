import { Injectable, Logger } from '@nestjs/common';
import { AuditLogPayload, ActorType, EXCLUDED_AUDIT_EVENTS } from '../../common/events/audit-events';
import { ClsService } from 'nestjs-cls';
import { AuditContext, AUDIT_CONTEXT_KEY } from '../../common/middlewares/audit-context.middleware';
import { AuditRepo } from '@docmost/db/repos/audit/audit.repo';

export type AuditLogContext = {
  workspaceId: string;
  actorId?: string;
  actorType?: ActorType;
  ipAddress?: string;
  userAgent?: string;
};

export type IAuditService = {
  log(payload: AuditLogPayload): void | Promise<void>;
  logWithContext(
    payload: AuditLogPayload,
    context: AuditLogContext,
  ): void | Promise<void>;
  logBatchWithContext(
    payloads: AuditLogPayload[],
    context: AuditLogContext,
  ): void | Promise<void>;
  setActorId(actorId: string): void;
  setActorType(actorType: ActorType): void;
  updateRetention(
    workspaceId: string,
    retentionDays: number,
  ): void | Promise<void>;
};

export const AUDIT_SERVICE = Symbol('AUDIT_SERVICE');

@Injectable()
export class NoopAuditService implements IAuditService {
  log(_payload: AuditLogPayload): void {
    // No-op: swallow the log when EE module is not available
  }

  logWithContext(_payload: AuditLogPayload, _context: AuditLogContext): void {
    // No-op: swallow the log when EE module is not available
  }

  logBatchWithContext(
    _payloads: AuditLogPayload[],
    _context: AuditLogContext,
  ): void {
    // No-op: swallow the log when EE module is not available
  }

  setActorId(_actorId: string): void {
    // No-op
  }

  setActorType(_actorType: ActorType): void {
    // No-op
  }

  updateRetention(
    _workspaceId: string,
    _retentionDays: number,
  ): void {
    // No-op
  }
}

@Injectable()
export class RealAuditService implements IAuditService {
  private readonly logger = new Logger(RealAuditService.name);

  constructor(
    private readonly cls: ClsService,
    private readonly auditRepo: AuditRepo,
  ) {}

  log(payload: AuditLogPayload): void {
    if (EXCLUDED_AUDIT_EVENTS.has(payload.event)) {
      return;
    }

    const ctx = this.cls.get<AuditContext>(AUDIT_CONTEXT_KEY);
    if (!ctx?.workspaceId) {
      return;
    }

    this.persistLog(payload, {
      workspaceId: ctx.workspaceId,
      actorId: ctx.actorId,
      actorType: ctx.actorType,
      ipAddress: ctx.ipAddress,
      userAgent: ctx.userAgent,
    });
  }

  logWithContext(payload: AuditLogPayload, context: AuditLogContext): void {
    if (EXCLUDED_AUDIT_EVENTS.has(payload.event)) {
      return;
    }
    this.persistLog(payload, context);
  }

  logBatchWithContext(
    payloads: AuditLogPayload[],
    context: AuditLogContext,
  ): void {
    for (const payload of payloads) {
      if (!EXCLUDED_AUDIT_EVENTS.has(payload.event)) {
        this.persistLog(payload, context);
      }
    }
  }

  setActorId(actorId: string): void {
    const ctx = this.cls.get<AuditContext>(AUDIT_CONTEXT_KEY);
    if (ctx) {
      ctx.actorId = actorId;
      this.cls.set(AUDIT_CONTEXT_KEY, ctx);
    }
  }

  setActorType(actorType: ActorType): void {
    const ctx = this.cls.get<AuditContext>(AUDIT_CONTEXT_KEY);
    if (ctx) {
      ctx.actorType = actorType;
      this.cls.set(AUDIT_CONTEXT_KEY, ctx);
    }
  }

  async updateRetention(
    workspaceId: string,
    retentionDays: number,
  ): Promise<void> {
    await this.auditRepo.deleteOldAuditLogs(workspaceId, retentionDays);
  }

  private persistLog(payload: AuditLogPayload, context: AuditLogContext): void {
    this.auditRepo
      .insertAudit({
        event: payload.event,
        resourceType: payload.resourceType,
        resourceId: payload.resourceId ?? null,
        spaceId: payload.spaceId ?? null,
        changes: payload.changes ?? null,
        metadata: payload.metadata ?? null,
        workspaceId: context.workspaceId,
        actorId: context.actorId ?? null,
        actorType: context.actorType ?? 'user',
        ipAddress: context.ipAddress ?? null,
      })
      .catch((err) => {
        this.logger.warn(`Failed to persist audit log: ${err.message}`);
      });
  }
}
