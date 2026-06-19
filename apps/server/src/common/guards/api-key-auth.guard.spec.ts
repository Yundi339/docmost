import { ForbiddenException } from '@nestjs/common';
import { ApiKeyAuthGuard } from './api-key-auth.guard';
import { JwtType } from '../../core/auth/dto/jwt-payload';
import { ApiKeyScope } from '../../core/api-key/api-key-scopes';

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
          {
            authType: JwtType.API_KEY,
            apiKey: { scopes: [ApiKeyScope.MCP_READ] },
          },
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

  it('blocks API key auth without MCP scopes', () => {
    expect(() =>
      guard.canActivate(
        context(
          {
            authType: JwtType.API_KEY,
            apiKey: { scopes: [ApiKeyScope.REST_READ] },
          },
          { authorization: 'Bearer api-token' },
        ),
      ),
    ).toThrow(ForbiddenException);
  });
});
