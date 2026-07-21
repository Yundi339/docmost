import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { ApiKeyService } from './api-key.service';
import { UserRole } from '../../common/helpers/types/permission';
import { ApiKeyType } from './api-key-scopes';

describe('ApiKeyService', () => {
  let service: ApiKeyService;
  let apiKeyRepo: {
    findApiKeys: jest.Mock;
    findById: jest.Mock;
    insertApiKey: jest.Mock;
    updateApiKey: jest.Mock;
    softDelete: jest.Mock;
    updateLastUsed: jest.Mock;
  };
  let tokenService: { generateApiToken: jest.Mock };
  let userRepo: { findById: jest.Mock };
  let workspaceRepo: { findActiveById: jest.Mock };
  let db: { transaction: jest.Mock };
  let credentialSpaceAccess: Record<string, jest.Mock>;
  let credentialRevocation: { lockActiveUserForIssuance: jest.Mock };
  let auditService: { log: jest.Mock };

  const workspace = (settings: Record<string, any> = {}) =>
    ({
      id: 'workspace-id',
      settings,
    }) as any;

  const user = (role: UserRole, id = 'user-id') =>
    ({
      id,
      role,
    }) as any;

  const futureExpiration = () =>
    new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();

  beforeEach(() => {
    apiKeyRepo = {
      findApiKeys: jest.fn(),
      findById: jest.fn(),
      insertApiKey: jest.fn(),
      updateApiKey: jest.fn(),
      softDelete: jest.fn(),
      updateLastUsed: jest.fn().mockResolvedValue(undefined),
    };
    tokenService = {
      generateApiToken: jest.fn(),
    };
    userRepo = {
      findById: jest.fn().mockResolvedValue({
        id: 'member-id',
        deactivatedAt: null,
        deletedAt: null,
      }),
    };
    workspaceRepo = {
      findActiveById: jest.fn().mockResolvedValue({
        id: 'workspace-id',
        licenseKey: null,
        plan: null,
      }),
    };
    auditService = {
      log: jest.fn(),
    };
    db = {
      transaction: jest.fn().mockReturnValue({
        execute: (callback: (trx: any) => unknown) => callback({}),
      }),
    };
    credentialSpaceAccess = {
      normalizeSelection: jest
        .fn()
        .mockResolvedValue({ mode: 'all', spaceIds: [] }),
      replaceApiKeyAccess: jest.fn().mockResolvedValue(undefined),
      addApiKeyViews: jest.fn(async (records) =>
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
      resolveApiKeyAccess: jest.fn().mockResolvedValue({
        mode: 'all',
        selectedSpaceIds: [],
        effectiveSpaceIds: ['space-id'],
        revision: 'revision-1',
      }),
      listSelectableSpaces: jest.fn().mockResolvedValue([]),
    };
    credentialRevocation = {
      lockActiveUserForIssuance: jest.fn().mockResolvedValue({
        id: 'member-id',
        deactivatedAt: null,
        deletedAt: null,
      }),
    };

    service = new ApiKeyService(
      apiKeyRepo as any,
      tokenService as any,
      userRepo as any,
      workspaceRepo as any,
      db as any,
      credentialSpaceAccess as any,
      credentialRevocation as any,
      auditService as any,
    );
  });

  it('blocks members from the workspace-wide API key view', async () => {
    await expect(
      service.findApiKeys(
        workspace({ api: { allowMemberManagement: true } }),
        { adminView: true } as any,
        user(UserRole.MEMBER),
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);

    expect(apiKeyRepo.findApiKeys).not.toHaveBeenCalled();
  });

  it('blocks admins from the workspace-wide API key view', async () => {
    await expect(
      service.findApiKeys(
        workspace(),
        { adminView: true } as any,
        user(UserRole.ADMIN, 'admin-id'),
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);

    expect(apiKeyRepo.findApiKeys).not.toHaveBeenCalled();
  });

  it('allows owners to use the workspace-wide API key view', async () => {
    const result = { items: [], meta: {} };
    apiKeyRepo.findApiKeys.mockResolvedValue(result);

    await expect(
      service.findApiKeys(
        workspace(),
        { adminView: true } as any,
        user(UserRole.OWNER, 'owner-id'),
      ),
    ).resolves.toBe(result);

    expect(apiKeyRepo.findApiKeys).toHaveBeenCalledWith(
      'workspace-id',
      { adminView: true },
      { keyType: undefined },
    );
  });

  it('lists only the current user keys in personal view', async () => {
    const result = { items: [], meta: {} };
    apiKeyRepo.findApiKeys.mockResolvedValue(result);

    await expect(
      service.findApiKeys(
        workspace(),
        { cursor: 'cursor-1' } as any,
        user(UserRole.MEMBER, 'member-id'),
      ),
    ).resolves.toBe(result);

    expect(apiKeyRepo.findApiKeys).toHaveBeenCalledWith(
      'workspace-id',
      { cursor: 'cursor-1' },
      { creatorId: 'member-id', keyType: undefined },
    );
  });

  it('filters both personal and owner views by keyType', async () => {
    apiKeyRepo.findApiKeys.mockResolvedValue({ items: [], meta: {} });

    await service.findApiKeys(
      workspace(),
      { keyType: ApiKeyType.MCP } as any,
      user(UserRole.MEMBER, 'member-id'),
    );
    await service.findApiKeys(
      workspace(),
      { adminView: true, keyType: ApiKeyType.REST } as any,
      user(UserRole.OWNER, 'owner-id'),
    );

    expect(apiKeyRepo.findApiKeys).toHaveBeenNthCalledWith(
      1,
      'workspace-id',
      { keyType: ApiKeyType.MCP },
      { creatorId: 'member-id', keyType: ApiKeyType.MCP },
    );
    expect(apiKeyRepo.findApiKeys).toHaveBeenNthCalledWith(
      2,
      'workspace-id',
      { adminView: true, keyType: ApiKeyType.REST },
      { keyType: ApiKeyType.REST },
    );
  });

  it('allows members to update their own API keys', async () => {
    apiKeyRepo.findById.mockResolvedValue({
      id: 'api-key-id',
      creatorId: 'member-id',
      keyType: ApiKeyType.REST,
      scopes: ['rest:read', 'rest:write'],
      spaceAccessMode: 'all',
    });

    await service.update(
      { apiKeyId: 'api-key-id', name: 'Renamed key' },
      workspace(),
      user(UserRole.MEMBER, 'member-id'),
    );

    expect(apiKeyRepo.updateApiKey).toHaveBeenCalledWith(
      { name: 'Renamed key', scopes: ['rest:read', 'rest:write'] },
      'api-key-id',
      'workspace-id',
      {},
    );
  });

  it('rejects attempts to change an API key type', async () => {
    apiKeyRepo.findById.mockResolvedValue({
      id: 'api-key-id',
      creatorId: 'member-id',
      keyType: ApiKeyType.REST,
      scopes: ['rest:read'],
      spaceAccessMode: 'all',
    });

    await expect(
      service.update(
        {
          apiKeyId: 'api-key-id',
          name: 'Changed key',
          keyType: ApiKeyType.MCP,
        },
        workspace(),
        user(UserRole.MEMBER, 'member-id'),
      ),
    ).rejects.toBeInstanceOf(BadRequestException);

    expect(apiKeyRepo.updateApiKey).not.toHaveBeenCalled();
  });

  it('rejects scopes from another key type during update', async () => {
    apiKeyRepo.findById.mockResolvedValue({
      id: 'api-key-id',
      creatorId: 'member-id',
      keyType: ApiKeyType.REST,
      scopes: ['rest:read'],
      spaceAccessMode: 'all',
    });

    await expect(
      service.update(
        {
          apiKeyId: 'api-key-id',
          name: 'Changed key',
          scopes: ['rest:read', 'mcp:read'],
        },
        workspace(),
        user(UserRole.MEMBER, 'member-id'),
      ),
    ).rejects.toBeInstanceOf(BadRequestException);

    expect(apiKeyRepo.updateApiKey).not.toHaveBeenCalled();
  });

  it('blocks members from updating another user API key', async () => {
    apiKeyRepo.findById.mockResolvedValue({
      id: 'api-key-id',
      creatorId: 'other-user-id',
    });

    await expect(
      service.update(
        { apiKeyId: 'api-key-id', name: 'Renamed key' },
        workspace({ api: { allowMemberManagement: true } }),
        user(UserRole.MEMBER, 'member-id'),
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);

    expect(apiKeyRepo.updateApiKey).not.toHaveBeenCalled();
  });

  it('allows owners to revoke another user API key', async () => {
    apiKeyRepo.findById.mockResolvedValue({
      id: 'api-key-id',
      creatorId: 'member-id',
      keyType: ApiKeyType.REST,
    });

    await service.revoke(
      'api-key-id',
      workspace(),
      user(UserRole.OWNER, 'owner-id'),
    );

    expect(apiKeyRepo.softDelete).toHaveBeenCalledWith(
      'api-key-id',
      'workspace-id',
    );
  });

  it('only lets owners rename another user API key', async () => {
    apiKeyRepo.findById.mockResolvedValue({
      id: 'api-key-id',
      creatorId: 'member-id',
      keyType: ApiKeyType.MCP,
      scopes: ['mcp:read'],
      spaceAccessMode: 'selected',
    });

    await expect(
      service.update(
        {
          apiKeyId: 'api-key-id',
          name: 'Renamed key',
          spaceAccess: { mode: 'all' },
        },
        workspace(),
        user(UserRole.OWNER, 'owner-id'),
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);

    expect(apiKeyRepo.updateApiKey).not.toHaveBeenCalled();
  });

  it('rejects mixed scopes when creating an MCP key', async () => {
    credentialSpaceAccess.normalizeSelection.mockResolvedValue({
      mode: 'selected',
      spaceIds: ['018f3f73-2f69-7c8d-9d79-8f3f4d7d9712'],
    });

    await expect(
      service.create(
        {
          name: 'Scoped key',
          expiresAt: futureExpiration(),
          keyType: ApiKeyType.MCP,
          scopes: ['mcp:read', 'rest:read'],
          spaceAccess: {
            mode: 'selected',
            spaceIds: ['018f3f73-2f69-7c8d-9d79-8f3f4d7d9712'],
          },
        },
        user(UserRole.MEMBER, 'member-id'),
        workspace(),
      ),
    ).rejects.toBeInstanceOf(BadRequestException);

    expect(apiKeyRepo.insertApiKey).not.toHaveBeenCalled();
  });

  it('rejects selected-space access when creating a REST key', async () => {
    credentialSpaceAccess.normalizeSelection.mockResolvedValue({
      mode: 'selected',
      spaceIds: ['018f3f73-2f69-7c8d-9d79-8f3f4d7d9712'],
    });

    await expect(
      service.create(
        {
          name: 'REST key',
          expiresAt: futureExpiration(),
          keyType: ApiKeyType.REST,
          scopes: ['rest:read'],
          spaceAccess: {
            mode: 'selected',
            spaceIds: ['018f3f73-2f69-7c8d-9d79-8f3f4d7d9712'],
          },
        },
        user(UserRole.MEMBER, 'member-id'),
        workspace(),
      ),
    ).rejects.toBeInstanceOf(BadRequestException);

    expect(apiKeyRepo.insertApiKey).not.toHaveBeenCalled();
  });

  it.each<[ApiKeyType, string[]]>([
    [ApiKeyType.REST, ['rest:read']],
    [ApiKeyType.MCP, ['mcp:read']],
  ])('uses the minimal default scopes for %s keys', async (keyType, scopes) => {
    const expiresAt = futureExpiration();
    apiKeyRepo.insertApiKey.mockResolvedValue({ id: 'api-key-id' });
    apiKeyRepo.findById.mockResolvedValue({
      id: 'api-key-id',
      creatorId: 'member-id',
      keyType,
      scopes,
      spaceAccessMode: 'all',
    });
    tokenService.generateApiToken.mockResolvedValue('api-token');

    await service.create(
      { name: 'Default key', expiresAt, keyType },
      user(UserRole.MEMBER, 'member-id'),
      workspace(
        keyType === ApiKeyType.MCP
          ? { ai: { mcpMode: 'read-write' } }
          : {},
      ),
    );

    expect(apiKeyRepo.insertApiKey).toHaveBeenCalledWith(
      expect.objectContaining({ keyType, scopes }),
      {},
    );
    expect(auditService.log).toHaveBeenCalledWith(
      expect.objectContaining({
        metadata: expect.objectContaining({ keyType, scopes }),
      }),
    );
  });

  it('enforces admin-only API key creation when the workspace restricts it', async () => {
    await expect(
      service.create(
        {
          name: 'Member key',
          expiresAt: futureExpiration(),
          keyType: ApiKeyType.REST,
        },
        user(UserRole.MEMBER, 'member-id'),
        workspace({ api: { restrictToAdmins: true } }),
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);

    expect(apiKeyRepo.insertApiKey).not.toHaveBeenCalled();
  });

  it('requires an expiration when creating API keys', async () => {
    await expect(
      service.create(
        { name: 'Member key' } as any,
        user(UserRole.MEMBER, 'member-id'),
        workspace(),
      ),
    ).rejects.toBeInstanceOf(BadRequestException);

    expect(apiKeyRepo.insertApiKey).not.toHaveBeenCalled();
  });

  it('rejects API key expirations in the past', async () => {
    await expect(
      service.create(
        {
          name: 'Member key',
          expiresAt: new Date(Date.now() - 1000).toISOString(),
          keyType: ApiKeyType.REST,
        },
        user(UserRole.MEMBER, 'member-id'),
        workspace(),
      ),
    ).rejects.toBeInstanceOf(BadRequestException);

    expect(apiKeyRepo.insertApiKey).not.toHaveBeenCalled();
  });

  it('allows admins to create API keys when creation is admin-only', async () => {
    const expiresAt = futureExpiration();
    apiKeyRepo.insertApiKey.mockResolvedValue({ id: 'api-key-id' });
    tokenService.generateApiToken.mockResolvedValue('api-token');
    apiKeyRepo.findById.mockResolvedValue({
      id: 'api-key-id',
      creatorId: 'admin-id',
    });

    await expect(
      service.create(
        {
          name: 'Admin key',
          expiresAt,
          keyType: ApiKeyType.MCP,
          scopes: ['mcp:read'],
        },
        user(UserRole.ADMIN, 'admin-id'),
        workspace({
          api: { restrictToAdmins: true },
          ai: { mcpMode: 'read-write' },
        }),
      ),
    ).resolves.toMatchObject({
      id: 'api-key-id',
      token: 'api-token',
    });
    expect(apiKeyRepo.insertApiKey).toHaveBeenCalledWith(
      expect.objectContaining({
        expiresAt: new Date(expiresAt),
        keyType: ApiKeyType.MCP,
        scopes: ['mcp:read'],
      }),
      {},
    );
    expect(tokenService.generateApiToken).toHaveBeenCalledWith(
      expect.objectContaining({
        expiresIn: expect.any(Number),
        scopes: ['mcp:read'],
      }),
    );
  });

  it('rejects MCP key creation while MCP is disabled', async () => {
    await expect(
      service.create(
        {
          name: 'Disabled MCP key',
          expiresAt: futureExpiration(),
          keyType: ApiKeyType.MCP,
          scopes: ['mcp:read'],
        },
        user(UserRole.MEMBER, 'member-id'),
        workspace({ ai: { mcpMode: 'off' } }),
      ),
    ).rejects.toThrow('MCP is not enabled for this workspace');

    expect(apiKeyRepo.insertApiKey).not.toHaveBeenCalled();
  });

  it('rejects writable MCP key creation in read-only mode', async () => {
    await expect(
      service.create(
        {
          name: 'Writable MCP key',
          expiresAt: futureExpiration(),
          keyType: ApiKeyType.MCP,
          scopes: ['mcp:write'],
        },
        user(UserRole.MEMBER, 'member-id'),
        workspace({ ai: { mcpMode: 'read-only' } }),
      ),
    ).rejects.toThrow('MCP is enabled in read-only mode');

    expect(apiKeyRepo.insertApiKey).not.toHaveBeenCalled();
  });

  it('does not create an API key after the user is deactivated', async () => {
    credentialRevocation.lockActiveUserForIssuance.mockResolvedValue(undefined);

    await expect(
      service.create(
        {
          name: 'Member key',
          expiresAt: futureExpiration(),
          keyType: ApiKeyType.REST,
        },
        user(UserRole.MEMBER, 'member-id'),
        workspace(),
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);

    expect(apiKeyRepo.insertApiKey).not.toHaveBeenCalled();
    expect(tokenService.generateApiToken).not.toHaveBeenCalled();
  });

  it('rejects API keys created by disabled users', async () => {
    apiKeyRepo.findById.mockResolvedValue({
      id: 'api-key-id',
      creatorId: 'member-id',
      keyType: ApiKeyType.REST,
      scopes: ['rest:read'],
      spaceAccessMode: 'all',
    });
    userRepo.findById.mockResolvedValue({
      id: 'member-id',
      deactivatedAt: new Date(),
      deletedAt: null,
    });

    await expect(
      service.validateApiKey({
        apiKeyId: 'api-key-id',
        sub: 'member-id',
        workspaceId: 'workspace-id',
        type: 'api_key',
      }),
    ).rejects.toBeInstanceOf(ForbiddenException);

    expect(apiKeyRepo.updateLastUsed).not.toHaveBeenCalled();
  });

  it('rejects expired API keys', async () => {
    apiKeyRepo.findById.mockResolvedValue({
      id: 'api-key-id',
      creatorId: 'member-id',
      expiresAt: new Date(Date.now() - 1000),
      keyType: ApiKeyType.REST,
      scopes: ['rest:read'],
      spaceAccessMode: 'all',
    });

    await expect(
      service.validateApiKey({
        apiKeyId: 'api-key-id',
        sub: 'member-id',
        workspaceId: 'workspace-id',
        type: 'api_key',
      }),
    ).rejects.toBeInstanceOf(ForbiddenException);

    expect(apiKeyRepo.updateLastUsed).not.toHaveBeenCalled();
  });

  it.each(['suspended', 'deleted'])(
    'rejects API keys when the workspace is %s',
    async () => {
      apiKeyRepo.findById.mockResolvedValue({
        id: 'api-key-id',
        creatorId: 'member-id',
        expiresAt: null,
        keyType: ApiKeyType.REST,
        scopes: ['rest:read'],
        spaceAccessMode: 'all',
      });
      workspaceRepo.findActiveById.mockResolvedValue(undefined);

      await expect(
        service.validateApiKey({
          apiKeyId: 'api-key-id',
          sub: 'member-id',
          workspaceId: 'workspace-id',
          type: 'api_key',
        }),
      ).rejects.toBeInstanceOf(ForbiddenException);

      expect(workspaceRepo.findActiveById).toHaveBeenCalledWith('workspace-id');
      expect(apiKeyRepo.updateLastUsed).not.toHaveBeenCalled();
    },
  );

  it.each([
    {
      name: 'mixed scopes',
      keyType: ApiKeyType.REST,
      scopes: ['rest:read', 'mcp:read'],
      spaceAccessMode: 'all',
    },
    {
      name: 'REST selected-space mode',
      keyType: ApiKeyType.REST,
      scopes: ['rest:read'],
      spaceAccessMode: 'selected',
    },
    {
      name: 'MCP scopes on a REST key',
      keyType: ApiKeyType.REST,
      scopes: ['mcp:read'],
      spaceAccessMode: 'all',
    },
    {
      name: 'empty scopes',
      keyType: ApiKeyType.MCP,
      scopes: [],
      spaceAccessMode: 'all',
    },
  ])('rejects $name read from the database', async (configuration) => {
    apiKeyRepo.findById.mockResolvedValue({
      id: 'api-key-id',
      creatorId: 'member-id',
      expiresAt: null,
      ...configuration,
    });

    await expect(
      service.validateApiKey({
        apiKeyId: 'api-key-id',
        sub: 'member-id',
        workspaceId: 'workspace-id',
        type: 'api_key',
      }),
    ).rejects.toBeInstanceOf(ForbiddenException);

    expect(apiKeyRepo.updateLastUsed).not.toHaveBeenCalled();
  });

  it('returns the database keyType and updates last-used metadata', async () => {
    apiKeyRepo.findById.mockResolvedValue({
      id: 'api-key-id',
      creatorId: 'member-id',
      expiresAt: null,
      keyType: ApiKeyType.MCP,
      scopes: ['mcp:write'],
      spaceAccessMode: 'selected',
    });

    const result = await service.validateApiKey(
      {
        apiKeyId: 'api-key-id',
        sub: 'member-id',
        workspaceId: 'workspace-id',
        type: 'api_key',
      },
      { ipAddress: '127.0.0.1', userAgent: 'test-agent' },
    );

    expect(result.apiKey).toMatchObject({
      keyType: ApiKeyType.MCP,
      scopes: ['mcp:read', 'mcp:write'],
    });
    expect(apiKeyRepo.updateLastUsed).toHaveBeenCalledWith('api-key-id', {
      ipAddress: '127.0.0.1',
      userAgent: 'test-agent',
    });
  });

  it('rejects legacy null scopes after the type migration', async () => {
    apiKeyRepo.findById.mockResolvedValue({
      id: 'api-key-id',
      creatorId: 'member-id',
      expiresAt: null,
      keyType: ApiKeyType.REST,
      scopes: null,
      spaceAccessMode: 'all',
    });
    userRepo.findById.mockResolvedValue({
      id: 'member-id',
      deactivatedAt: null,
      deletedAt: null,
    });

    await expect(
      service.validateApiKey({
        apiKeyId: 'api-key-id',
        sub: 'member-id',
        workspaceId: 'workspace-id',
        type: 'api_key',
      }),
    ).rejects.toBeInstanceOf(ForbiddenException);

    expect(apiKeyRepo.updateLastUsed).not.toHaveBeenCalled();
  });
});
