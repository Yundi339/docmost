import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { JwtType } from '../../core/auth/dto/jwt-payload';

@Injectable()
export class SessionAuthGuard implements CanActivate {
  canActivate(context: ExecutionContext) {
    const request = context.switchToHttp().getRequest();
    if (request.raw?.authType !== JwtType.ACCESS) {
      throw new ForbiddenException('A user session is required');
    }

    return true;
  }
}
