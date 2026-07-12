import { ShareRepo } from './share.repo';

describe('ShareRepo', () => {
  it('rotates the access version when includeSubPages changes', async () => {
    const query = {
      set: jest.fn(),
      where: jest.fn(),
      returning: jest.fn(),
      executeTakeFirst: jest.fn().mockResolvedValue({ id: 'share-id' }),
    };
    query.set.mockReturnValue(query);
    query.where.mockReturnValue(query);
    query.returning.mockReturnValue(query);
    const db = { updateTable: jest.fn().mockReturnValue(query) };
    const repo = new ShareRepo(db as any, {} as any);

    await repo.updateShare({ includeSubPages: false }, 'share-id');

    expect(query.set).toHaveBeenCalledWith(
      expect.objectContaining({
        includeSubPages: false,
        passwordVersion: expect.anything(),
      }),
    );
  });

  it('does not rotate access for search indexing changes', async () => {
    const query = {
      set: jest.fn(),
      where: jest.fn(),
      returning: jest.fn(),
      executeTakeFirst: jest.fn().mockResolvedValue({ id: 'share-id' }),
    };
    query.set.mockReturnValue(query);
    query.where.mockReturnValue(query);
    query.returning.mockReturnValue(query);
    const repo = new ShareRepo(
      { updateTable: jest.fn().mockReturnValue(query) } as any,
      {} as any,
    );

    await repo.updateShare({ searchIndexing: true }, 'share-id');

    expect(query.set.mock.calls[0][0]).not.toHaveProperty('passwordVersion');
  });

  it('uses database-side version increments for concurrent password rotations', async () => {
    const queries = ['first', 'second'].map((id) => {
      const query = {
        set: jest.fn(),
        where: jest.fn(),
        returning: jest.fn(),
        executeTakeFirst: jest.fn().mockResolvedValue({ id }),
      };
      query.set.mockReturnValue(query);
      query.where.mockReturnValue(query);
      query.returning.mockReturnValue(query);
      return query;
    });
    const db = {
      updateTable: jest
        .fn()
        .mockReturnValueOnce(queries[0])
        .mockReturnValueOnce(queries[1]),
    };
    const repo = new ShareRepo(db as any, {} as any);

    await Promise.all([
      repo.setPassword('share-id', 'first-hash'),
      repo.setPassword('share-id', 'second-hash'),
    ]);

    for (const query of queries) {
      expect(query.set).toHaveBeenCalledWith(
        expect.objectContaining({ passwordVersion: expect.anything() }),
      );
    }
  });
});
