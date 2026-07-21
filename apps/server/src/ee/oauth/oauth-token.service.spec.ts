import { createHash } from 'crypto';
import { OAuthTokenService } from './oauth-token.service';

describe('OAuthTokenService', () => {
  const workspace = {
    id: 'workspace-id',
    hostname: 'workspace',
    settings: { ai: { mcpMode: 'read-write' } },
  } as any;
  const user = {
    id: 'user-id',
    workspaceId: workspace.id,
    deactivatedAt: null,
    deletedAt: null,
  } as any;
  const resource = 'https://docs.example.test/mcp';
  const clientId = 'docmost-client-id';

  function createService(overrides: Record<string, any> = {}) {
    const tokenService = overrides.tokenService ?? {
      generateMcpOAuthAccessToken: jest.fn().mockResolvedValue('access-token'),
    };
    const userRepo = overrides.userRepo ?? {
      findById: jest.fn().mockResolvedValue(user),
    };
    const credentialRevocation = overrides.credentialRevocation ?? {
      lockActiveUserForIssuance: jest.fn().mockResolvedValue(user),
    };
    return {
      service: new OAuthTokenService(
        overrides.db ?? ({} as any),
        tokenService,
        userRepo,
        overrides.workspaceRepo ?? {
          findActiveById: jest.fn().mockResolvedValue(workspace),
        },
        overrides.metadataService ?? {
          getMcpResourceUrl: jest.fn().mockReturnValue(resource),
        },
        overrides.credentialSpaceAccess ?? {
          resolveOAuthAuthorizationAccess: jest.fn().mockResolvedValue({
            mode: 'all',
            selectedSpaceIds: [],
            effectiveSpaceIds: ['space-id'],
            revision: 'revision-1',
          }),
        },
        credentialRevocation,
      ),
      tokenService,
      userRepo,
      credentialRevocation,
    };
  }

  it('exchanges a valid authorization code once with PKCE', async () => {
    const verifier = 'test-verifier-with-sufficient-entropy';
    const challenge = createHash('sha256').update(verifier).digest('base64url');
    const codeRow = createAuthorizationCode({ codeChallenge: challenge });
    const authorization = createAuthorization();
    const consumedCode = createMutationQuery({ id: codeRow.id });
    const refreshInsert = createMutationQuery();
    const trx = {
      updateTable: jest.fn().mockReturnValue(consumedCode),
      insertInto: jest.fn().mockReturnValue(refreshInsert),
    };
    const db = {
      selectFrom: jest
        .fn()
        .mockReturnValueOnce(createSelectQuery(codeRow))
        .mockReturnValueOnce(createSelectQuery(authorization)),
      transaction: createTransaction(trx),
    };
    const { service, tokenService, credentialRevocation } = createService({
      db,
    });

    const result = await service.exchangeToken(
      {
        grant_type: 'authorization_code',
        code: 'plain-authorization-code',
        client_id: clientId,
        redirect_uri: codeRow.redirectUri,
        code_verifier: verifier,
        resource,
      },
      workspace,
    );

    expect(consumedCode.where).toHaveBeenCalledWith('consumedAt', 'is', null);
    expect(refreshInsert.values).toHaveBeenCalledWith(
      expect.objectContaining({
        authorizationId: authorization.id,
        clientId,
        resource,
      }),
    );
    expect(credentialRevocation.lockActiveUserForIssuance).toHaveBeenCalledWith(
      user.id,
      workspace.id,
      trx,
    );
    expect(tokenService.generateMcpOAuthAccessToken).toHaveBeenCalledWith(
      expect.objectContaining({
        authorizationId: authorization.id,
        clientId,
        resource,
        scopes: ['mcp:read', 'mcp:write'],
      }),
    );
    expect(result).toMatchObject({
      access_token: 'access-token',
      token_type: 'Bearer',
      scope: 'mcp:read mcp:write',
    });
    expect(result.refresh_token).toBeTruthy();
  });

  it('rejects PKCE failure before consuming the authorization code', async () => {
    const codeRow = createAuthorizationCode({
      codeChallenge: createHash('sha256')
        .update('correct-verifier')
        .digest('base64url'),
    });
    const db = {
      selectFrom: jest.fn().mockReturnValue(createSelectQuery(codeRow)),
      transaction: jest.fn(),
    };
    const { service } = createService({ db });

    await expect(
      service.exchangeToken(
        {
          grant_type: 'authorization_code',
          code: 'plain-authorization-code',
          client_id: clientId,
          redirect_uri: codeRow.redirectUri,
          code_verifier: 'wrong-verifier',
          resource,
        },
        workspace,
      ),
    ).rejects.toMatchObject({ errorCode: 'invalid_grant' });
    expect(db.transaction).not.toHaveBeenCalled();
  });

  it('rejects a replay when conditional code consumption loses the race', async () => {
    const verifier = 'test-verifier';
    const codeRow = createAuthorizationCode({
      codeChallenge: createHash('sha256').update(verifier).digest('base64url'),
    });
    const trx = {
      updateTable: jest.fn().mockReturnValue(createMutationQuery(undefined)),
      insertInto: jest.fn(),
    };
    const db = {
      selectFrom: jest
        .fn()
        .mockReturnValueOnce(createSelectQuery(codeRow))
        .mockReturnValueOnce(createSelectQuery(createAuthorization())),
      transaction: createTransaction(trx),
    };
    const { service } = createService({ db });

    await expect(
      service.exchangeToken(
        {
          grant_type: 'authorization_code',
          code: 'plain-authorization-code',
          client_id: clientId,
          redirect_uri: codeRow.redirectUri,
          code_verifier: verifier,
          resource,
        },
        workspace,
      ),
    ).rejects.toMatchObject({ errorCode: 'invalid_grant' });
    expect(trx.insertInto).not.toHaveBeenCalled();
  });

  it('rejects an authorization code whose authorization identity differs', async () => {
    const verifier = 'test-verifier';
    const codeRow = createAuthorizationCode({
      codeChallenge: createHash('sha256').update(verifier).digest('base64url'),
    });
    const db = {
      selectFrom: jest
        .fn()
        .mockReturnValueOnce(createSelectQuery(codeRow))
        .mockReturnValueOnce(
          createSelectQuery(createAuthorization({ userId: 'other-user-id' })),
        ),
      transaction: jest.fn(),
    };
    const { service } = createService({ db });

    await expect(
      service.exchangeToken(
        {
          grant_type: 'authorization_code',
          code: 'plain-authorization-code',
          client_id: clientId,
          redirect_uri: codeRow.redirectUri,
          code_verifier: verifier,
          resource,
        },
        workspace,
      ),
    ).rejects.toMatchObject({ errorCode: 'invalid_grant' });
    expect(db.transaction).not.toHaveBeenCalled();
  });

  it('rotates a refresh token and permits scope narrowing only', async () => {
    const refreshRow = createRefreshToken();
    const authorization = createAuthorization();
    const revokeQuery = createMutationQuery({ id: refreshRow.id });
    const replacementQuery = createMutationQuery({ id: 'replacement-id' });
    const linkQuery = createMutationQuery();
    const trx = {
      updateTable: jest
        .fn()
        .mockReturnValueOnce(revokeQuery)
        .mockReturnValueOnce(linkQuery),
      insertInto: jest.fn().mockReturnValue(replacementQuery),
    };
    const db = {
      selectFrom: jest
        .fn()
        .mockReturnValueOnce(createSelectQuery(refreshRow))
        .mockReturnValueOnce(createSelectQuery(authorization)),
      transaction: createTransaction(trx),
    };
    const { service, tokenService } = createService({ db });

    const result = await service.exchangeToken(
      {
        grant_type: 'refresh_token',
        refresh_token: 'plain-refresh-token',
        client_id: clientId,
        resource,
        scope: 'mcp:read',
      },
      workspace,
    );

    expect(revokeQuery.where).toHaveBeenCalledWith('revokedAt', 'is', null);
    expect(replacementQuery.values).toHaveBeenCalledWith(
      expect.objectContaining({ scopes: ['mcp:read'] }),
    );
    expect(linkQuery.set).toHaveBeenCalledWith({
      replacedById: 'replacement-id',
    });
    expect(tokenService.generateMcpOAuthAccessToken).toHaveBeenCalledWith(
      expect.objectContaining({ scopes: ['mcp:read'] }),
    );
    expect(result.scope).toBe('mcp:read');
  });

  it('rejects refresh-token replay when rotation already revoked it', async () => {
    const refreshRow = createRefreshToken();
    const trx = {
      updateTable: jest.fn().mockReturnValue(createMutationQuery(undefined)),
      insertInto: jest.fn(),
    };
    const db = {
      selectFrom: jest
        .fn()
        .mockReturnValueOnce(createSelectQuery(refreshRow))
        .mockReturnValueOnce(createSelectQuery(createAuthorization())),
      transaction: createTransaction(trx),
    };
    const { service } = createService({ db });

    await expect(
      service.exchangeToken(
        {
          grant_type: 'refresh_token',
          refresh_token: 'plain-refresh-token',
          client_id: clientId,
          resource,
        },
        workspace,
      ),
    ).rejects.toMatchObject({ errorCode: 'invalid_grant' });
    expect(trx.insertInto).not.toHaveBeenCalled();
  });

  it('rejects a refresh token whose authorization client differs', async () => {
    const refreshRow = createRefreshToken();
    const db = {
      selectFrom: jest
        .fn()
        .mockReturnValueOnce(createSelectQuery(refreshRow))
        .mockReturnValueOnce(
          createSelectQuery(
            createAuthorization({ oauthClientId: 'other-oauth-client-id' }),
          ),
        ),
      transaction: jest.fn(),
    };
    const { service } = createService({ db });

    await expect(
      service.exchangeToken(
        {
          grant_type: 'refresh_token',
          refresh_token: 'plain-refresh-token',
          client_id: clientId,
          resource,
        },
        workspace,
      ),
    ).rejects.toMatchObject({ errorCode: 'invalid_grant' });
    expect(db.transaction).not.toHaveBeenCalled();
  });

  it('rejects scope widening during refresh', async () => {
    const refreshRow = createRefreshToken({ scopes: ['mcp:read'] });
    const db = {
      selectFrom: jest.fn().mockReturnValue(createSelectQuery(refreshRow)),
      transaction: jest.fn(),
    };
    const { service } = createService({ db });

    await expect(
      service.exchangeToken(
        {
          grant_type: 'refresh_token',
          refresh_token: 'plain-refresh-token',
          client_id: clientId,
          resource,
          scope: 'mcp:write',
        },
        workspace,
      ),
    ).rejects.toMatchObject({ errorCode: 'invalid_scope' });
    expect(db.transaction).not.toHaveBeenCalled();
  });

  it('validates a live access token and throttles last-used writes in SQL', async () => {
    const authorization = {
      ...createAuthorization(),
      userId: user.id,
      workspaceId: workspace.id,
      scopes: ['mcp:read'],
      oauthClientEnabled: true,
      oauthClientDeletedAt: null,
    };
    const updateQuery = createMutationQuery();
    const db = {
      selectFrom: jest.fn().mockReturnValue(createSelectQuery(authorization)),
      updateTable: jest.fn().mockReturnValue(updateQuery),
    };
    const { service } = createService({ db });

    await expect(
      service.validateAccessToken(
        {
          sub: user.id,
          workspaceId: workspace.id,
          authorizationId: authorization.id,
          oauthClientId: authorization.oauthClientId,
          clientId,
          resource,
          scopes: ['mcp:read'],
        } as any,
        workspace,
      ),
    ).resolves.toMatchObject({
      user,
      workspace,
      oauth: { authorizationId: authorization.id, clientId },
    });

    expect(updateQuery.callbackWhereResult).toEqual({
      type: 'or',
      expressions: [
        { lhs: 'lastUsedAt', op: 'is', rhs: null },
        expect.objectContaining({ lhs: 'lastUsedAt', op: '<' }),
      ],
    });
  });

  it.each([
    ['subject', { sub: 'other-user-id' }],
    ['OAuth client', { oauthClientId: 'other-oauth-client-id' }],
  ])(
    'rejects an access token with a mismatched %s binding',
    async (_name, patch) => {
      const authorization = {
        ...createAuthorization(),
        userId: user.id,
        workspaceId: workspace.id,
        scopes: ['mcp:read'],
        oauthClientEnabled: true,
        oauthClientDeletedAt: null,
      };
      const db = {
        selectFrom: jest.fn().mockReturnValue(createSelectQuery(authorization)),
        updateTable: jest.fn(),
      };
      const { service, userRepo } = createService({ db });

      await expect(
        service.validateAccessToken(
          {
            sub: user.id,
            workspaceId: workspace.id,
            authorizationId: authorization.id,
            oauthClientId: authorization.oauthClientId,
            clientId,
            resource,
            scopes: ['mcp:read'],
            ...patch,
          } as any,
          workspace,
        ),
      ).rejects.toThrow('OAuth authorization is no longer valid');
      expect(userRepo.findById).not.toHaveBeenCalled();
      expect(db.updateTable).not.toHaveBeenCalled();
    },
  );

  it('rejects an access token when the workspace hint differs', async () => {
    const db = { selectFrom: jest.fn(), updateTable: jest.fn() };
    const { service } = createService({ db });

    await expect(
      service.validateAccessToken(
        {
          sub: user.id,
          workspaceId: workspace.id,
          authorizationId: 'authorization-id',
          oauthClientId: 'oauth-client-id',
          clientId,
          resource,
          scopes: ['mcp:read'],
        } as any,
        { ...workspace, id: 'other-workspace-id' },
      ),
    ).rejects.toThrow('OAuth token workspace does not match');
    expect(db.selectFrom).not.toHaveBeenCalled();
  });

  it('rejects an access token when the workspace is inactive', async () => {
    const db = { selectFrom: jest.fn(), updateTable: jest.fn() };
    const workspaceRepo = {
      findActiveById: jest.fn().mockResolvedValue(undefined),
    };
    const { service } = createService({ db, workspaceRepo });

    await expect(
      service.validateAccessToken(
        {
          sub: user.id,
          workspaceId: workspace.id,
          authorizationId: 'authorization-id',
          oauthClientId: 'oauth-client-id',
          clientId,
          resource,
          scopes: ['mcp:read'],
        } as any,
        workspace,
      ),
    ).rejects.toThrow('Workspace not found');
    expect(workspaceRepo.findActiveById).toHaveBeenCalledWith(workspace.id);
    expect(db.selectFrom).not.toHaveBeenCalled();
  });

  it('invalidates access immediately when the configured OAuth client is disabled', async () => {
    const authorization = {
      ...createAuthorization(),
      userId: user.id,
      workspaceId: workspace.id,
      scopes: ['mcp:read'],
      oauthClientEnabled: false,
      oauthClientDeletedAt: null,
    };
    const db = {
      selectFrom: jest.fn().mockReturnValue(createSelectQuery(authorization)),
      updateTable: jest.fn(),
    };
    const { service, userRepo } = createService({ db });

    await expect(
      service.validateAccessToken(
        {
          sub: user.id,
          workspaceId: workspace.id,
          authorizationId: authorization.id,
          oauthClientId: authorization.oauthClientId,
          clientId,
          resource,
          scopes: ['mcp:read'],
        } as any,
        workspace,
      ),
    ).rejects.toThrow('OAuth authorization is no longer valid');
    expect(userRepo.findById).not.toHaveBeenCalled();
    expect(db.updateTable).not.toHaveBeenCalled();
  });
});

function createAuthorizationCode(overrides: Record<string, any> = {}) {
  return {
    id: 'code-id',
    authorizationId: 'authorization-id',
    oauthClientId: 'oauth-client-id',
    userId: 'user-id',
    workspaceId: 'workspace-id',
    clientId: 'docmost-client-id',
    redirectUri: 'https://chatgpt.com/connector/oauth/callback-id',
    resource: 'https://docs.example.test/mcp',
    scopes: ['mcp:read', 'mcp:write'],
    codeChallenge: 'challenge',
    consumedAt: null,
    expiresAt: new Date(Date.now() + 60_000),
    ...overrides,
  };
}

function createAuthorization(overrides: Record<string, any> = {}) {
  return {
    id: 'authorization-id',
    oauthClientId: 'oauth-client-id',
    userId: 'user-id',
    workspaceId: 'workspace-id',
    clientId: 'docmost-client-id',
    resource: 'https://docs.example.test/mcp',
    scopes: ['mcp:read', 'mcp:write'],
    spaceAccessMode: 'all',
    oauthClientEnabled: true,
    oauthClientDeletedAt: null,
    oauthClientAllowedScopes: ['mcp:read', 'mcp:write'],
    ...overrides,
  };
}

function createRefreshToken(overrides: Record<string, any> = {}) {
  return {
    id: 'refresh-id',
    authorizationId: 'authorization-id',
    oauthClientId: 'oauth-client-id',
    userId: 'user-id',
    workspaceId: 'workspace-id',
    clientId: 'docmost-client-id',
    resource: 'https://docs.example.test/mcp',
    scopes: ['mcp:read', 'mcp:write'],
    revokedAt: null,
    expiresAt: new Date(Date.now() + 60_000),
    ...overrides,
  };
}

function createTransaction(trx: any) {
  return jest.fn().mockReturnValue({
    execute: (callback: (transaction: any) => unknown) => callback(trx),
  });
}

function createSelectQuery(result: any) {
  const query: Record<string, any> = {};
  for (const method of ['selectAll', 'leftJoin', 'select', 'where']) {
    query[method] = jest.fn(() => query);
  }
  query.executeTakeFirst = jest.fn().mockResolvedValue(result);
  return query;
}

function createMutationQuery(result?: any) {
  const query: Record<string, any> = { callbackWhereResult: undefined };
  query.set = jest.fn(() => query);
  query.values = jest.fn(() => query);
  query.where = jest.fn((...args: any[]) => {
    if (typeof args[0] === 'function') {
      const expressionBuilder: any = (
        lhs: string,
        op: string,
        rhs: unknown,
      ) => ({
        lhs,
        op,
        rhs,
      });
      expressionBuilder.or = (expressions: unknown[]) => ({
        type: 'or',
        expressions,
      });
      query.callbackWhereResult = args[0](expressionBuilder);
    }
    return query;
  });
  query.returning = jest.fn(() => query);
  query.returningAll = jest.fn(() => query);
  query.executeTakeFirst = jest.fn().mockResolvedValue(result);
  query.executeTakeFirstOrThrow = jest.fn().mockResolvedValue(result);
  query.execute = jest.fn().mockResolvedValue([]);
  return query;
}
