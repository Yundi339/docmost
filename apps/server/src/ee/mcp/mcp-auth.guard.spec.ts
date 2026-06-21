import { UnauthorizedException } from '@nestjs/common';
import { McpAuthGuard } from './mcp-auth.guard';

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
    const guard = new McpAuthGuard({} as any, {} as any, oauthService as any);
    const request: Record<string, any> = {
      headers: {},
      raw: {},
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
  });
});
