import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { JwtType } from '../../core/auth/dto/jwt-payload';
import { extractBearerTokenFromHeader } from '../helpers';

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

    return true;
  }
}
