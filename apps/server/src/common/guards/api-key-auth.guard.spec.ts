import { ForbiddenException } from '@nestjs/common';
import { ApiKeyAuthGuard } from './api-key-auth.guard';
import { JwtType } from '../../core/auth/dto/jwt-payload';

describe('ApiKeyAuthGuard', () => {
  const guard = new ApiKeyAuthGuard();

  const context = (raw: Record<string, any>, headers: Record<string, any>) =>
    ({
      switchToHttp: () => ({
        getRequest: () => ({
          raw,
          headers,
        }),
      }),
    }) as any;

  it('allows API key bearer tokens', () => {
    expect(
      guard.canActivate(
        context(
          { authType: JwtType.API_KEY },
          { authorization: 'Bearer api-token' },
        ),
      ),
    ).toBe(true);
  });

  it('blocks session tokens', () => {
    expect(() =>
      guard.canActivate(
        context(
          { authType: JwtType.ACCESS },
          { authorization: 'Bearer token' },
        ),
      ),
    ).toThrow(ForbiddenException);
  });

  it('blocks API key auth without a bearer token', () => {
    expect(() =>
      guard.canActivate(context({ authType: JwtType.API_KEY }, {})),
    ).toThrow(ForbiddenException);
  });
});
