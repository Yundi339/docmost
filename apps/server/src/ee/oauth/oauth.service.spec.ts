import { OAuthService } from './oauth.service';

describe('OAuthService public origin', () => {
  const workspace = {
    id: 'workspace-id',
    hostname: 'workspace',
    settings: { ai: { mcpMode: 'read-only' } },
  } as any;

  function createService(overrides: Record<string, any> = {}) {
    return new OAuthService(
      overrides.db ?? ({} as any),
      overrides.tokenService ?? ({} as any),
      overrides.userRepo ?? ({} as any),
      overrides.workspaceRepo ?? ({} as any),
      overrides.domainService ?? {
        getUrl: jest.fn().mockReturnValue('http://localhost:3000'),
      },
      overrides.environmentService ?? {
        isSelfHosted: jest.fn().mockReturnValue(true),
      },
    );
  }

  it('uses forwarded request origin for self-hosted OAuth metadata', () => {
    const service = createService();
    const req = {
      protocol: 'http',
      headers: {
        host: '127.0.0.1:3006',
        'x-forwarded-proto': 'https',
        'x-forwarded-host': 'docs.example.test:23000',
      },
    } as any;

    const metadata = service.getProtectedResourceMetadata(workspace, req);

    expect(metadata.resource).toBe('https://docs.example.test:23000/mcp');
    expect(metadata.authorization_servers).toEqual([
      'https://docs.example.test:23000',
    ]);
    expect(service.getWwwAuthenticateHeader(workspace, undefined, req)).toBe(
      'Bearer resource_metadata="https://docs.example.test:23000/.well-known/oauth-protected-resource/mcp", scope="mcp:read"',
    );
  });

  it('keeps configured workspace domain for cloud OAuth metadata', () => {
    const service = createService({
      domainService: {
        getUrl: jest.fn().mockReturnValue('https://workspace.example.com'),
      },
      environmentService: {
        isSelfHosted: jest.fn().mockReturnValue(false),
      },
    });
    const req = {
      protocol: 'http',
      headers: {
        'x-forwarded-proto': 'https',
        'x-forwarded-host': 'spoofed.example.com',
      },
    } as any;

    const metadata = service.getProtectedResourceMetadata(workspace, req);

    expect(metadata.resource).toBe('https://workspace.example.com/mcp');
    expect(metadata.authorization_servers).toEqual([
      'https://workspace.example.com',
    ]);
  });
});
