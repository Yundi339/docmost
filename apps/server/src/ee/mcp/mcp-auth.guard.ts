import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
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

@Injectable()
export class McpAuthGuard implements CanActivate {
  constructor(
    private readonly tokenService: TokenService,
    private readonly apiKeyService: ApiKeyService,
    private readonly oauthService: OAuthService,
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
      challenge();
      throw new UnauthorizedException('A bearer token is required');
    }

    let payload: any;
    try {
      payload = await this.tokenService.verifyAnyJwt(token);
    } catch {
      challenge();
      throw new UnauthorizedException('Invalid bearer token');
    }

    if (!payload?.workspaceId || payload.workspaceId !== workspace?.id) {
      challenge();
      throw new UnauthorizedException('Workspace does not match');
    }

    if (payload.type === JwtType.API_KEY) {
      const authContext = await this.apiKeyService.validateApiKey(
        payload as JwtApiKeyPayload,
        getAuthMetadata(request),
      );
      const scopes = authContext.apiKey.scopes ?? [];
      if (
        !hasApiKeyScope(scopes, ApiKeyScope.MCP_READ) &&
        !hasApiKeyScope(scopes, ApiKeyScope.MCP_WRITE)
      ) {
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
        challenge();
        throw new UnauthorizedException('Invalid OAuth bearer token');
      }
      const scopes = authContext.oauth.scopes ?? [];
      if (
        !hasApiKeyScope(scopes, ApiKeyScope.MCP_READ) &&
        !hasApiKeyScope(scopes, ApiKeyScope.MCP_WRITE)
      ) {
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
      });
      return true;
    }

    challenge();
    throw new UnauthorizedException('Unsupported bearer token');
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
  const forwardedFor = req.headers?.['x-forwarded-for'];
  const ipAddress = Array.isArray(forwardedFor)
    ? forwardedFor[0]
    : forwardedFor?.split(',')[0]?.trim() || req.ip;

  return {
    ipAddress,
    userAgent: req.headers?.['user-agent'],
  };
}
