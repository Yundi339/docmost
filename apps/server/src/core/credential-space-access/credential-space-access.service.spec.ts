import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { CredentialSpaceAccessService } from './credential-space-access.service';

describe('CredentialSpaceAccessService', () => {
  let service: CredentialSpaceAccessService;

  beforeEach(() => {
    service = new CredentialSpaceAccessService({} as any);
  });

  it('keeps omitted access compatible with all current spaces', async () => {
    await expect(
      service.normalizeSelection(undefined, 'user-id', 'workspace-id'),
    ).resolves.toEqual({ mode: 'all', spaceIds: [] });
  });

  it('rejects an empty selected-space policy instead of widening to all', async () => {
    await expect(
      service.normalizeSelection(
        { mode: 'selected', spaceIds: [] },
        'user-id',
        'workspace-id',
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejects spaces the credential owner cannot currently access', async () => {
    jest
      .spyOn(service as any, 'getAccessibleSpaceIds')
      .mockResolvedValue(['018f3f73-2f69-7c8d-9d79-8f3f4d7d9711']);

    await expect(
      service.normalizeSelection(
        {
          mode: 'selected',
          spaceIds: ['018f3f73-2f69-7c8d-9d79-8f3f4d7d9712'],
        },
        'user-id',
        'workspace-id',
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('invalidates a selected credential after all memberships are removed', async () => {
    jest
      .spyOn(service as any, 'getApiKeyGrantIds')
      .mockResolvedValue(['018f3f73-2f69-7c8d-9d79-8f3f4d7d9711']);
    jest.spyOn(service as any, 'getAccessibleSpaceIds').mockResolvedValue([]);

    await expect(
      service.resolveApiKeyAccess({
        id: 'api-key-id',
        creatorId: 'user-id',
        workspaceId: 'workspace-id',
        spaceAccessMode: 'selected',
      }),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('removes inaccessible spaces from the effective request boundary', async () => {
    const allowed = '018f3f73-2f69-7c8d-9d79-8f3f4d7d9711';
    const removed = '018f3f73-2f69-7c8d-9d79-8f3f4d7d9712';
    jest
      .spyOn(service as any, 'getOAuthGrantIds')
      .mockResolvedValue([allowed, removed]);
    jest
      .spyOn(service as any, 'getAccessibleSpaceIds')
      .mockResolvedValue([allowed]);

    await expect(
      service.resolveOAuthAuthorizationAccess({
        id: 'authorization-id',
        userId: 'user-id',
        workspaceId: 'workspace-id',
        spaceAccessMode: 'selected',
      }),
    ).resolves.toMatchObject({
      mode: 'selected',
      selectedSpaceIds: [allowed, removed],
      effectiveSpaceIds: [allowed],
      revision: expect.any(String),
    });
  });

  it('fails closed for an unknown stored mode', async () => {
    jest.spyOn(service as any, 'getApiKeyGrantIds').mockResolvedValue([]);

    await expect(
      service.resolveApiKeyAccess({
        id: 'api-key-id',
        creatorId: 'user-id',
        workspaceId: 'workspace-id',
        spaceAccessMode: 'unexpected',
      }),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });
});
