import { ForbiddenException } from '@nestjs/common';
import { SessionAuthGuard } from './session-auth.guard';
import { JwtType } from '../../core/auth/dto/jwt-payload';

describe('SessionAuthGuard', () => {
  const guard = new SessionAuthGuard();

  const context = (authType: JwtType) =>
    ({
      switchToHttp: () => ({
        getRequest: () => ({
          raw: { authType },
        }),
      }),
    }) as any;

  it('allows user session tokens', () => {
    expect(guard.canActivate(context(JwtType.ACCESS))).toBe(true);
  });

  it('blocks API key tokens', () => {
    expect(() => guard.canActivate(context(JwtType.API_KEY))).toThrow(
      ForbiddenException,
    );
  });

  it('blocks MCP OAuth tokens', () => {
    expect(() => guard.canActivate(context(JwtType.MCP_OAUTH))).toThrow(
      ForbiddenException,
    );
  });
});
