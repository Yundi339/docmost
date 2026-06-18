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

const { PageService } = require('./page.service') as typeof import(
  './page.service'
);

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
    updatePage: jest.fn(),
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
    {} as any,
    {} as any,
    {} as any,
    {} as any,
  );

  jest
    .spyOn(service as any, 'lockSpaceTreeForMove')
    .mockResolvedValue(undefined);
  jest.spyOn(service as any, 'isPageInSubtree').mockResolvedValue(false);

  return { db, pageRepo, service, trx };
}

describe('PageService.movePage', () => {
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
