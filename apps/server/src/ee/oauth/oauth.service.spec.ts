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
    const req = {
      raw: { workspace },
      headers: {},
    } as any;

    await expect(service.resolveWorkspaceFromRequest(req)).resolves.toBe(
      workspace,
    );
    expect(workspaceRepo.findFirst).not.toHaveBeenCalled();
    expect(workspaceRepo.findByHostname).not.toHaveBeenCalled();
  });

  it('falls back to the first workspace for self-hosted OAuth requests', async () => {
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

  it('uses forwarded host to resolve cloud workspace metadata requests', async () => {
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
    const req = {
      headers: {
        host: '127.0.0.1:3000',
        'x-forwarded-host': 'Workspace.Example.com:23000',
      },
    } as any;

    await expect(service.resolveWorkspaceFromRequest(req)).resolves.toBe(
      workspace,
    );
    expect(workspaceRepo.findFirst).not.toHaveBeenCalled();
    expect(workspaceRepo.findByHostname).toHaveBeenCalledWith('workspace');
  });

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

    const authMetadata = service.getAuthorizationServerMetadata(workspace, req);
    expect(authMetadata).toMatchObject({
      registration_endpoint:
        'https://docs.example.test:23000/api/oauth/register',
    });
    expect(authMetadata).not.toHaveProperty(
      'client_id_metadata_document_supported',
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

  it('registers ChatGPT dynamic OAuth clients', async () => {
    const oauthClient = {
      id: 'oauth-client-id',
      workspaceId: workspace.id,
      creatorId: null,
      provider: 'chatgpt',
      name: 'ChatGPT',
      clientId: null,
      trustedClientIdHost: 'chatgpt.com',
      allowClientIdMetadataDocuments: true,
      allowedScopes: ['mcp:read', 'mcp:write'],
      isEnabled: true,
      settings: {},
      createdAt: new Date(),
      updatedAt: new Date(),
      deletedAt: null,
    };
    const selectQuery = createSelectQuery(oauthClient);
    const updateQuery = createUpdateQuery();
    const db = {
      selectFrom: jest.fn().mockReturnValue(selectQuery),
      updateTable: jest.fn().mockReturnValue(updateQuery),
    };
    const service = createService({ db });
    const readWriteWorkspace = {
      ...workspace,
      settings: { ai: { mcpMode: 'read-write' } },
    };

    const registration = await service.registerClient(
      {
        redirect_uris: ['https://chatgpt.com/connector/oauth/callback-id'],
        token_endpoint_auth_method: 'none',
        client_name: 'Docmost connector',
        client_uri: 'https://chatgpt.com',
        scope: 'mcp:read,mcp:write',
      },
      readWriteWorkspace,
    );

    expect(registration).toMatchObject({
      client_name: 'Docmost connector',
      client_uri: 'https://chatgpt.com/',
      redirect_uris: ['https://chatgpt.com/connector/oauth/callback-id'],
      grant_types: ['authorization_code', 'refresh_token'],
      response_types: ['code'],
      token_endpoint_auth_method: 'none',
      scope: 'mcp:read mcp:write',
    });
    expect(registration.client_id).toMatch(/^docmost-/);
    expect(updateQuery.set).toHaveBeenCalledWith(
      expect.objectContaining({
        settings: expect.objectContaining({
          dcrClients: [
            expect.objectContaining({
              clientId: registration.client_id,
              clientName: 'Docmost connector',
              redirectUris: ['https://chatgpt.com/connector/oauth/callback-id'],
              scopes: ['mcp:read', 'mcp:write'],
            }),
          ],
        }),
      }),
    );
  });
});

function createSelectQuery(result: any) {
  const query: Record<string, jest.Mock> = {
    selectAll: jest.fn(() => query),
    where: jest.fn(() => query),
    executeTakeFirst: jest.fn().mockResolvedValue(result),
  };
  return query;
}

function createUpdateQuery() {
  const query: Record<string, jest.Mock> = {
    set: jest.fn(() => query),
    where: jest.fn(() => query),
    execute: jest.fn().mockResolvedValue([]),
  };
  return query;
}
