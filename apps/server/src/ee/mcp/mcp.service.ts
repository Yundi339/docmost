import {
  Inject,
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { IncomingMessage, ServerResponse } from 'node:http';
import { randomUUID } from 'crypto';
import { User, Workspace } from '@docmost/db/types/entity.types';
import {
  AUDIT_SERVICE,
  IAuditService,
} from '../../integrations/audit/audit.service';
import { AuditEvent, AuditResource } from '../../common/events/audit-events';
import { McpToolRegistryService } from './mcp-tool-registry.service';
import type { McpMode, McpRequestContext } from './mcp.types';
import { OnEvent } from '@nestjs/event-emitter';
import { EventName } from '../../common/events/event.contants';

export type { McpMode, McpRequestContext } from './mcp.types';

// eslint-disable-next-line @typescript-eslint/no-require-imports
const packageJson = require('../../../package.json');

const DEFAULT_MAX_MCP_SESSIONS = 500;
const DEFAULT_MAX_MCP_SESSIONS_PER_CREDENTIAL = 10;
const DEFAULT_MCP_SESSION_IDLE_TTL_SECONDS = 60 * 60;

interface McpSession {
  sessionId: string;
  transport: StreamableHTTPServerTransport;
  server: McpServer;
  userId: string;
  workspaceId: string;
  authType: 'api_key' | 'oauth';
  credentialId: string;
  scopes: string[];
  mode: McpMode;
  permissionRevision: string;
  context: McpRequestContext;
  lastActivityAt: number;
}

@Injectable()
export class McpService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(McpService.name);
  private sessions = new Map<string, McpSession>();
  private readonly maxSessions = getPositiveInteger(
    process.env.MCP_MAX_SESSIONS,
    DEFAULT_MAX_MCP_SESSIONS,
  );
  private readonly maxSessionsPerCredential = getPositiveInteger(
    process.env.MCP_MAX_SESSIONS_PER_CREDENTIAL,
    DEFAULT_MAX_MCP_SESSIONS_PER_CREDENTIAL,
  );
  private readonly sessionIdleTtlMs =
    getPositiveInteger(
      process.env.MCP_SESSION_IDLE_TTL_SECONDS,
      DEFAULT_MCP_SESSION_IDLE_TTL_SECONDS,
    ) * 1000;
  private sessionCleanupTimer?: ReturnType<typeof setInterval>;

  constructor(
    private readonly toolRegistry: McpToolRegistryService,
    @Inject(AUDIT_SERVICE) private readonly auditService: IAuditService,
  ) {}

  onModuleInit() {
    const intervalMs = Math.min(
      Math.max(Math.floor(this.sessionIdleTtlMs / 2), 60_000),
      5 * 60_000,
    );
    this.sessionCleanupTimer = setInterval(() => {
      this.pruneExpiredSessions().catch((err) => {
        this.logger.warn(`Failed to clean up MCP sessions: ${err.message}`);
      });
    }, intervalMs);
    this.sessionCleanupTimer.unref?.();
  }

  onModuleDestroy() {
    if (this.sessionCleanupTimer) {
      clearInterval(this.sessionCleanupTimer);
    }
    for (const [, session] of this.sessions) {
      session.transport.close().catch(() => {});
    }
    this.sessions.clear();
  }

  @OnEvent(EventName.SPACE_DELETED)
  async handleSpaceDeleted(event: { spaceId: string }) {
    const affected = [...this.sessions.values()]
      .filter((session) =>
        session.context.spaceAccess.effectiveSpaceIds.includes(event.spaceId),
      )
      .map((session) => session.sessionId);
    await Promise.all(
      affected.map((sessionId) =>
        this.closeSession(
          sessionId,
          AuditEvent.MCP_SESSION_CLOSED,
          'space_deleted',
        ),
      ),
    );
  }

  async handleRequest(
    req: IncomingMessage,
    res: ServerResponse,
    body: unknown,
    user: User,
    workspace: Workspace,
    context: McpRequestContext,
  ): Promise<void> {
    const sessionId = req.headers['mcp-session-id'] as string | undefined;
    await this.pruneExpiredSessions();

    if (sessionId && this.sessions.has(sessionId)) {
      const session = this.sessions.get(sessionId);
      // Prevent session hijacking: the caller's JWT must match the user/workspace
      // that created this session. Otherwise anyone with the sessionId + any valid
      // API key could execute tools as the original user.
      if (
        session.userId !== user.id ||
        session.workspaceId !== workspace.id ||
        session.authType !== context.authType ||
        session.credentialId !== context.credentialId
      ) {
        res
          .writeHead(403, { 'Content-Type': 'application/json' })
          .end(
            JSON.stringify({ error: 'Session does not belong to this user' }),
          );
        return;
      }
      if (
        session.mode !== context.mode ||
        !sameScopes(session.scopes, context.scopes) ||
        session.permissionRevision !== getPermissionRevision(context)
      ) {
        await this.closeSession(
          sessionId,
          AuditEvent.MCP_SESSION_CLOSED,
          'permissions_changed',
        );
        res.writeHead(403, { 'Content-Type': 'application/json' }).end(
          JSON.stringify({
            error: 'MCP session permissions changed. Reconnect required.',
          }),
        );
        return;
      }
      session.lastActivityAt = Date.now();
      await session.transport.handleRequest(req, res, body);
      return;
    }

    if (sessionId && !this.sessions.has(sessionId)) {
      res.writeHead(404).end(JSON.stringify({ error: 'Session not found' }));
      return;
    }

    if (!this.hasSessionCapacity(context)) {
      res
        .writeHead(429, { 'Content-Type': 'application/json' })
        .end(JSON.stringify({ error: 'Too many active MCP sessions' }));
      return;
    }

    // New session (initialization). This in-memory session store is suitable for
    // single-instance deployments. Multi-instance deployments must use sticky
    // sessions or replace this with a shared store.
    const server = this.createMcpServer(user, workspace, context);
    let sid: string | undefined;
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: () => randomUUID(),
      onsessioninitialized: (sessionId) => {
        sid = sessionId;
        if (!this.hasSessionCapacity(context)) {
          transport.close().catch(() => {});
          return;
        }

        const session: McpSession = {
          sessionId,
          transport,
          server,
          userId: user.id,
          workspaceId: workspace.id,
          authType: context.authType,
          credentialId: context.credentialId,
          scopes: [...context.scopes],
          mode: context.mode,
          permissionRevision: getPermissionRevision(context),
          context: { ...context, scopes: [...context.scopes] },
          lastActivityAt: Date.now(),
        };
        this.sessions.set(sessionId, session);
        this.auditMcpSessionEvent(session, AuditEvent.MCP_SESSION_STARTED);
      },
    });

    transport.onclose = () => {
      if (!sid) return;
      this.finishSession(sid, AuditEvent.MCP_SESSION_CLOSED, 'client_closed');
    };

    await server.connect(transport);
    await transport.handleRequest(req, res, body);
  }

  async handleDelete(
    req: IncomingMessage,
    res: ServerResponse,
    user?: User,
    workspace?: Workspace,
    context?: McpRequestContext,
  ): Promise<void> {
    const sessionId = req.headers['mcp-session-id'] as string | undefined;
    if (sessionId && this.sessions.has(sessionId)) {
      const session = this.sessions.get(sessionId);
      if (
        user &&
        workspace &&
        (session.userId !== user.id ||
          session.workspaceId !== workspace.id ||
          (context &&
            (session.authType !== context.authType ||
              session.credentialId !== context.credentialId)))
      ) {
        res.writeHead(403).end();
        return;
      }
      await this.closeSession(
        sessionId,
        AuditEvent.MCP_SESSION_CLOSED,
        'client_deleted',
      );
      res.writeHead(200).end();
    } else {
      res.writeHead(404).end();
    }
  }

  private hasSessionCapacity(context: McpRequestContext) {
    if (this.sessions.size >= this.maxSessions) {
      return false;
    }

    let credentialSessions = 0;
    for (const session of this.sessions.values()) {
      if (
        session.authType === context.authType &&
        session.credentialId === context.credentialId
      ) {
        credentialSessions += 1;
      }
    }
    return credentialSessions < this.maxSessionsPerCredential;
  }

  private async pruneExpiredSessions() {
    const expiresBefore = Date.now() - this.sessionIdleTtlMs;
    const expiredSessionIds = [...this.sessions.values()]
      .filter((session) => session.lastActivityAt <= expiresBefore)
      .map((session) => session.sessionId);

    await Promise.all(
      expiredSessionIds.map((sessionId) =>
        this.closeSession(
          sessionId,
          AuditEvent.MCP_SESSION_EXPIRED,
          'idle_timeout',
        ),
      ),
    );
  }

  private async closeSession(
    sessionId: string,
    event:
      | typeof AuditEvent.MCP_SESSION_CLOSED
      | typeof AuditEvent.MCP_SESSION_EXPIRED,
    reason: string,
  ) {
    const session = this.finishSession(sessionId, event, reason);
    if (!session) {
      return false;
    }

    await session.transport.close().catch(() => {});
    return true;
  }

  private finishSession(
    sessionId: string,
    event:
      | typeof AuditEvent.MCP_SESSION_CLOSED
      | typeof AuditEvent.MCP_SESSION_EXPIRED,
    reason: string,
  ) {
    const session = this.sessions.get(sessionId);
    if (!session) {
      return undefined;
    }

    this.sessions.delete(sessionId);
    this.auditMcpSessionEvent(session, event, reason);
    this.logger.debug(`MCP session ${sessionId} ${reason}`);
    return session;
  }

  private auditMcpSessionEvent(
    session: McpSession,
    event:
      | typeof AuditEvent.MCP_SESSION_STARTED
      | typeof AuditEvent.MCP_SESSION_CLOSED
      | typeof AuditEvent.MCP_SESSION_EXPIRED,
    reason?: string,
  ) {
    const context = session.context;
    this.auditService.logWithContext(
      {
        event,
        resourceType: AuditResource.MCP_SESSION,
        resourceId: session.sessionId,
        metadata: {
          sessionId: session.sessionId,
          reason,
          authType: context.authType,
          credentialId: context.credentialId,
          apiKeyId: context.apiKeyId,
          oauthAuthorizationId: context.oauthAuthorizationId,
          oauthClientId: context.oauthClientId,
          clientId: context.clientId,
          mode: context.mode,
          scopes: context.scopes,
          spaceAccessMode: context.spaceAccess?.mode,
          selectedSpaceCount: context.spaceAccess?.selectedSpaceIds.length,
          effectiveSpaceCount: context.spaceAccess?.effectiveSpaceIds.length,
          userAgent: truncateString(context.userAgent, 1000),
        },
      },
      {
        workspaceId: session.workspaceId,
        actorId: session.userId,
        actorType: context.authType,
        ipAddress: context.ipAddress,
      },
    );
  }

  private createMcpServer(
    user: User,
    workspace: Workspace,
    context: McpRequestContext,
  ): McpServer {
    const server = new McpServer(
      {
        name: 'Docmost',
        version: process.env.APP_VERSION || packageJson?.version || 'unknown',
      },
      { capabilities: { tools: {} } },
    );
    this.toolRegistry.registerTools(server, user, workspace, context);
    return server;
  }
}

function sameScopes(left: string[], right: string[]) {
  if (left.length !== right.length) return false;
  const leftSet = new Set(left);
  return right.every((scope) => leftSet.has(scope));
}

function getPermissionRevision(context: McpRequestContext) {
  return `${context.principalRevision}:${context.spaceAccess.revision}`;
}

function getPositiveInteger(value: string | undefined, fallback: number) {
  if (!value) return fallback;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function truncateString(value: unknown, maxLength: number) {
  if (typeof value !== 'string') return undefined;
  return value.length > maxLength ? value.slice(0, maxLength) : value;
}
