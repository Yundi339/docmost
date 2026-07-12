import { BacklinkRepo } from './backlink.repo';

describe('BacklinkRepo', () => {
  it('updates only the requested backlink in the backlinks table', async () => {
    const query = fluentQuery();
    const db = { updateTable: jest.fn().mockReturnValue(query) };
    const repo = new BacklinkRepo(db as any, {} as any);
    const updatedAt = new Date();

    await repo.updateBacklink({ updatedAt } as any, 'backlink-id');

    expect(db.updateTable).toHaveBeenCalledWith('backlinks');
    expect(query.set).toHaveBeenCalledWith({ updatedAt });
    expect(query.where).toHaveBeenCalledWith('id', '=', 'backlink-id');
    expect(query.execute).toHaveBeenCalledTimes(1);
  });
});

function fluentQuery() {
  const query: Record<string, jest.Mock> = {};
  for (const method of ['set', 'where']) {
    query[method] = jest.fn().mockReturnValue(query);
  }
  query.execute = jest.fn().mockResolvedValue(undefined);
  return query;
}
