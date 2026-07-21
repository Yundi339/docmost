import { CredentialRevocationService } from './credential-revocation.service';

describe('CredentialRevocationService', () => {
  it('locks and returns only an active user before issuing credentials', async () => {
    const query: Record<string, jest.Mock> = {};
    query.selectAll = jest.fn(() => query);
    query.where = jest.fn(() => query);
    query.forUpdate = jest.fn(() => query);
    query.executeTakeFirst = jest.fn().mockResolvedValue({ id: 'user-id' });
    const trx = {
      selectFrom: jest.fn().mockReturnValue(query),
    };
    const service = new CredentialRevocationService({} as any);

    await expect(
      service.lockActiveUserForIssuance('user-id', 'workspace-id', trx as any),
    ).resolves.toEqual({ id: 'user-id' });

    expect(trx.selectFrom).toHaveBeenCalledWith('users');
    expect(query.where).toHaveBeenCalledWith('deletedAt', 'is', null);
    expect(query.where).toHaveBeenCalledWith('deactivatedAt', 'is', null);
    expect(query.forUpdate).toHaveBeenCalledTimes(1);
  });

  it('permanently revokes every long-lived credential for a user', async () => {
    const queries: Record<string, any> = {};
    const db = {
      updateTable: jest.fn((table: string) => {
        const query: Record<string, jest.Mock> = {};
        query.set = jest.fn(() => query);
        query.where = jest.fn(() => query);
        query.execute = jest.fn().mockResolvedValue(undefined);
        queries[table] = query;
        return query;
      }),
    };
    const service = new CredentialRevocationService(db as any);

    await service.revokeForUser('user-id', 'workspace-id');

    expect(db.updateTable.mock.calls.map(([table]) => table)).toEqual([
      'apiKeys',
      'oauthAuthorizations',
      'oauthRefreshTokens',
      'oauthAuthorizationCodes',
    ]);
    expect(queries.apiKeys.set).toHaveBeenCalledWith(
      expect.objectContaining({
        deletedAt: expect.any(Date),
        updatedAt: expect.any(Date),
      }),
    );
    expect(queries.oauthAuthorizations.set).toHaveBeenCalledWith(
      expect.objectContaining({
        revokedAt: expect.any(Date),
        updatedAt: expect.any(Date),
      }),
    );
    expect(queries.oauthRefreshTokens.set).toHaveBeenCalledWith({
      revokedAt: expect.any(Date),
    });
    expect(queries.oauthAuthorizationCodes.set).toHaveBeenCalledWith({
      consumedAt: expect.any(Date),
    });
    expect(
      Object.values(queries).every(
        (query) => query.execute.mock.calls.length === 1,
      ),
    ).toBe(true);
  });
});
