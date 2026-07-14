import { EventName } from '../../../common/events/event.contants';
import { PageRepo } from './page.repo';

describe('PageRepo', () => {
  it('emits page update events with workspace ids returned by the database', async () => {
    const query = fluentUpdateQuery([
      { id: 'page-1', workspaceId: 'workspace-1' },
      { id: 'page-2', workspaceId: 'workspace-2' },
      { id: 'page-3', workspaceId: 'workspace-1' },
    ]);
    const db = { updateTable: jest.fn().mockReturnValue(query) };
    const eventEmitter = { emit: jest.fn() };
    const repo = new PageRepo(db as any, {} as any, eventEmitter as any);

    const result = await repo.updatePages(
      { title: 'Updated' },
      ['page-1', 'page-2', 'page-3'],
    );

    expect(query.returning).toHaveBeenCalledWith(['id', 'workspaceId']);
    expect(result).toEqual([
      { id: 'page-1', workspaceId: 'workspace-1' },
      { id: 'page-2', workspaceId: 'workspace-2' },
      { id: 'page-3', workspaceId: 'workspace-1' },
    ]);
    expect(eventEmitter.emit).toHaveBeenCalledTimes(2);
    expect(eventEmitter.emit).toHaveBeenCalledWith(EventName.PAGE_UPDATED, {
      pageIds: ['page-1', 'page-3'],
      workspaceId: 'workspace-1',
    });
    expect(eventEmitter.emit).toHaveBeenCalledWith(EventName.PAGE_UPDATED, {
      pageIds: ['page-2'],
      workspaceId: 'workspace-2',
    });
  });

  it('does not emit when no page was updated or event emission is disabled', async () => {
    const eventEmitter = { emit: jest.fn() };
    const emptyQuery = fluentUpdateQuery([]);
    const db = { updateTable: jest.fn().mockReturnValue(emptyQuery) };
    const repo = new PageRepo(db as any, {} as any, eventEmitter as any);

    await repo.updatePage({ title: 'Missing' }, 'missing-page');
    expect(eventEmitter.emit).not.toHaveBeenCalled();

    const silentQuery = fluentUpdateQuery([
      { id: 'page-1', workspaceId: 'workspace-1' },
    ]);
    db.updateTable.mockReturnValue(silentQuery);
    await repo.updatePage({ title: 'Silent' }, 'page-1', undefined, false);
    expect(eventEmitter.emit).not.toHaveBeenCalled();
  });
});

function fluentUpdateQuery(result: Array<{ id: string; workspaceId: string }>) {
  const query: Record<string, jest.Mock> = {};
  for (const method of ['set', 'where', 'returning']) {
    query[method] = jest.fn().mockReturnValue(query);
  }
  query.execute = jest.fn().mockResolvedValue(result);
  return query;
}
