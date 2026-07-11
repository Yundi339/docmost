import { Page } from '@docmost/db/types/entity.types';
import { WsPageListener } from './ws-page.listener';

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

function createListener(pages: Page[]) {
  const pageById = new Map(pages.map((item) => [item.id, item]));
  const pageRepo = {
    findById: jest.fn((pageId: string) => pageById.get(pageId)),
  };
  const wsTreeService = {
    notifyPageCreated: jest.fn().mockResolvedValue(undefined),
    notifyPageDeleted: jest.fn().mockResolvedValue(undefined),
  };

  return {
    listener: new WsPageListener(pageRepo as any, wsTreeService as any),
    pageRepo,
    wsTreeService,
  };
}

describe('WsPageListener', () => {
  it('announces only roots when a lifecycle event contains a page tree', async () => {
    const root = Object.assign(page({ id: 'root' }), { hasChildren: true });
    const child = Object.assign(
      page({ id: 'child', parentPageId: root.id }),
      { hasChildren: false },
    );
    const { listener, wsTreeService } = createListener([root, child]);

    await listener.handlePageCreated({
      pageIds: [root.id, child.id],
      workspaceId: root.workspaceId,
    });

    expect(wsTreeService.notifyPageCreated).toHaveBeenCalledTimes(1);
    expect(wsTreeService.notifyPageCreated).toHaveBeenCalledWith(root, true);
  });

  it('removes only roots when a page tree is moved to trash', async () => {
    const root = page({ id: 'root' });
    const child = page({ id: 'child', parentPageId: root.id });
    const { listener, wsTreeService } = createListener([root, child]);

    await listener.handlePageSoftDeleted({
      pageIds: [root.id, child.id],
      workspaceId: root.workspaceId,
    });

    expect(wsTreeService.notifyPageDeleted).toHaveBeenCalledTimes(1);
    expect(wsTreeService.notifyPageDeleted).toHaveBeenCalledWith(root);
  });

  it('re-adds restored roots with their child indicator', async () => {
    const restored = Object.assign(page({ id: 'restored' }), {
      hasChildren: true,
    });
    const { listener, wsTreeService } = createListener([restored]);

    await listener.handlePageRestored({
      pageIds: [restored.id],
      workspaceId: restored.workspaceId,
    });

    expect(wsTreeService.notifyPageCreated).toHaveBeenCalledWith(
      restored,
      true,
    );
  });
});
