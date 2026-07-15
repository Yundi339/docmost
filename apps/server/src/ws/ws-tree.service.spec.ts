import { Page } from '@docmost/db/types/entity.types';
import { WsTreeService } from './ws-tree.service';

function page(overrides: Partial<Page> = {}): Page {
  return {
    id: 'page-id',
    slugId: 'page-slug',
    title: 'Page',
    icon: null,
    coverPhoto: null,
    position: 'a0',
    parentPageId: null,
    creatorId: 'user-id',
    lastUpdatedById: 'user-id',
    spaceId: 'space-id',
    workspaceId: 'workspace-id',
    isLocked: false,
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    updatedAt: new Date('2026-01-01T00:00:00.000Z'),
    deletedAt: null,
    contributorIds: [],
    ...overrides,
  } as Page;
}

function createService(currentAudience: string[]) {
  const wsService = {
    emitToUsers: jest.fn().mockResolvedValue(undefined),
    emitTreeEvent: jest.fn().mockResolvedValue(undefined),
    emitPageEvent: jest.fn().mockResolvedValue(undefined),
    getAuthorizedTreeUserIds: jest.fn().mockResolvedValue(currentAudience),
  };
  const pageRepo = {
    getSiblingIndex: jest.fn().mockResolvedValue(1),
  };

  return {
    service: new WsTreeService(wsService as any, pageRepo as any),
    wsService,
  };
}

describe('WsTreeService.notifyPageRelocated', () => {
  it('sends delete, move, and add events to the correct users after a permission change', async () => {
    const oldPage = page({ parentPageId: 'old-parent' });
    const currentPage = page({ parentPageId: 'new-parent', position: 'b0' });
    const { service, wsService } = createService([
      'retained-user',
      'added-user',
    ]);

    await service.notifyPageRelocated(oldPage, currentPage, false, {
      spaceId: oldPage.spaceId,
      userIds: ['removed-user', 'retained-user'],
    });

    expect(wsService.emitToUsers).toHaveBeenNthCalledWith(
      1,
      ['removed-user'],
      expect.objectContaining({ operation: 'deleteTreeNode' }),
    );
    expect(wsService.emitToUsers).toHaveBeenNthCalledWith(
      2,
      ['retained-user'],
      expect.objectContaining({ operation: 'moveTreeNode' }),
    );
    expect(wsService.emitToUsers).toHaveBeenNthCalledWith(
      3,
      ['added-user'],
      expect.objectContaining({ operation: 'addTreeNode' }),
    );
  });

  it('removes from the source space and adds to the destination space', async () => {
    const oldPage = page({ spaceId: 'source-space' });
    const currentPage = page({ spaceId: 'target-space' });
    const { service, wsService } = createService(['target-user']);

    await service.notifyPageRelocated(oldPage, currentPage, true, {
      spaceId: oldPage.spaceId,
      userIds: ['source-user'],
    });

    expect(wsService.emitToUsers).toHaveBeenNthCalledWith(
      1,
      ['source-user'],
      expect.objectContaining({
        operation: 'deleteTreeNode',
        spaceId: 'source-space',
      }),
    );
    expect(wsService.emitToUsers).toHaveBeenNthCalledWith(
      2,
      ['target-user'],
      expect.objectContaining({
        operation: 'addTreeNode',
        spaceId: 'target-space',
      }),
    );
  });
});

describe('WsTreeService.notifyPageQueriesInvalidated', () => {
  it('scopes query invalidations to the page permission boundary', async () => {
    const { service, wsService } = createService([]);

    await service.notifyPageQueriesInvalidated(page(), [
      { entity: 'database', id: 'database-id' },
      { entity: 'database-records', id: 'database-id' },
    ]);

    expect(wsService.emitPageEvent).toHaveBeenNthCalledWith(
      1,
      'space-id',
      'page-id',
      {
        operation: 'invalidate',
        spaceId: 'space-id',
        entity: ['database'],
        id: 'database-id',
      },
    );
    expect(wsService.emitPageEvent).toHaveBeenNthCalledWith(
      2,
      'space-id',
      'page-id',
      expect.objectContaining({ entity: ['database-records'] }),
    );
  });

  it('removes deleted resource queries without refetching them', async () => {
    const { service, wsService } = createService([]);

    await service.notifyPageQueriesInvalidated(page(), [
      { entity: 'database', id: 'database-id', mode: 'remove' },
    ]);

    expect(wsService.emitPageEvent).toHaveBeenCalledWith(
      'space-id',
      'page-id',
      {
        operation: 'removeQuery',
        spaceId: 'space-id',
        entity: ['database'],
        id: 'database-id',
      },
    );
  });
});
