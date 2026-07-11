import { BadRequestException, NotFoundException } from '@nestjs/common';
import { Page } from '@docmost/db/types/entity.types';

jest.mock('@docmost/editor-ext', () => ({
  markdownToHtml: jest.fn(),
}));

jest.mock('../../../collaboration/collaboration.gateway', () => ({
  CollaborationGateway: jest.fn(),
}));

jest.mock('../../../common/helpers/prosemirror/utils', () => ({
  createYdocFromJson: jest.fn(),
  getAttachmentIds: jest.fn(),
  getProsemirrorContent: jest.fn(),
  isAttachmentNode: jest.fn(),
  removeMarkTypeFromDoc: jest.fn(),
}));

jest.mock('../../../integrations/export/utils', () => ({
  INTERNAL_LINK_REGEX: /$^/,
  extractPageSlugId: jest.fn((slug: string) => slug),
}));

jest.mock(
  'src/collaboration/collaboration.util',
  () => ({
    htmlToJson: jest.fn(),
    jsonToNode: jest.fn(),
    jsonToText: jest.fn(),
  }),
  { virtual: true },
);

// Load after Jest mocks above so their module factories are applied first.
const { PageService } =
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  require('./page.service') as typeof import('./page.service');

function page(overrides: Partial<Page>): Page {
  return {
    id: 'page-id',
    slugId: 'slug-id',
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

function createService() {
  const trx = {};
  const pageRepo = {
    findById: jest.fn(),
    insertPage: jest.fn(),
    removePage: jest.fn().mockResolvedValue(undefined),
    updatePage: jest.fn(),
  };
  const generalQueue = {
    add: jest.fn().mockResolvedValue(undefined),
  };
  const collaborationGateway = {
    handleYjsEvent: jest.fn().mockResolvedValue(undefined),
  };
  const wsTreeService = {
    capturePageAudience: jest.fn().mockResolvedValue({
      spaceId: 'space-id',
      userIds: [],
    }),
    notifyPageCreated: jest.fn().mockResolvedValue(undefined),
    notifyPageDeleted: jest.fn().mockResolvedValue(undefined),
    notifyPageRelocated: jest.fn().mockResolvedValue(undefined),
    notifyPageUpdated: jest.fn().mockResolvedValue(undefined),
  };
  const db = {
    transaction: jest.fn(() => ({
      execute: jest.fn((callback) => callback(trx)),
    })),
  };

  const service = new PageService(
    pageRepo as any,
    {} as any,
    {} as any,
    db as any,
    {} as any,
    {} as any,
    {} as any,
    generalQueue as any,
    {} as any,
    collaborationGateway as any,
    {} as any,
    wsTreeService as any,
  );

  jest
    .spyOn(service as any, 'lockSpaceTreeForMove')
    .mockResolvedValue(undefined);
  jest.spyOn(service as any, 'isPageInSubtree').mockResolvedValue(false);

  return {
    collaborationGateway,
    db,
    generalQueue,
    pageRepo,
    service,
    trx,
    wsTreeService,
  };
}

describe('PageService.create', () => {
  it('persists pages through the repository lifecycle event source', async () => {
    const { pageRepo, service } = createService();
    const createdPage = page({ title: 'Created through MCP' });
    pageRepo.insertPage.mockResolvedValue(createdPage);
    jest.spyOn(service, 'nextPagePosition').mockResolvedValue('a0');

    await service.create('mcp-user', 'workspace-id', {
      spaceId: createdPage.spaceId,
      title: createdPage.title,
    });

    expect(pageRepo.insertPage).toHaveBeenCalledWith(
      expect.objectContaining({
        spaceId: createdPage.spaceId,
        title: createdPage.title,
        workspaceId: 'workspace-id',
      }),
    );
  });
});

describe('PageService.update', () => {
  it('broadcasts metadata updates from server-side callers', async () => {
    const { pageRepo, service, wsTreeService } = createService();
    const existingPage = page({ contributorIds: [] });
    const updatedPage = page({ title: 'Updated page' });
    pageRepo.findById.mockResolvedValue(updatedPage);

    await service.update(
      existingPage,
      { pageId: existingPage.id, title: updatedPage.title },
      { id: 'mcp-user' } as any,
    );

    expect(wsTreeService.notifyPageUpdated).toHaveBeenCalledWith(updatedPage);
  });

  it('leaves content-only updates to the collaboration channel', async () => {
    const { collaborationGateway, pageRepo, service, wsTreeService } =
      createService();
    const existingPage = page({ contributorIds: [] });
    pageRepo.findById.mockResolvedValue(existingPage);

    await service.update(
      existingPage,
      {
        pageId: existingPage.id,
        content: '# Updated',
        format: 'markdown',
        operation: 'replace',
      },
      { id: 'mcp-user' } as any,
    );

    expect(collaborationGateway.handleYjsEvent).toHaveBeenCalled();
    expect(wsTreeService.notifyPageUpdated).not.toHaveBeenCalled();
  });
});

describe('PageService.removePage', () => {
  it('uses the repository lifecycle event source for server-side callers', async () => {
    const { pageRepo, service } = createService();
    const pageId = 'page-id';

    await service.removePage(pageId, 'mcp-user', 'workspace-id');

    expect(pageRepo.removePage).toHaveBeenCalledWith(
      pageId,
      'mcp-user',
      'workspace-id',
    );
  });
});

describe('PageService.movePage', () => {
  it('synchronizes server-side reparenting to connected clients', async () => {
    const { pageRepo, service, wsTreeService } = createService();
    const movedPage = page({ id: 'moved-page', parentPageId: 'old-parent' });
    const relocatedPage = page({
      id: movedPage.id,
      parentPageId: null,
      position: 'b0',
    });
    pageRepo.findById
      .mockResolvedValueOnce(movedPage)
      .mockResolvedValueOnce(relocatedPage);
    jest.spyOn(service as any, 'nextPagePositionIn').mockResolvedValue('b0');

    await service.movePageToParent(movedPage, null);

    expect(wsTreeService.notifyPageRelocated).toHaveBeenCalledWith(
      movedPage,
      relocatedPage,
      false,
      { spaceId: movedPage.spaceId, userIds: [] },
    );
  });

  it('updates only the moved page when changing parent', async () => {
    const { pageRepo, service, trx } = createService();
    const movedPage = page({ id: 'moved-page', parentPageId: null });
    const targetParent = page({ id: 'target-parent' });
    pageRepo.findById
      .mockResolvedValueOnce(movedPage)
      .mockResolvedValueOnce(targetParent);

    await service.movePage(
      {
        pageId: movedPage.id,
        parentPageId: targetParent.id,
        position: 'a0',
      },
      movedPage,
    );

    expect(pageRepo.updatePage).toHaveBeenCalledWith(
      {
        position: 'a0',
        parentPageId: targetParent.id,
      },
      movedPage.id,
      trx,
    );
  });

  it('rejects moving a page under itself or its descendants', async () => {
    const { pageRepo, service } = createService();
    const movedPage = page({ id: 'moved-page' });
    const descendant = page({
      id: 'descendant-page',
      parentPageId: movedPage.id,
    });
    pageRepo.findById
      .mockResolvedValueOnce(movedPage)
      .mockResolvedValueOnce(descendant);
    jest.spyOn(service as any, 'isPageInSubtree').mockResolvedValue(true);

    await expect(
      service.movePage(
        {
          pageId: movedPage.id,
          parentPageId: descendant.id,
          position: 'a0',
        },
        movedPage,
      ),
    ).rejects.toBeInstanceOf(BadRequestException);

    expect(pageRepo.updatePage).not.toHaveBeenCalled();
  });

  it('rejects when the moved page was deleted before the transaction writes', async () => {
    const { pageRepo, service } = createService();
    const movedPage = page({ id: 'moved-page' });
    pageRepo.findById.mockResolvedValueOnce(
      page({
        id: movedPage.id,
        deletedAt: new Date('2026-01-02T00:00:00.000Z'),
      }),
    );

    await expect(
      service.movePage(
        {
          pageId: movedPage.id,
          parentPageId: null,
          position: 'a0',
        },
        movedPage,
      ),
    ).rejects.toBeInstanceOf(NotFoundException);

    expect(pageRepo.updatePage).not.toHaveBeenCalled();
  });
});
