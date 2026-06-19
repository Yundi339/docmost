import {
  ExecutionContext,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { IS_PUBLIC_KEY } from '../decorators/public.decorator';
import { Reflector } from '@nestjs/core';
import { EnvironmentService } from '../../integrations/environment/environment.service';
import { addDays } from 'date-fns';
import { JwtType } from '../../core/auth/dto/jwt-payload';
import { ApiKeyScope, hasApiKeyScope } from '../../core/api-key/api-key-scopes';
import { API_KEY_SCOPES_KEY } from '../decorators/api-key-scope.decorator';

@Injectable()
export class JwtAuthGuard extends AuthGuard('jwt') {
  constructor(
    private reflector: Reflector,
    private environmentService: EnvironmentService,
  ) {
    super();
  }

  canActivate(context: ExecutionContext) {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    if (isPublic) {
      return true;
    }

    return super.canActivate(context);
  }

  handleRequest(err: any, user: any, info: any, ctx: ExecutionContext) {
    if (err || !user) {
      throw err || new UnauthorizedException();
    }

    this.assertApiKeyRestScope(ctx);
    this.setJoinedWorkspacesCookie(user, ctx);
    return user;
  }

  private assertApiKeyRestScope(ctx: ExecutionContext) {
    const req = ctx.switchToHttp().getRequest();
    if (req.raw?.authType !== JwtType.API_KEY || isMcpRequest(req)) {
      return;
    }

    const requiredScopes = this.reflector.getAllAndOverride<ApiKeyScope[]>(
      API_KEY_SCOPES_KEY,
      [ctx.getHandler(), ctx.getClass()],
    ) ?? [
      isReadMethod(req.method) ? ApiKeyScope.REST_READ : ApiKeyScope.REST_WRITE,
    ];

    for (const requiredScope of requiredScopes) {
      if (!hasApiKeyScope(req.raw?.apiKey?.scopes, requiredScope)) {
        throw new ForbiddenException(`Missing API key scope: ${requiredScope}`);
      }
    }
  }

  setJoinedWorkspacesCookie(user: any, ctx: ExecutionContext) {
    const req = ctx.switchToHttp().getRequest();
    if (
      this.environmentService.isCloud() &&
      req.raw?.authType === JwtType.ACCESS
    ) {
      const res = ctx.switchToHttp().getResponse();

      const workspaceId = user?.workspace?.id;
      let workspaceIds = [];
      try {
        workspaceIds = req.cookies.joinedWorkspaces
          ? JSON.parse(req.cookies.joinedWorkspaces)
          : [];
      } catch (err) {
        /* empty */
      }

      if (!workspaceIds.includes(workspaceId)) {
        workspaceIds.push(workspaceId);
      }

      res.setCookie('joinedWorkspaces', JSON.stringify(workspaceIds), {
        httpOnly: true,
        sameSite: 'lax',
        domain: '.' + this.environmentService.getSubdomainHost(),
        path: '/',
        expires: addDays(new Date(), 365),
        secure: this.environmentService.isHttps(),
      });
    }
  }
}

function isReadMethod(method?: string) {
  return ['GET', 'HEAD', 'OPTIONS'].includes(method ?? '');
}

function isMcpRequest(req: any) {
  const url = req.url ?? req.raw?.url ?? '';
  return url === '/mcp' || url.startsWith('/mcp/') || url.includes('/mcp');
}
