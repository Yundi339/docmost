import { OAuthMetadataService } from './oauth-metadata.service';

describe('OAuthMetadataService', () => {
  const workspace = {
    id: 'workspace-id',
    hostname: 'workspace',
  } as any;

  function createService(overrides: Record<string, any> = {}) {
    return new OAuthMetadataService(
      overrides.workspaceRepo ?? ({} as any),
      overrides.domainService ?? {
        getUrl: jest.fn().mockReturnValue('http://localhost:3000'),
      },
      overrides.environmentService ?? {
        isSelfHosted: jest.fn().mockReturnValue(true),
        isCloud: jest.fn().mockReturnValue(false),
      },
    );
  }

  it('uses workspace already attached to the raw request', async () => {
    const workspaceRepo = {
      findFirst: jest.fn(),
      findByHostname: jest.fn(),
    };
    const service = createService({ workspaceRepo });

    await expect(
      service.resolveWorkspaceFromRequest({ raw: { workspace } } as any),
    ).resolves.toBe(workspace);
    expect(workspaceRepo.findFirst).not.toHaveBeenCalled();
    expect(workspaceRepo.findByHostname).not.toHaveBeenCalled();
  });

  it('falls back to the first workspace only in self-hosted mode', async () => {
    const workspaceRepo = {
      findFirst: jest.fn().mockResolvedValue(workspace),
      findByHostname: jest.fn(),
    };
    const service = createService({ workspaceRepo });

    await expect(
      service.resolveWorkspaceFromRequest({ headers: {} } as any),
    ).resolves.toBe(workspace);
    expect(workspaceRepo.findFirst).toHaveBeenCalledTimes(1);
    expect(workspaceRepo.findByHostname).not.toHaveBeenCalled();
  });

  it('uses request host for cloud workspace lookup without trusting forwarded host', async () => {
    const workspaceRepo = {
      findFirst: jest.fn(),
      findByHostname: jest.fn().mockResolvedValue(workspace),
    };
    const service = createService({
      workspaceRepo,
      environmentService: {
        isSelfHosted: jest.fn().mockReturnValue(false),
        isCloud: jest.fn().mockReturnValue(true),
      },
    });

    await expect(
      service.resolveWorkspaceFromRequest({
        headers: {
          host: 'Workspace.Example.test:23000',
          'x-forwarded-host': 'attacker.example.test',
        },
      } as any),
    ).resolves.toBe(workspace);
    expect(workspaceRepo.findByHostname).toHaveBeenCalledWith('workspace');
  });

  it('uses the configured canonical origin for all public metadata', () => {
    const service = createService({
      domainService: {
        getUrl: jest.fn().mockReturnValue('https://docs.example.test:23000'),
      },
    });
    const req = {
      protocol: 'http',
      headers: {
        host: '127.0.0.1:3000',
        'x-forwarded-host': 'attacker.example.test',
      },
    } as any;

    expect(service.getProtectedResourceMetadata(workspace, req)).toMatchObject({
      resource: 'https://docs.example.test:23000/mcp',
      authorization_servers: ['https://docs.example.test:23000'],
    });
    expect(
      service.getAuthorizationServerMetadata(workspace, req),
    ).toMatchObject({
      issuer: 'https://docs.example.test:23000',
      registration_endpoint:
        'https://docs.example.test:23000/api/oauth/register',
    });
    expect(service.getWwwAuthenticateHeader(workspace, undefined, req)).toBe(
      'Bearer resource_metadata="https://docs.example.test:23000/.well-known/oauth-protected-resource/mcp", scope="mcp:read"',
    );
  });
});
