import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { JwtType } from '../../core/auth/dto/jwt-payload';
import { extractBearerTokenFromHeader } from '../helpers';
import { ApiKeyScope, hasApiKeyScope } from '../../core/api-key/api-key-scopes';

@Injectable()
export class ApiKeyAuthGuard implements CanActivate {
  canActivate(context: ExecutionContext) {
    const request = context.switchToHttp().getRequest();
    if (
      request.raw?.authType !== JwtType.API_KEY ||
      !extractBearerTokenFromHeader(request)
    ) {
      throw new ForbiddenException('An API key bearer token is required');
    }

    const scopes = request.raw?.apiKey?.scopes;
    if (
      !hasApiKeyScope(scopes, ApiKeyScope.MCP_READ) &&
      !hasApiKeyScope(scopes, ApiKeyScope.MCP_WRITE)
    ) {
      throw new ForbiddenException('Missing API key scope: mcp:read');
    }

    return true;
  }
}
