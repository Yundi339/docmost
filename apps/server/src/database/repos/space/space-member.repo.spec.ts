import { SpaceMemberRepo } from './space-member.repo';

describe('SpaceMemberRepo permission cache', () => {
  it('invalidates every affected user and space combination once', async () => {
    const cache = {
      set: jest.fn().mockResolvedValue(undefined),
      del: jest.fn().mockResolvedValue(undefined),
    };
    const securityEvents = { publish: jest.fn().mockResolvedValue(undefined) };
    const repo = new SpaceMemberRepo(
      {} as any,
      {} as any,
      {} as any,
      cache as any,
      securityEvents as any,
    );

    await repo.invalidateUserSpaceRoles(
      ['user-1', 'user-1', 'user-2'],
      ['space-1', 'space-2', 'space-1'],
    );

    expect(cache.set.mock.calls.map(([key]) => key).sort()).toEqual([
      'perm:space-roles-version:user-1:space-1',
      'perm:space-roles-version:user-1:space-2',
      'perm:space-roles-version:user-2:space-1',
      'perm:space-roles-version:user-2:space-2',
    ]);
    expect(securityEvents.publish).toHaveBeenCalledWith({
      type: 'space.membership-changed',
      userIds: ['user-1', 'user-2'],
      spaceIds: ['space-1', 'space-2'],
    });
  });

  it('still publishes and removes versions when cache invalidation fails', async () => {
    const cache = {
      set: jest.fn().mockRejectedValue(new Error('cache unavailable')),
      del: jest.fn().mockResolvedValue(undefined),
    };
    const securityEvents = { publish: jest.fn().mockResolvedValue(undefined) };
    const repo = new SpaceMemberRepo(
      {} as any,
      {} as any,
      {} as any,
      cache as any,
      securityEvents as any,
    );

    await repo.invalidateUserSpaceRoles(['user-1'], ['space-1']);

    expect(cache.del).toHaveBeenCalledWith(
      'perm:space-roles-version:user-1:space-1',
    );
    expect(securityEvents.publish).toHaveBeenCalledWith({
      type: 'space.membership-changed',
      userIds: ['user-1'],
      spaceIds: ['space-1'],
    });
  });
});
