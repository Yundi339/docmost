import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
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

jest.mock('src/collaboration/collaboration.util', () => ({
  htmlToJson: jest.fn(),
  jsonToNode: jest.fn(),
  jsonToText: jest.fn(),
}));

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
    updatePages: jest.fn(),
    getPageAndDescendants: jest.fn(),
  };
  const generalQueue = {
    add: jest.fn().mockResolvedValue(undefined),
  };
  const eventEmitter = {
    emit: jest.fn(),
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
  const pageOperationPolicy = {
    assertOperation: jest.fn().mockResolvedValue(undefined),
    addMetadata: jest.fn().mockImplementation(async (pages) => pages),
  };
  const pageContentLifecycle = {
    validateBeforeSave: jest.fn().mockResolvedValue(undefined),
  };
  const pageAccessService = {
    validateCanEdit: jest.fn().mockResolvedValue({ hasRestriction: false }),
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
    eventEmitter as any,
    collaborationGateway as any,
    {} as any,
    wsTreeService as any,
    pageOperationPolicy as any,
    pageContentLifecycle as any,
    pageAccessService as any,
  );

  jest
    .spyOn(service as any, 'lockSpaceTreeForMove')
    .mockResolvedValue(undefined);
  jest.spyOn(service as any, 'isPageInSubtree').mockResolvedValue(false);

  return {
    collaborationGateway,
    db,
    eventEmitter,
    generalQueue,
    pageRepo,
    pageContentLifecycle,
    pageAccessService,
    pageOperationPolicy,
    service,
    trx,
    wsTreeService,
  };
}

describe('PageService.create', () => {
  it('persists pages through the repository lifecycle event source', async () => {
    const { eventEmitter, pageRepo, service, trx } = createService();
    const createdPage = page({ title: 'Created through MCP' });
    pageRepo.insertPage.mockResolvedValue(createdPage);
    jest.spyOn(service as any, 'nextPagePositionIn').mockResolvedValue('a0');

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
      trx,
      false,
    );
    expect(eventEmitter.emit).toHaveBeenCalledWith('page.created', {
      pageIds: [createdPage.id],
      workspaceId: createdPage.workspaceId,
    });
  });

  it('applies extension policy before creating a child page', async () => {
    const { pageOperationPolicy, pageRepo, service } = createService();
    const parent = page({ id: 'board-page' });
    pageRepo.findById.mockResolvedValue(parent);
    pageOperationPolicy.assertOperation.mockRejectedValue(
      new ConflictException('Create work items from the board'),
    );

    await expect(
      service.create('mcp-user', 'workspace-id', {
        spaceId: parent.spaceId,
        parentPageId: parent.id,
        title: 'Bypass attempt',
      }),
    ).rejects.toBeInstanceOf(ConflictException);

    expect(pageRepo.insertPage).not.toHaveBeenCalled();
  });

  it('rejects a parent page from another workspace', async () => {
    const { pageOperationPolicy, pageRepo, service } = createService();
    const parent = page({
      id: 'foreign-parent',
      workspaceId: 'other-workspace',
    });
    pageRepo.findById.mockResolvedValue(parent);

    await expect(
      service.create('mcp-user', 'workspace-id', {
        spaceId: parent.spaceId,
        parentPageId: parent.id,
        title: 'Cross-workspace child',
      }),
    ).rejects.toBeInstanceOf(NotFoundException);

    expect(pageOperationPolicy.assertOperation).not.toHaveBeenCalled();
    expect(pageRepo.insertPage).not.toHaveBeenCalled();
  });

  it('locks and revalidates the parent inside the creation transaction', async () => {
    const { pageOperationPolicy, pageRepo, service, trx } = createService();
    const parent = page({ id: 'parent-page' });
    const createdPage = page({ id: 'child-page', parentPageId: parent.id });
    pageRepo.findById.mockResolvedValue(parent);
    pageRepo.insertPage.mockResolvedValue(createdPage);
    jest.spyOn(service as any, 'nextPagePositionIn').mockResolvedValue('a1');

    await service.create('mcp-user', parent.workspaceId, {
      spaceId: parent.spaceId,
      parentPageId: parent.id,
      title: 'Concurrent child',
    });

    expect(pageRepo.findById).toHaveBeenCalledWith(parent.id, {
      trx,
      withLock: true,
    });
    expect(pageOperationPolicy.assertOperation).toHaveBeenCalledWith(
      expect.objectContaining({
        operation: 'createChild',
        parentPage: parent,
        actorId: 'mcp-user',
        trx,
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
      { id: 'mcp-user', workspaceId: existingPage.workspaceId } as any,
    );

    expect(wsTreeService.notifyPageUpdated).toHaveBeenCalledWith(updatedPage);
  });

  it('leaves content-only updates to the collaboration channel', async () => {
    const {
      collaborationGateway,
      pageAccessService,
      pageRepo,
      service,
      wsTreeService,
    } = createService();
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
      { id: 'mcp-user', workspaceId: existingPage.workspaceId } as any,
    );

    expect(collaborationGateway.handleYjsEvent).toHaveBeenCalled();
    expect(pageAccessService.validateCanEdit).toHaveBeenCalledWith(
      existingPage,
      expect.objectContaining({ id: 'mcp-user' }),
    );
    expect(wsTreeService.notifyPageUpdated).not.toHaveBeenCalled();
  });

  it('allows a direct replacement to clear all page content', async () => {
    const { collaborationGateway, pageRepo, service } = createService();
    const existingPage = page({ contributorIds: [] });
    pageRepo.findById.mockResolvedValue(existingPage);

    await service.update(
      existingPage,
      {
        pageId: existingPage.id,
        content: '',
        format: 'markdown',
        operation: 'replace',
      },
      { id: 'mcp-user', workspaceId: existingPage.workspaceId } as any,
    );

    expect(collaborationGateway.handleYjsEvent).toHaveBeenCalledWith(
      'updatePageContent',
      `page.${existingPage.id}`,
      expect.objectContaining({ operation: 'replace' }),
    );
  });

  it('does not persist metadata when direct content replacement is rejected', async () => {
    const { collaborationGateway, pageRepo, service } = createService();
    const existingPage = page({ contributorIds: [] });
    pageRepo.findById.mockResolvedValue(existingPage);
    collaborationGateway.handleYjsEvent.mockRejectedValue(
      new ConflictException('Explicit board deletion required'),
    );

    await expect(
      service.update(
        existingPage,
        {
          pageId: existingPage.id,
          title: 'Must not be partially applied',
          content: '# Replacement',
          format: 'markdown',
          operation: 'replace',
        },
        { id: 'mcp-user', workspaceId: existingPage.workspaceId } as any,
      ),
    ).rejects.toBeInstanceOf(ConflictException);

    expect(pageRepo.updatePage).not.toHaveBeenCalled();
  });

  it('preflights destructive replacements before mutating the Yjs document', async () => {
    const { collaborationGateway, pageContentLifecycle, pageRepo, service } =
      createService();
    const existingPage = page({ contributorIds: [] });
    pageRepo.findById.mockResolvedValue(existingPage);
    pageContentLifecycle.validateBeforeSave.mockRejectedValue(
      new ConflictException('Explicit board deletion required'),
    );

    await expect(
      service.update(
        existingPage,
        {
          pageId: existingPage.id,
          content: '# Replacement',
          format: 'markdown',
          operation: 'replace',
        },
        { id: 'mcp-user', workspaceId: existingPage.workspaceId } as any,
      ),
    ).rejects.toBeInstanceOf(ConflictException);

    expect(pageContentLifecycle.validateBeforeSave).toHaveBeenCalledWith(
      expect.objectContaining({
        page: existingPage,
        origin: 'direct',
      }),
    );
    expect(collaborationGateway.handleYjsEvent).not.toHaveBeenCalled();
    expect(pageRepo.updatePage).not.toHaveBeenCalled();
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
  it('routes same-space move requests through the parent move path', async () => {
    const { pageRepo, service } = createService();
    const movedPage = page({ id: 'moved-page', parentPageId: 'old-parent' });
    const moveToParent = jest
      .spyOn(service, 'movePageToParent')
      .mockResolvedValue(undefined);

    await expect(
      service.movePageToSpace(movedPage, movedPage.spaceId, 'user-id', null),
    ).resolves.toEqual({ childPageIds: [] });

    expect(moveToParent).toHaveBeenCalledWith(
      movedPage,
      null,
      'user-id',
      undefined,
      true,
    );
    expect(pageRepo.updatePage).not.toHaveBeenCalled();
  });

  it('rejects a cross-space target parent outside the destination space', async () => {
    const { pageRepo, service } = createService();
    const movedPage = page({ id: 'moved-page', spaceId: 'source-space' });
    const wrongParent = page({ id: 'wrong-parent', spaceId: 'source-space' });
    pageRepo.getPageAndDescendants.mockResolvedValue([movedPage]);
    pageRepo.findById.mockResolvedValue(wrongParent);
    jest
      .spyOn(service as any, 'filterAccessibleTreePages')
      .mockResolvedValue([movedPage]);

    await expect(
      service.movePageToSpace(
        movedPage,
        'destination-space',
        'user-id',
        wrongParent.id,
      ),
    ).rejects.toBeInstanceOf(NotFoundException);

    expect(pageRepo.updatePage).not.toHaveBeenCalled();
  });

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

    await service.movePageToParent(movedPage, null, 'user-id');

    expect(wsTreeService.notifyPageRelocated).toHaveBeenCalledWith(
      movedPage,
      relocatedPage,
      false,
      { spaceId: movedPage.spaceId, userIds: [] },
    );
  });

  it('applies extension policy before moving a page', async () => {
    const { pageOperationPolicy, pageRepo, service } = createService();
    const movedPage = page({ id: 'managed-work-item' });
    pageRepo.findById.mockResolvedValueOnce(movedPage);
    pageOperationPolicy.assertOperation.mockRejectedValue(
      new ConflictException('Move this work item from the board'),
    );

    await expect(
      service.movePageToParent(movedPage, null, 'mcp-user'),
    ).rejects.toBeInstanceOf(ConflictException);

    expect(pageRepo.updatePage).not.toHaveBeenCalled();
  });

  it('rejects a same-space parent from another workspace', async () => {
    const { pageOperationPolicy, pageRepo, service } = createService();
    const movedPage = page({ id: 'moved-page' });
    const foreignParent = page({
      id: 'foreign-parent',
      workspaceId: 'other-workspace',
    });
    pageRepo.findById
      .mockResolvedValueOnce(movedPage)
      .mockResolvedValueOnce(foreignParent);

    await expect(
      service.movePageToParent(movedPage, foreignParent.id, 'user-id'),
    ).rejects.toBeInstanceOf(NotFoundException);

    expect(pageOperationPolicy.assertOperation).not.toHaveBeenCalled();
    expect(pageRepo.updatePage).not.toHaveBeenCalled();
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
      'user-id',
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
        'user-id',
      ),
    ).rejects.toBeInstanceOf(BadRequestException);

    expect(pageRepo.updatePage).not.toHaveBeenCalled();
  });

  it('rejects drag-and-drop to a same-space parent in another workspace', async () => {
    const { pageOperationPolicy, pageRepo, service } = createService();
    const movedPage = page({ id: 'moved-page' });
    const foreignParent = page({
      id: 'foreign-parent',
      workspaceId: 'other-workspace',
    });
    pageRepo.findById
      .mockResolvedValueOnce(movedPage)
      .mockResolvedValueOnce(foreignParent);

    await expect(
      service.movePage(
        {
          pageId: movedPage.id,
          parentPageId: foreignParent.id,
          position: 'a0',
        },
        movedPage,
        'user-id',
      ),
    ).rejects.toBeInstanceOf(NotFoundException);

    expect(pageOperationPolicy.assertOperation).not.toHaveBeenCalled();
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
        'user-id',
      ),
    ).rejects.toBeInstanceOf(NotFoundException);

    expect(pageRepo.updatePage).not.toHaveBeenCalled();
  });
});
