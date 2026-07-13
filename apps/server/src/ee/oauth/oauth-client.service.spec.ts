import { OAuthClientService } from './oauth-client.service';
import { OAuthScope } from './oauth.constants';
import { ChatGptOAuthClientProvider } from './providers/chatgpt-oauth-client.provider';
import { OAuthProviderRegistry } from './providers/oauth-provider.registry';

describe('OAuthClientService', () => {
  const workspace = {
    id: 'workspace-id',
    hostname: 'workspace',
    settings: { ai: { mcpMode: 'read-write' } },
  } as any;
  const oauthClient = {
    id: 'oauth-client-id',
    workspaceId: workspace.id,
    creatorId: null,
    provider: 'chatgpt',
    name: 'ChatGPT',
    clientId: null,
    trustedClientIdHost: 'chatgpt.com',
    allowClientIdMetadataDocuments: true,
    allowedScopes: [OAuthScope.MCP_READ, OAuthScope.MCP_WRITE],
    isEnabled: true,
    settings: {},
    createdAt: new Date('2026-07-13T00:00:00Z'),
    updatedAt: new Date('2026-07-13T00:00:00Z'),
    deletedAt: null,
  };

  function createService(
    db: any,
    auditService = { logWithContext: jest.fn() },
  ) {
    const provider = new ChatGptOAuthClientProvider();
    return {
      service: new OAuthClientService(
        db,
        {
          getIssuer: jest.fn().mockReturnValue('https://docs.example.test'),
          getMcpResourceUrl: jest
            .fn()
            .mockReturnValue('https://docs.example.test/mcp'),
        } as any,
        new OAuthProviderRegistry([provider]),
        auditService as any,
      ),
      auditService,
    };
  }

  it('registers a public client in a transaction and audits metadata only', async () => {
    const registeredRow = {
      id: 'registration-id',
      oauthClientId: oauthClient.id,
      clientId: 'docmost-generated-client',
      clientName: 'Docmost connector',
      clientUri: 'https://chatgpt.com/',
      redirectUris: ['https://chatgpt.com/connector/oauth/callback-id'],
      grantTypes: ['authorization_code', 'refresh_token'],
      responseTypes: ['code'],
      tokenEndpointAuthMethod: 'none',
      scopes: [OAuthScope.MCP_READ, OAuthScope.MCP_WRITE],
      createdAt: new Date('2026-07-13T00:00:00Z'),
      updatedAt: new Date('2026-07-13T00:00:00Z'),
    };
    const oauthClientQuery = createQuery(oauthClient);
    const registrationsQuery = createQuery(undefined, []);
    const insertQuery = createQuery(registeredRow);
    const trx = {
      selectFrom: jest
        .fn()
        .mockReturnValueOnce(oauthClientQuery)
        .mockReturnValueOnce(registrationsQuery),
      insertInto: jest.fn().mockReturnValue(insertQuery),
    };
    const db = createTransactionDb(trx);
    const { service, auditService } = createService(db);

    const result = await service.registerClient(
      {
        redirect_uris: registeredRow.redirectUris,
        client_name: registeredRow.clientName,
        client_uri: 'https://chatgpt.com',
        scope: 'mcp:read mcp:write',
      },
      workspace,
    );

    expect(oauthClientQuery.forUpdate).toHaveBeenCalledTimes(1);
    expect(insertQuery.values).toHaveBeenCalledWith(
      expect.objectContaining({
        oauthClientId: oauthClient.id,
        redirectUris: registeredRow.redirectUris,
        scopes: [OAuthScope.MCP_READ, OAuthScope.MCP_WRITE],
      }),
    );
    expect(result).toMatchObject({
      client_id: registeredRow.clientId,
      redirect_uris: registeredRow.redirectUris,
      token_endpoint_auth_method: 'none',
    });
    expect(auditService.logWithContext).toHaveBeenCalledWith(
      expect.objectContaining({
        metadata: expect.objectContaining({
          clientId: registeredRow.clientId,
          redirectHosts: ['chatgpt.com'],
          existingRegistration: false,
        }),
      }),
      expect.objectContaining({ actorType: 'system' }),
    );
    expect(
      JSON.stringify(auditService.logWithContext.mock.calls),
    ).not.toContain('access_token');
  });

  it('updates an existing registration with the same redirect URI set', async () => {
    const existing = {
      id: 'registration-id',
      oauthClientId: oauthClient.id,
      clientId: 'docmost-existing-client',
      clientName: 'Old name',
      clientUri: null,
      redirectUris: [
        'https://chatgpt.com/connector/oauth/callback-b',
        'https://chatgpt.com/connector/oauth/callback-a',
      ],
      grantTypes: ['authorization_code'],
      responseTypes: ['code'],
      tokenEndpointAuthMethod: 'none',
      scopes: [OAuthScope.MCP_READ],
      createdAt: new Date('2026-07-13T00:00:00Z'),
      updatedAt: new Date('2026-07-13T00:00:00Z'),
    };
    const updated = {
      ...existing,
      clientName: 'New name',
      updatedAt: new Date('2026-07-13T01:00:00Z'),
    };
    const updateQuery = createQuery(updated);
    const trx = {
      selectFrom: jest
        .fn()
        .mockReturnValueOnce(createQuery(oauthClient))
        .mockReturnValueOnce(createQuery(undefined, [existing])),
      updateTable: jest.fn().mockReturnValue(updateQuery),
    };
    const { service } = createService(createTransactionDb(trx));

    const result = await service.registerClient(
      {
        redirect_uris: [...existing.redirectUris].reverse(),
        client_name: 'New name',
      },
      workspace,
    );

    expect(trx.updateTable).toHaveBeenCalledWith('oauthRegisteredClients');
    expect(result.client_id).toBe(existing.clientId);
  });

  it('rejects a 51st registration instead of deleting an active client', async () => {
    const registrations = Array.from({ length: 50 }, (_, index) => ({
      id: `registration-${index}`,
      redirectUris: [`https://chatgpt.com/connector/oauth/existing-${index}`],
    }));
    const trx = {
      selectFrom: jest
        .fn()
        .mockReturnValueOnce(createQuery(oauthClient))
        .mockReturnValueOnce(createQuery(undefined, registrations)),
      insertInto: jest.fn(),
    };
    const { service } = createService(createTransactionDb(trx));

    await expect(
      service.registerClient(
        {
          redirect_uris: ['https://chatgpt.com/connector/oauth/new-client'],
        },
        workspace,
      ),
    ).rejects.toThrow('OAuth client registration limit has been reached');
    expect(trx.insertInto).not.toHaveBeenCalled();
  });

  it('rejects write registration when the workspace is read-only', async () => {
    const { service } = createService({ transaction: jest.fn() });

    await expect(
      service.registerClient(
        {
          redirect_uris: ['https://chatgpt.com/connector/oauth/callback-id'],
          scope: OAuthScope.MCP_WRITE,
        },
        {
          ...workspace,
          settings: { ai: { mcpMode: 'read-only' } },
        },
      ),
    ).rejects.toThrow('MCP is enabled in read-only mode');
  });

  it('does not fetch metadata from an untrusted host or explicit port', async () => {
    const { service } = createService({});
    const fetchSpy = jest.spyOn(global, 'fetch');

    await expect(
      service.resolveClientMetadata(
        oauthClient as any,
        'https://attacker.example.test/client.json',
      ),
    ).rejects.toThrow('OAuth client metadata host is not trusted');
    await expect(
      service.resolveClientMetadata(
        oauthClient as any,
        'https://chatgpt.com:444/client.json',
      ),
    ).rejects.toThrow('OAuth client metadata host is not trusted');
    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  });

  it('rejects redirected, oversized, and invalid metadata documents', async () => {
    const { service } = createService({});
    const fetchSpy = jest.spyOn(global, 'fetch');

    fetchSpy.mockResolvedValueOnce({ ok: false } as Response);
    await expect(
      service.resolveClientMetadata(
        oauthClient as any,
        'https://chatgpt.com/client.json',
      ),
    ).rejects.toThrow('OAuth client metadata could not be fetched');

    fetchSpy.mockResolvedValueOnce({
      ok: true,
      text: async () => 'x'.repeat(64 * 1024 + 1),
    } as Response);
    await expect(
      service.resolveClientMetadata(
        oauthClient as any,
        'https://chatgpt.com/client.json',
      ),
    ).rejects.toThrow('OAuth client metadata is too large');

    fetchSpy.mockResolvedValueOnce({
      ok: true,
      text: async () => 'not-json',
    } as Response);
    await expect(
      service.resolveClientMetadata(
        oauthClient as any,
        'https://chatgpt.com/client.json',
      ),
    ).rejects.toThrow('OAuth client metadata is invalid JSON');
    expect(fetchSpy.mock.calls[0][1]).toMatchObject({ redirect: 'error' });
    fetchSpy.mockRestore();
  });
});

function createTransactionDb(trx: any) {
  return {
    transaction: jest.fn().mockReturnValue({
      execute: (callback: (transaction: any) => unknown) => callback(trx),
    }),
  };
}

function createQuery(first?: any, rows: any[] = []) {
  const query: Record<string, jest.Mock> = {};
  for (const method of [
    'selectAll',
    'where',
    'orderBy',
    'forUpdate',
    'set',
    'values',
    'returningAll',
  ]) {
    query[method] = jest.fn(() => query);
  }
  query.executeTakeFirst = jest.fn().mockResolvedValue(first);
  query.executeTakeFirstOrThrow = jest.fn().mockResolvedValue(first);
  query.execute = jest.fn().mockResolvedValue(rows);
  return query;
}
