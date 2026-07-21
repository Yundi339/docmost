import { OAuthAuthorizationService } from './oauth-authorization.service';
import { buildAuthorizationKey } from './oauth-protocol.utils';
import { ChatGptOAuthClientProvider } from './providers/chatgpt-oauth-client.provider';
import { OAuthProviderRegistry } from './providers/oauth-provider.registry';

describe('OAuthAuthorizationService', () => {
  const workspace = {
    id: 'workspace-id',
    hostname: 'workspace',
    settings: { ai: { mcpMode: 'read-write' } },
  } as any;
  const user = {
    id: 'user-id',
    name: 'Test User',
    email: 'user@example.test',
    role: 'member',
  } as any;
  const oauthClient = {
    id: 'oauth-client-id',
    workspaceId: workspace.id,
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
  } as any;
  const registeredClient = {
    clientId: 'docmost-client-id',
    clientName: 'Docmost connector',
    redirectUris: ['https://chatgpt.com/connector/oauth/callback-id'],
    grantTypes: ['authorization_code'],
    responseTypes: ['code'],
    tokenEndpointAuthMethod: 'none' as const,
    scopes: ['mcp:read', 'mcp:write'],
    createdAt: new Date().toISOString(),
  };

  function createService(
    db: any,
    auditService = { logWithContext: jest.fn() },
    credentialRevocation = {
      lockActiveUserForIssuance: jest.fn().mockResolvedValue(user),
    },
  ) {
    const provider = new ChatGptOAuthClientProvider();
    const clientService = {
      getEnabledDefaultClient: jest.fn().mockResolvedValue(oauthClient),
      assertRedirectUri: jest.fn((client, uri) =>
        provider.assertRedirectUri(uri),
      ),
      resolveClientMetadata: jest.fn().mockResolvedValue(undefined),
      getRegisteredDcrClient: jest.fn().mockResolvedValue(registeredClient),
    };
    return {
      service: new OAuthAuthorizationService(
        db,
        clientService as any,
        {
          getMcpResourceUrl: jest
            .fn()
            .mockReturnValue('https://docs.example.test/mcp'),
        } as any,
        new OAuthProviderRegistry([provider]),
        {
          normalizeSelection: jest
            .fn()
            .mockResolvedValue({ mode: 'all', spaceIds: [] }),
          replaceOAuthAuthorizationAccess: jest.fn(),
          addOAuthViews: jest.fn(async (records) =>
            records.map((record) => ({
              ...record,
              spaceAccess: {
                mode: 'all',
                spaces: [],
                selectedCount: 0,
                effectiveCount: 1,
                status: 'active',
              },
            })),
          ),
          listSelectableSpaces: jest.fn().mockResolvedValue([]),
        } as any,
        credentialRevocation as any,
        auditService as any,
      ),
      clientService,
      auditService,
      credentialRevocation,
    };
  }

  it('atomically upserts one active authorization and issues a hashed code', async () => {
    const authorization = {
      id: 'authorization-id',
      oauthClientId: oauthClient.id,
    };
    const authorizationInsert = createInsertQuery(authorization);
    const codeInsert = createInsertQuery(undefined);
    const trx = {
      insertInto: jest
        .fn()
        .mockReturnValueOnce(authorizationInsert.query)
        .mockReturnValueOnce(codeInsert.query),
    };
    const db = {
      selectFrom: jest.fn().mockReturnValue(createSelectQuery(undefined)),
      transaction: jest.fn().mockReturnValue({
        execute: (callback: (transaction: any) => unknown) => callback(trx),
      }),
    };
    const { service, auditService, credentialRevocation } = createService(db);

    const result = await service.approveAuthorization(
      {
        response_type: 'code',
        client_id: registeredClient.clientId,
        redirect_uri: registeredClient.redirectUris[0],
        resource: 'https://docs.example.test/mcp',
        scope: 'mcp:read',
        state: 'state-value',
        code_challenge: 'pkce-challenge',
        code_challenge_method: 'S256',
      },
      user,
      workspace,
    );

    const expectedKey = buildAuthorizationKey(
      registeredClient.clientId,
      'https://docs.example.test/mcp',
    );
    expect(authorizationInsert.query.values).toHaveBeenCalledWith(
      expect.objectContaining({
        authorizationKey: expectedKey,
        workspaceId: workspace.id,
        userId: user.id,
      }),
    );
    expect(authorizationInsert.conflict.columns).toHaveBeenCalledWith([
      'workspaceId',
      'userId',
      'authorizationKey',
    ]);
    expect(authorizationInsert.conflict.where).toHaveBeenCalledWith(
      'revokedAt',
      'is',
      null,
    );
    expect(credentialRevocation.lockActiveUserForIssuance).toHaveBeenCalledWith(
      user.id,
      workspace.id,
      trx,
    );

    const codeValues = codeInsert.query.values.mock.calls[0][0];
    expect(codeValues.codeHash).toMatch(/^[a-f0-9]{64}$/);
    expect(codeValues).not.toHaveProperty('code');
    expect(result.redirectUri).toContain('code=');
    expect(result.redirectUri).toContain('state=state-value');
    expect(
      JSON.stringify(auditService.logWithContext.mock.calls),
    ).not.toContain(codeValues.codeHash);
    expect(
      JSON.stringify(auditService.logWithContext.mock.calls),
    ).not.toContain('pkce-challenge');
  });

  it('rejects an unregistered redirect URI before writing authorization data', async () => {
    const db = { insertInto: jest.fn() };
    const { service, clientService } = createService(db);
    clientService.getRegisteredDcrClient.mockResolvedValue({
      ...registeredClient,
      redirectUris: ['https://chatgpt.com/connector/oauth/other'],
    });

    await expect(
      service.approveAuthorization(
        {
          response_type: 'code',
          client_id: registeredClient.clientId,
          redirect_uri: registeredClient.redirectUris[0],
          resource: 'https://docs.example.test/mcp',
          scope: 'mcp:read',
          code_challenge: 'pkce-challenge',
          code_challenge_method: 'S256',
        },
        user,
        workspace,
      ),
    ).rejects.toThrow('OAuth redirect_uri is not registered');
    expect(db.insertInto).not.toHaveBeenCalled();
  });

  it('revokes an authorization and all live refresh tokens in one transaction', async () => {
    const authorization = {
      id: 'authorization-id',
      workspaceId: workspace.id,
      userId: user.id,
      provider: 'chatgpt',
      clientId: registeredClient.clientId,
      clientName: registeredClient.clientName,
      redirectUri: registeredClient.redirectUris[0],
      scopes: ['mcp:read'],
    };
    const authorizationUpdate = createMutationQuery();
    const refreshUpdate = createMutationQuery();
    const trx = {
      updateTable: jest
        .fn()
        .mockReturnValueOnce(authorizationUpdate)
        .mockReturnValueOnce(refreshUpdate),
    };
    const db = {
      selectFrom: jest.fn().mockReturnValue(createSelectQuery(authorization)),
      transaction: jest.fn().mockReturnValue({
        execute: (callback: (transaction: any) => unknown) => callback(trx),
      }),
    };
    const { service } = createService(db);

    await service.revokeAuthorization(authorization.id, workspace, user);

    expect(trx.updateTable).toHaveBeenNthCalledWith(1, 'oauthAuthorizations');
    expect(trx.updateTable).toHaveBeenNthCalledWith(2, 'oauthRefreshTokens');
    expect(refreshUpdate.where).toHaveBeenCalledWith(
      'authorizationId',
      '=',
      authorization.id,
    );
  });
});

function createInsertQuery(result: any) {
  const conflict: Record<string, jest.Mock> = {};
  for (const method of ['columns', 'where']) {
    conflict[method] = jest.fn(() => conflict);
  }
  conflict.doUpdateSet = jest.fn(() => conflict);

  const query: Record<string, jest.Mock> = {};
  query.values = jest.fn(() => query);
  query.onConflict = jest.fn((callback) => {
    callback(conflict);
    return query;
  });
  query.returningAll = jest.fn(() => query);
  query.executeTakeFirstOrThrow = jest.fn().mockResolvedValue(result);
  query.execute = jest.fn().mockResolvedValue([]);
  return { query, conflict };
}

function createSelectQuery(result: any) {
  const query: Record<string, jest.Mock> = {};
  for (const method of ['selectAll', 'where']) {
    query[method] = jest.fn(() => query);
  }
  query.executeTakeFirst = jest.fn().mockResolvedValue(result);
  return query;
}

function createMutationQuery() {
  const query: Record<string, jest.Mock> = {};
  for (const method of ['set', 'where']) {
    query[method] = jest.fn(() => query);
  }
  query.execute = jest.fn().mockResolvedValue([]);
  return query;
}
