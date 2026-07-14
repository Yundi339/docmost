import {
  DatabaseContentLifecycleContributor,
  getRemovedDatabaseBlocks,
} from './database-content-lifecycle.contributor';

function doc(...content: unknown[]) {
  return { type: 'doc', content };
}

function databaseBlock(databaseId: string) {
  return {
    type: 'databaseBlock',
    attrs: { databaseId, blockId: `block_${databaseId}` },
  };
}

describe('database content lifecycle', () => {
  it('detects database blocks removed from nested page content', () => {
    const previous = doc({
      type: 'column',
      content: [databaseBlock('database_1')],
    });
    const next = doc({ type: 'column', content: [] });

    expect(getRemovedDatabaseBlocks(previous, next)).toEqual([
      { databaseId: 'database_1', blockId: 'block_database_1' },
    ]);
  });

  it('does not treat a block move within the document as deletion', () => {
    const previous = doc(databaseBlock('database_1'), { type: 'paragraph' });
    const next = doc({ type: 'paragraph' }, databaseBlock('database_1'));

    expect(getRemovedDatabaseBlocks(previous, next)).toEqual([]);
  });

  it('keeps the resource while another reference remains', () => {
    const previous = doc(
      databaseBlock('database_1'),
      databaseBlock('database_1'),
    );
    const next = doc(databaseBlock('database_1'));

    expect(getRemovedDatabaseBlocks(previous, next)).toEqual([]);
  });

  it('treats replacing the owner block id as removing the owner block', () => {
    const previous = doc(databaseBlock('database_1'));
    const next = doc({
      type: 'databaseBlock',
      attrs: { databaseId: 'database_1', blockId: 'forged_block' },
    });

    expect(getRemovedDatabaseBlocks(previous, next)).toEqual([
      { databaseId: 'database_1', blockId: 'block_database_1' },
    ]);
  });

  it('runs deletion in the save transaction and defers side effects', async () => {
    const deferredEffect = jest.fn();
    const databaseService = {
      deleteDatabaseFromPageContent: jest
        .fn()
        .mockResolvedValue(deferredEffect),
    };
    const lifecycle = { register: jest.fn(), unregister: jest.fn() };
    const contributor = new DatabaseContentLifecycleContributor(
      lifecycle as never,
      databaseService as never,
    );
    const trx = {};
    const actor = { id: 'user_1', workspaceId: 'workspace_1' };

    contributor.onModuleInit();
    const effect = await contributor.beforeSave({
      page: { id: 'page_1' } as never,
      previousContent: doc(databaseBlock('database_1')),
      nextContent: doc({ type: 'paragraph' }),
      actor: actor as never,
      trx: trx as never,
      origin: 'collaboration',
    });

    expect(lifecycle.register).toHaveBeenCalledWith(contributor);
    expect(databaseService.deleteDatabaseFromPageContent).toHaveBeenCalledWith(
      'database_1',
      'page_1',
      'block_database_1',
      actor,
      trx,
    );
    expect(deferredEffect).not.toHaveBeenCalled();
    await effect?.();
    expect(deferredEffect).toHaveBeenCalledTimes(1);
  });

  it('rejects implicit board deletion from direct content replacement', async () => {
    const databaseService = {
      deleteDatabaseFromPageContent: jest
        .fn()
        .mockRejectedValue(new Error('explicit deletion required')),
    };
    const contributor = new DatabaseContentLifecycleContributor(
      { register: jest.fn(), unregister: jest.fn() } as never,
      databaseService as never,
    );

    await expect(
      contributor.validateBeforeSave({
        page: { id: 'page_1' } as never,
        previousContent: doc(databaseBlock('database_1')),
        nextContent: doc({ type: 'paragraph' }),
        actor: { id: 'user_1', workspaceId: 'workspace_1' } as never,
        trx: {} as never,
        origin: 'direct',
      }),
    ).rejects.toThrow('explicit deletion required');

    expect(databaseService.deleteDatabaseFromPageContent).toHaveBeenCalledWith(
      'database_1',
      'page_1',
      'block_database_1',
      expect.objectContaining({ id: 'user_1' }),
      expect.anything(),
      true,
    );
  });
});
