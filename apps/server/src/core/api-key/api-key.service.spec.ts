import { ForbiddenException } from '@nestjs/common';
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

  beforeEach(() => {
    apiKeyRepo = {
      findApiKeys: jest.fn(),
      findById: jest.fn(),
      insertApiKey: jest.fn(),
      updateApiKey: jest.fn(),
      softDelete: jest.fn(),
      updateLastUsed: jest.fn(),
    };
    tokenService = {
      generateApiToken: jest.fn(),
    };
    auditService = {
      log: jest.fn(),
    };

    service = new ApiKeyService(
      apiKeyRepo as any,
      tokenService as any,
      {} as any,
      auditService as any,
    );
  });

  it('blocks non-owners from the workspace-wide API key view', async () => {
    await expect(
      service.findApiKeys(
        workspace({ api: { allowMemberManagement: true } }),
        { adminView: true } as any,
        user(UserRole.MEMBER),
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);

    expect(apiKeyRepo.findApiKeys).not.toHaveBeenCalled();
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
      { name: 'Renamed key' },
      'api-key-id',
      'workspace-id',
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

  it('enforces admin-only API key creation when the workspace restricts it', async () => {
    await expect(
      service.create(
        { name: 'Member key' },
        user(UserRole.MEMBER, 'member-id'),
        workspace({ api: { restrictToAdmins: true } }),
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);

    expect(apiKeyRepo.insertApiKey).not.toHaveBeenCalled();
  });

  it('allows admins to create API keys when creation is admin-only', async () => {
    apiKeyRepo.insertApiKey.mockResolvedValue({ id: 'api-key-id' });
    tokenService.generateApiToken.mockResolvedValue('api-token');
    apiKeyRepo.findById.mockResolvedValue({
      id: 'api-key-id',
      creatorId: 'admin-id',
    });

    await expect(
      service.create(
        { name: 'Admin key' },
        user(UserRole.ADMIN, 'admin-id'),
        workspace({ api: { restrictToAdmins: true } }),
      ),
    ).resolves.toMatchObject({
      id: 'api-key-id',
      token: 'api-token',
    });
  });
});
