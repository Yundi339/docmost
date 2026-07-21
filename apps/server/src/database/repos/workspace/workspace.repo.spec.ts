import { WorkspaceRepo } from './workspace.repo';

describe('WorkspaceRepo active lookups', () => {
  const createQuery = () => {
    const query: any = {
      select: jest.fn(() => query),
      where: jest.fn(() => query),
      orderBy: jest.fn(() => query),
      limit: jest.fn(() => query),
      executeTakeFirst: jest.fn().mockResolvedValue(undefined),
    };
    const db = { selectFrom: jest.fn(() => query) };
    return { db, query };
  };

  it('keeps null-status workspaces eligible while excluding deleted workspaces', async () => {
    const { db, query } = createQuery();
    const repo = new WorkspaceRepo(db as any);

    await repo.findActiveById('workspace-1');

    expect(query.where).toHaveBeenCalledWith('id', '=', 'workspace-1');
    expect(query.where).toHaveBeenCalledWith('deletedAt', 'is', null);
    expect(query.where).not.toHaveBeenCalledWith('status', '=', 'active');
    expect(query.where).toHaveBeenCalledTimes(3);
  });
});
