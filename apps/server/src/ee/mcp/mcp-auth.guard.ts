import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Inject,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { FastifyRequest } from 'fastify';
import { Workspace } from '@docmost/db/types/entity.types';
import {
  JwtApiKeyPayload,
  JwtMcpOAuthPayload,
  JwtType,
} from '../../core/auth/dto/jwt-payload';
import { TokenService } from '../../core/auth/services/token.service';
import { ApiKeyService } from '../../core/api-key/api-key.service';
import { ApiKeyScope, hasApiKeyScope } from '../../core/api-key/api-key-scopes';
import { extractBearerTokenFromHeader } from '../../common/helpers';
import { OAuthService } from '../oauth/oauth.service';
import {
  AUDIT_SERVICE,
  IAuditService,
} from '../../integrations/audit/audit.service';
import { AuditEvent, AuditResource } from '../../common/events/audit-events';

@Injectable()
export class McpAuthGuard implements CanActivate {
  private readonly authFailureAuditWindow = new Map<string, number>();

  constructor(
    private readonly tokenService: TokenService,
    private readonly apiKeyService: ApiKeyService,
    private readonly oauthService: OAuthService,
    @Inject(AUDIT_SERVICE) private readonly auditService: IAuditService,
  ) {}

  async canActivate(context: ExecutionContext) {
    const request = context.switchToHttp().getRequest<FastifyRequest>();
    const response = context.switchToHttp().getResponse();
    const token = extractBearerTokenFromHeader(request);
    const workspace =
      getRequestValue<Workspace>(request, 'workspace') ??
      (await this.oauthService.resolveWorkspaceFromRequest(request));
    if (workspace) {
      setRequestValue(request, 'workspace', workspace);
      setRequestValue(request, 'workspaceId', workspace.id);
    }

    const challenge = () => {
      if (workspace) {
        response.header(
          'WWW-Authenticate',
          this.oauthService.getWwwAuthenticateHeader(
            workspace,
            [ApiKeyScope.MCP_READ],
            request,
          ),
        );
      }
    };

    if (!token) {
      this.auditAuthFailure(workspace, request, 'missing_bearer_token');
      challenge();
      throw new UnauthorizedException('A bearer token is required');
    }

    let payload: any;
    try {
      payload = await this.tokenService.verifyAnyJwt(token);
    } catch {
      this.auditAuthFailure(workspace, request, 'invalid_bearer_token');
      challenge();
      throw new UnauthorizedException('Invalid bearer token');
    }

    if (!payload?.workspaceId || payload.workspaceId !== workspace?.id) {
      this.auditAuthFailure(workspace, request, 'workspace_mismatch');
      challenge();
      throw new UnauthorizedException('Workspace does not match');
    }

    if (payload.type === JwtType.API_KEY) {
      let authContext: Awaited<ReturnType<ApiKeyService['validateApiKey']>>;
      try {
        authContext = await this.apiKeyService.validateApiKey(
          payload as JwtApiKeyPayload,
          getAuthMetadata(request),
        );
      } catch (err) {
        if (!(err instanceof ForbiddenException)) {
          throw err;
        }
        this.auditAuthFailure(workspace, request, 'api_key_rejected', payload);
        challenge();
        throw new UnauthorizedException('Invalid API key');
      }
      const scopes = authContext.apiKey.scopes ?? [];
      if (
        !hasApiKeyScope(scopes, ApiKeyScope.MCP_READ) &&
        !hasApiKeyScope(scopes, ApiKeyScope.MCP_WRITE)
      ) {
        this.auditAuthFailure(
          workspace,
          request,
          'api_key_scope_rejected',
          payload,
        );
        throw new ForbiddenException('Missing API key scope: mcp:read');
      }

      (request as any).user = {
        user: authContext.user,
        workspace: authContext.workspace,
      };
      setRequestValue(request, 'authType', JwtType.API_KEY);
      setRequestValue(request, 'apiKey', authContext.apiKey);
      setRequestValue(request, 'mcpAuth', {
        authType: 'api_key',
        credentialId: authContext.apiKey.id,
        apiKeyId: authContext.apiKey.id,
        scopes,
        spaceAccess: authContext.apiKey.spaceAccess,
        principalRevision: getPrincipalRevision(authContext.user),
      });
      return true;
    }

    if (payload.type === JwtType.MCP_OAUTH) {
      let authContext: Awaited<ReturnType<OAuthService['validateAccessToken']>>;
      try {
        authContext = await this.oauthService.validateAccessToken(
          payload as JwtMcpOAuthPayload,
          workspace,
          request,
        );
      } catch {
        this.auditAuthFailure(
          workspace,
          request,
          'oauth_token_rejected',
          payload,
        );
        challenge();
        throw new UnauthorizedException('Invalid OAuth bearer token');
      }
      const scopes = authContext.oauth.scopes ?? [];
      if (
        !hasApiKeyScope(scopes, ApiKeyScope.MCP_READ) &&
        !hasApiKeyScope(scopes, ApiKeyScope.MCP_WRITE)
      ) {
        this.auditAuthFailure(
          workspace,
          request,
          'oauth_scope_rejected',
          payload,
        );
        challenge();
        throw new UnauthorizedException('Missing OAuth scope: mcp:read');
      }

      (request as any).user = {
        user: authContext.user,
        workspace: authContext.workspace,
      };
      setRequestValue(request, 'authType', JwtType.MCP_OAUTH);
      setRequestValue(request, 'mcpAuth', {
        authType: 'oauth',
        credentialId: authContext.oauth.authorizationId,
        oauthAuthorizationId: authContext.oauth.authorizationId,
        oauthClientId: authContext.oauth.oauthClientId,
        clientId: authContext.oauth.clientId,
        scopes,
        spaceAccess: authContext.oauth.spaceAccess,
        principalRevision: getPrincipalRevision(authContext.user),
      });
      return true;
    }

    this.auditAuthFailure(
      workspace,
      request,
      'unsupported_bearer_token',
      payload,
    );
    challenge();
    throw new UnauthorizedException('Unsupported bearer token');
  }

  private auditAuthFailure(
    workspace: Workspace | undefined,
    request: FastifyRequest,
    reason: string,
    payload?: { sub?: string; type?: JwtType },
  ) {
    if (!workspace) {
      return;
    }

    const now = Date.now();
    const tracker = `${workspace.id}:${request.ip}:${reason}`;
    const lastLoggedAt = this.authFailureAuditWindow.get(tracker);
    if (lastLoggedAt && now - lastLoggedAt < 5 * 60_000) {
      return;
    }
    if (this.authFailureAuditWindow.size >= 1_000) {
      const oldestTracker = this.authFailureAuditWindow.keys().next().value;
      if (oldestTracker) {
        this.authFailureAuditWindow.delete(oldestTracker);
      }
    }
    this.authFailureAuditWindow.set(tracker, now);

    this.auditService.logWithContext(
      {
        event: AuditEvent.MCP_AUTH_FAILED,
        resourceType: AuditResource.MCP_AUTH,
        metadata: {
          reason,
          userAgent: truncateString(request.headers?.['user-agent'], 1000),
        },
      },
      {
        workspaceId: workspace.id,
        actorId: payload?.sub,
        actorType:
          payload?.type === JwtType.API_KEY
            ? 'api_key'
            : payload?.type === JwtType.MCP_OAUTH
              ? 'oauth'
              : 'system',
        ipAddress: request.ip,
      },
    );
  }
}

function getRequestValue<T>(
  request: FastifyRequest,
  key: string,
): T | undefined {
  return ((request.raw as any)?.[key] ?? (request as any)?.[key]) as
    | T
    | undefined;
}

function setRequestValue(request: FastifyRequest, key: string, value: unknown) {
  (request as any)[key] = value;
  (request.raw as any)[key] = value;
}

function getAuthMetadata(req: FastifyRequest) {
  return {
    ipAddress: req.ip,
    userAgent: req.headers?.['user-agent'],
  };
}

function truncateString(value: unknown, maxLength: number) {
  if (typeof value !== 'string') return undefined;
  return value.length > maxLength ? value.slice(0, maxLength) : value;
}

function getPrincipalRevision(user: {
  updatedAt?: Date | string;
  role?: string;
}) {
  const updatedAt = user.updatedAt
    ? new Date(user.updatedAt).toISOString()
    : 'unknown';
  return `${updatedAt}:${user.role ?? 'member'}`;
}
