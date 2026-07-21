import { SpaceMemberRepo } from './space-member.repo';

describe('SpaceMemberRepo permission cache', () => {
  it('invalidates every affected user and space combination once', async () => {
    const cache = { del: jest.fn().mockResolvedValue(undefined) };
    const repo = new SpaceMemberRepo(
      {} as any,
      {} as any,
      {} as any,
      cache as any,
    );

    await repo.invalidateUserSpaceRoles(
      ['user-1', 'user-1', 'user-2'],
      ['space-1', 'space-2', 'space-1'],
    );

    expect(cache.del.mock.calls.map(([key]) => key).sort()).toEqual([
      'perm:space-roles:user-1:space-1',
      'perm:space-roles:user-1:space-2',
      'perm:space-roles:user-2:space-1',
      'perm:space-roles:user-2:space-2',
    ]);
  });
});
