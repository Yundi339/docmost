import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { ApiKeyService } from './api-key.service';
import { UserRole } from '../../common/helpers/types/permission';

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
  let workspaceRepo: { findById: jest.Mock };
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
      findById: jest.fn().mockResolvedValue({
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

    expect(apiKeyRepo.findApiKeys).toHaveBeenCalledWith('workspace-id', {
      adminView: true,
    });
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
      'member-id',
    );
  });

  it('allows members to update their own API keys', async () => {
    apiKeyRepo.findById.mockResolvedValue({
      id: 'api-key-id',
      creatorId: 'member-id',
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

  it('rejects REST scopes for selected-space API keys', async () => {
    credentialSpaceAccess.normalizeSelection.mockResolvedValue({
      mode: 'selected',
      spaceIds: ['018f3f73-2f69-7c8d-9d79-8f3f4d7d9712'],
    });

    await expect(
      service.create(
        {
          name: 'Scoped key',
          expiresAt: futureExpiration(),
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

  it('enforces admin-only API key creation when the workspace restricts it', async () => {
    await expect(
      service.create(
        { name: 'Member key', expiresAt: futureExpiration() },
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
        { name: 'Admin key', expiresAt, scopes: ['mcp:read'] },
        user(UserRole.ADMIN, 'admin-id'),
        workspace({ api: { restrictToAdmins: true } }),
      ),
    ).resolves.toMatchObject({
      id: 'api-key-id',
      token: 'api-token',
    });
    expect(apiKeyRepo.insertApiKey).toHaveBeenCalledWith(
      expect.objectContaining({
        expiresAt: new Date(expiresAt),
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

  it('does not create an API key after the user is deactivated', async () => {
    credentialRevocation.lockActiveUserForIssuance.mockResolvedValue(undefined);

    await expect(
      service.create(
        { name: 'Member key', expiresAt: futureExpiration() },
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
      scopes: ['rest:read'],
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
      scopes: ['rest:read'],
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

  it('keeps legacy API keys REST-only and updates last-used metadata', async () => {
    apiKeyRepo.findById.mockResolvedValue({
      id: 'api-key-id',
      creatorId: 'member-id',
      expiresAt: null,
      scopes: null,
    });
    userRepo.findById.mockResolvedValue({
      id: 'member-id',
      deactivatedAt: null,
      deletedAt: null,
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

    expect(result.apiKey.scopes).toEqual(['rest:read', 'rest:write']);
    expect(apiKeyRepo.updateLastUsed).toHaveBeenCalledWith('api-key-id', {
      ipAddress: '127.0.0.1',
      userAgent: 'test-agent',
    });
  });
});
