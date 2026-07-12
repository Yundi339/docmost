import { OAuthService } from './oauth.service';
import { DEFAULT_OAUTH_SCOPES, OAuthScope } from './oauth.constants';

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
      overrides.auditService ?? { logWithContext: jest.fn() },
    );
  }

  it('does not grant destructive MCP access by default', () => {
    expect(DEFAULT_OAUTH_SCOPES).toEqual([OAuthScope.MCP_READ]);
    expect(DEFAULT_OAUTH_SCOPES).not.toContain(OAuthScope.MCP_DESTRUCTIVE);
  });

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

  it('uses the request host to resolve cloud workspace metadata requests', async () => {
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
        host: 'Workspace.Example.com:23000',
        'x-forwarded-host': 'attacker.example',
      },
    } as any;

    await expect(service.resolveWorkspaceFromRequest(req)).resolves.toBe(
      workspace,
    );
    expect(workspaceRepo.findFirst).not.toHaveBeenCalled();
    expect(workspaceRepo.findByHostname).toHaveBeenCalledWith('workspace');
  });

  it('uses the configured origin for self-hosted OAuth metadata', () => {
    const service = createService({
      domainService: {
        getUrl: jest.fn().mockReturnValue('https://docs.example.test:23000'),
      },
    });
    const req = {
      protocol: 'http',
      headers: {
        host: '127.0.0.1:3006',
        'x-forwarded-proto': 'https',
        'x-forwarded-host': 'attacker.example',
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
    const auditService = { logWithContext: jest.fn() };
    const service = createService({ db, auditService });
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
        grant_types: ['authorization_code'],
        scope: 'mcp:read,mcp:write',
      },
      readWriteWorkspace,
    );

    expect(registration).toMatchObject({
      client_name: 'Docmost connector',
      client_uri: 'https://chatgpt.com/',
      redirect_uris: ['https://chatgpt.com/connector/oauth/callback-id'],
      grant_types: ['authorization_code'],
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
              grantTypes: ['authorization_code'],
              responseTypes: ['code'],
              tokenEndpointAuthMethod: 'none',
              scopes: ['mcp:read', 'mcp:write'],
            }),
          ],
        }),
      }),
    );
    expect(auditService.logWithContext).toHaveBeenCalledWith(
      expect.objectContaining({
        event: 'mcp.oauth_client_registered',
        metadata: expect.objectContaining({
          clientName: 'Docmost connector',
          scopes: ['mcp:read', 'mcp:write'],
        }),
      }),
      expect.objectContaining({
        workspaceId: 'workspace-id',
        actorType: 'system',
      }),
    );
  });

  it('rejects destructive client registration in read-only MCP mode', async () => {
    const oauthClient = {
      id: 'oauth-client-id',
      workspaceId: workspace.id,
      creatorId: null,
      provider: 'chatgpt',
      name: 'ChatGPT',
      clientId: null,
      trustedClientIdHost: 'chatgpt.com',
      allowClientIdMetadataDocuments: true,
      allowedScopes: [
        OAuthScope.MCP_READ,
        OAuthScope.MCP_WRITE,
        OAuthScope.MCP_DESTRUCTIVE,
      ],
      isEnabled: true,
      settings: {},
      createdAt: new Date(),
      updatedAt: new Date(),
      deletedAt: null,
    };
    const db = {
      selectFrom: jest.fn().mockReturnValue(createSelectQuery(oauthClient)),
    };
    const service = createService({ db });

    await expect(
      service.registerClient(
        {
          redirect_uris: ['https://chatgpt.com/connector/oauth/callback-id'],
          scope: OAuthScope.MCP_DESTRUCTIVE,
        },
        workspace,
      ),
    ).rejects.toThrow('MCP is enabled in read-only mode');
  });

  it('limits the number of dynamic-registration redirect URIs', async () => {
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
    const db = {
      selectFrom: jest.fn().mockReturnValue(createSelectQuery(oauthClient)),
    };
    const service = createService({ db });

    await expect(
      service.registerClient(
        {
          redirect_uris: Array.from(
            { length: 11 },
            (_, index) =>
              `https://chatgpt.com/connector/oauth/callback-${index}`,
          ),
        },
        workspace,
      ),
    ).rejects.toThrow('redirect_uris cannot contain more than 10 entries');
  });

  it('audits OAuth authorization without storing authorization codes', async () => {
    const insertQuery = createInsertQuery();
    const auditService = { logWithContext: jest.fn() };
    const service = createService({
      db: { insertInto: jest.fn().mockReturnValue(insertQuery) },
      auditService,
    });
    jest.spyOn(service as any, 'resolveAuthorizeRequest').mockResolvedValue({
      oauthClient: { id: 'oauth-client-id', provider: 'chatgpt' },
      clientId: 'docmost-client-id',
      clientName: 'Docmost connector',
      redirectUri: 'https://chatgpt.com/connector/oauth/callback-id',
      resource: 'https://docs.example.test/mcp',
      scopes: ['mcp:read'],
      state: 'state',
      codeChallenge: 'challenge',
      codeChallengeMethod: 'S256',
    });
    jest
      .spyOn(service as any, 'upsertAuthorization')
      .mockResolvedValue({ id: 'authorization-id' });

    await service.approveAuthorization(
      {} as any,
      { id: 'user-id' } as any,
      workspace,
      {
        ip: '203.0.113.10',
        headers: { 'user-agent': 'test-agent' },
      } as any,
    );

    expect(auditService.logWithContext).toHaveBeenCalledWith(
      expect.objectContaining({
        event: 'mcp.oauth_authorized',
        resourceId: 'authorization-id',
        metadata: expect.objectContaining({
          clientName: 'Docmost connector',
          redirectHost: 'chatgpt.com',
          authorizationUserId: 'user-id',
        }),
      }),
      expect.objectContaining({
        workspaceId: 'workspace-id',
        actorId: 'user-id',
        actorType: 'user',
      }),
    );
    expect(
      JSON.stringify(auditService.logWithContext.mock.calls),
    ).not.toContain('challenge');
  });

  it('audits an owner revoking another user OAuth authorization', async () => {
    const authorization = {
      id: 'authorization-id',
      userId: 'member-id',
      provider: 'chatgpt',
      clientId: 'docmost-client-id',
      clientName: 'Docmost connector',
      redirectUri: 'https://chatgpt.com/connector/oauth/callback-id',
      scopes: ['mcp:read'],
    };
    const auditService = { logWithContext: jest.fn() };
    const service = createService({
      db: {
        selectFrom: jest.fn().mockReturnValue(createSelectQuery(authorization)),
        transaction: jest.fn().mockReturnValue({
          execute: async (callback: (trx: any) => Promise<void>) =>
            callback({
              updateTable: jest.fn().mockReturnValue(createUpdateQuery()),
            }),
        }),
      },
      auditService,
    });

    await service.revokeAuthorization(
      authorization.id,
      workspace,
      { id: 'owner-id', role: 'owner' } as any,
      {
        ip: '203.0.113.11',
        headers: { 'user-agent': 'owner-agent' },
      } as any,
    );

    expect(auditService.logWithContext).toHaveBeenCalledWith(
      expect.objectContaining({
        event: 'mcp.oauth_revoked',
        resourceId: authorization.id,
        metadata: expect.objectContaining({
          authorizationUserId: 'member-id',
          revokedByAdmin: true,
        }),
      }),
      expect.objectContaining({ actorId: 'owner-id', actorType: 'user' }),
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

function createInsertQuery() {
  const query: Record<string, jest.Mock> = {
    values: jest.fn(() => query),
    execute: jest.fn().mockResolvedValue([]),
  };
  return query;
}
