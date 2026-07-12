import { PasskeyAccountRepo } from './passkey-account.repo';
import { PasskeyChallengeRepo } from './passkey-challenge.repo';
import { UserPasskeyRepo } from './user-passkey.repo';

describe('Passkey repositories', () => {
  it('atomically consumes a challenge scoped to workspace, type, user and session', async () => {
    const query = fluentQuery({ id: 'challenge-id' });
    const db = { deleteFrom: jest.fn().mockReturnValue(query) };
    const repo = new PasskeyChallengeRepo(db as any);

    await repo.consume({
      id: 'challenge-id',
      workspaceId: 'workspace-id',
      type: 'registration',
      userId: 'user-id',
      sessionId: 'session-id',
    });

    expect(db.deleteFrom).toHaveBeenCalledWith('passkeyChallenges');
    expect(query.where.mock.calls).toEqual(
      expect.arrayContaining([
        ['id', '=', 'challenge-id'],
        ['workspaceId', '=', 'workspace-id'],
        ['type', '=', 'registration'],
        ['userId', '=', 'user-id'],
        ['sessionId', '=', 'session-id'],
      ]),
    );
    expect(query.returningAll).toHaveBeenCalledTimes(1);
    expect(query.executeTakeFirst).toHaveBeenCalledTimes(1);
  });

  it('scopes every user-visible Passkey lookup to user and workspace', async () => {
    const query = fluentQuery(undefined);
    const db = {
      selectFrom: jest.fn().mockReturnValue(query),
      updateTable: jest.fn().mockReturnValue(query),
      deleteFrom: jest.fn().mockReturnValue(query),
    };
    const repo = new UserPasskeyRepo(db as any);

    await repo.findByIdForUser('passkey-id', 'user-id', 'workspace-id');
    await repo.rename('passkey-id', 'user-id', 'workspace-id', 'New name');
    await repo.deleteForUser('passkey-id', 'user-id', 'workspace-id');

    for (let offset = 0; offset < 3; offset += 1) {
      const calls = query.where.mock.calls.slice(offset * 3, offset * 3 + 3);
      expect(calls).toEqual([
        ['id', '=', 'passkey-id'],
        ['userId', '=', 'user-id'],
        ['workspaceId', '=', 'workspace-id'],
      ]);
    }
  });

  it('scopes credential lookup to workspace and excludes disabled credentials', async () => {
    const query = fluentQuery(undefined);
    const db = { selectFrom: jest.fn().mockReturnValue(query) };
    const repo = new UserPasskeyRepo(db as any);

    await repo.findByCredentialId('credential-id', 'workspace-id');

    expect(query.where.mock.calls).toEqual([
      ['credentialId', '=', 'credential-id'],
      ['workspaceId', '=', 'workspace-id'],
      ['disabledAt', 'is', null],
    ]);
  });

  it('scopes stable user handles to user and workspace', async () => {
    const query = fluentQuery(undefined);
    const db = { selectFrom: jest.fn().mockReturnValue(query) };
    const repo = new PasskeyAccountRepo(db as any);

    await repo.findByUser('user-id', 'workspace-id');

    expect(query.where.mock.calls).toEqual([
      ['userId', '=', 'user-id'],
      ['workspaceId', '=', 'workspace-id'],
    ]);
  });
});

function fluentQuery(result: unknown) {
  const query: Record<string, jest.Mock> = {};
  for (const method of [
    'selectAll',
    'where',
    'returningAll',
    'set',
    'forUpdate',
  ]) {
    query[method] = jest.fn().mockReturnValue(query);
  }
  query.executeTakeFirst = jest.fn().mockResolvedValue(result);
  return query;
}
