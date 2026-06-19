import { ForbiddenException } from '@nestjs/common';
import { JwtAuthGuard } from './jwt-auth.guard';
import { JwtType } from '../../core/auth/dto/jwt-payload';
import { ApiKeyScope } from '../../core/api-key/api-key-scopes';

describe('JwtAuthGuard', () => {
  let guard: JwtAuthGuard;
  let reflector: { getAllAndOverride: jest.Mock };
  const environmentService = {
    isCloud: jest.fn().mockReturnValue(false),
  };

  beforeEach(() => {
    reflector = {
      getAllAndOverride: jest.fn().mockReturnValue(undefined),
    };
    guard = new JwtAuthGuard(reflector as any, environmentService as any);
  });

  const context = (req: Record<string, any>) =>
    ({
      getHandler: () => jest.fn(),
      getClass: () => JwtAuthGuard,
      switchToHttp: () => ({
        getRequest: () => req,
        getResponse: () => ({ setCookie: jest.fn() }),
      }),
    }) as any;

  it('allows API keys with rest:read scope on read requests', () => {
    const user = { id: 'user-id', workspace: { id: 'workspace-id' } };
    const req = {
      method: 'GET',
      url: '/pages',
      raw: {
        authType: JwtType.API_KEY,
        apiKey: { scopes: [ApiKeyScope.REST_READ] },
      },
      cookies: {},
    };

    expect(guard.handleRequest(null, user, null, context(req))).toBe(user);
  });

  it('blocks API keys without rest:write scope on write requests', () => {
    const req = {
      method: 'POST',
      url: '/pages/create',
      raw: {
        authType: JwtType.API_KEY,
        apiKey: { scopes: [ApiKeyScope.REST_READ] },
      },
      cookies: {},
    };

    expect(() =>
      guard.handleRequest(null, { id: 'user-id' }, null, context(req)),
    ).toThrow(ForbiddenException);
  });

  it('allows API keys with rest:write scope on write requests', () => {
    const user = { id: 'user-id', workspace: { id: 'workspace-id' } };
    const req = {
      method: 'POST',
      url: '/pages/create',
      raw: {
        authType: JwtType.API_KEY,
        apiKey: { scopes: [ApiKeyScope.REST_WRITE] },
      },
      cookies: {},
    };

    expect(guard.handleRequest(null, user, null, context(req))).toBe(user);
  });

  it('allows route-level rest:read scope on POST read requests', () => {
    reflector.getAllAndOverride.mockReturnValue([ApiKeyScope.REST_READ]);
    const user = { id: 'user-id', workspace: { id: 'workspace-id' } };
    const req = {
      method: 'POST',
      url: '/pages/info',
      raw: {
        authType: JwtType.API_KEY,
        apiKey: { scopes: [ApiKeyScope.REST_READ] },
      },
      cookies: {},
    };

    expect(guard.handleRequest(null, user, null, context(req))).toBe(user);
  });

  it('does not apply REST scopes to MCP requests', () => {
    const user = { id: 'user-id', workspace: { id: 'workspace-id' } };
    const req = {
      method: 'POST',
      url: '/mcp',
      raw: {
        authType: JwtType.API_KEY,
        apiKey: { scopes: [ApiKeyScope.MCP_READ] },
      },
      cookies: {},
    };

    expect(guard.handleRequest(null, user, null, context(req))).toBe(user);
  });
});
