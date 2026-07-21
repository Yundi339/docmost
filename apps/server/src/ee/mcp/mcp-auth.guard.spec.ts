import { ForbiddenException, UnauthorizedException } from '@nestjs/common';
import { McpAuthGuard } from './mcp-auth.guard';
import { ApiKeyScope, ApiKeyType } from '../../core/api-key/api-key-scopes';
import { JwtType } from '../../core/auth/dto/jwt-payload';

describe('McpAuthGuard', () => {
  const workspace = { id: 'workspace-id' } as any;

  function createContext(request: Record<string, any>, response: any) {
    return {
      switchToHttp: () => ({
        getRequest: () => request,
        getResponse: () => response,
      }),
    } as any;
  }

  it('adds an OAuth challenge when bearer token is missing without middleware workspace', async () => {
    const oauthService = {
      resolveWorkspaceFromRequest: jest.fn().mockResolvedValue(workspace),
      getWwwAuthenticateHeader: jest
        .fn()
        .mockReturnValue(
          'Bearer resource_metadata="https://example.com/.well-known/oauth-protected-resource/mcp", scope="mcp:read"',
        ),
    };
    const auditService = { logWithContext: jest.fn() };
    const guard = new McpAuthGuard(
      {} as any,
      {} as any,
      oauthService as any,
      auditService as any,
    );
    const request: Record<string, any> = {
      headers: {},
      raw: {},
      ip: '203.0.113.10',
    };
    const response = {
      header: jest.fn(),
    };

    await expect(
      guard.canActivate(createContext(request, response)),
    ).rejects.toThrow(UnauthorizedException);

    expect(oauthService.resolveWorkspaceFromRequest).toHaveBeenCalledWith(
      request,
    );
    expect(request.raw.workspace).toBe(workspace);
    expect(request.raw.workspaceId).toBe(workspace.id);
    expect(response.header).toHaveBeenCalledWith(
      'WWW-Authenticate',
      'Bearer resource_metadata="https://example.com/.well-known/oauth-protected-resource/mcp", scope="mcp:read"',
    );
    expect(auditService.logWithContext).toHaveBeenCalledWith(
      expect.objectContaining({
        event: 'mcp.auth_failed',
        metadata: expect.objectContaining({ reason: 'missing_bearer_token' }),
      }),
      expect.objectContaining({
        workspaceId: 'workspace-id',
        actorType: 'system',
        ipAddress: '203.0.113.10',
      }),
    );

    await expect(
      guard.canActivate(createContext(request, response)),
    ).rejects.toThrow(UnauthorizedException);
    expect(auditService.logWithContext).toHaveBeenCalledTimes(1);
  });

  it('rejects REST keys from MCP even if they carry an MCP scope', async () => {
    const tokenService = {
      verifyAnyJwt: jest.fn().mockResolvedValue({
        type: JwtType.API_KEY,
        apiKeyId: 'api-key-id',
        sub: 'user-id',
        workspaceId: workspace.id,
      }),
    };
    const apiKeyService = {
      validateApiKey: jest.fn().mockResolvedValue({
        user: { id: 'user-id' },
        workspace,
        apiKey: {
          id: 'api-key-id',
          keyType: ApiKeyType.REST,
          scopes: [ApiKeyScope.MCP_READ],
          spaceAccess: { mode: 'all' },
        },
      }),
    };
    const oauthService = {
      resolveWorkspaceFromRequest: jest.fn(),
      getWwwAuthenticateHeader: jest.fn(),
    };
    const auditService = { logWithContext: jest.fn() };
    const guard = new McpAuthGuard(
      tokenService as any,
      apiKeyService as any,
      oauthService as any,
      auditService as any,
    );
    const request: Record<string, any> = {
      headers: { authorization: 'Bearer api-token' },
      raw: { workspace },
      ip: '203.0.113.10',
    };

    await expect(
      guard.canActivate(createContext(request, { header: jest.fn() })),
    ).rejects.toBeInstanceOf(ForbiddenException);

    expect(apiKeyService.validateApiKey).toHaveBeenCalled();
  });
});
