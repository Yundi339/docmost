import { NotFoundException } from '@nestjs/common';
import { ShareService } from './share.service';

describe('ShareService public board boundaries', () => {
  const share = {
    id: 'share-id',
    pageId: 'page-id',
    spaceId: 'space-id',
    workspaceId: 'workspace-id',
    includeSubPages: true,
  };
  const boardContent = {
    type: 'doc',
    content: [
      {
        type: 'databaseBlock',
        attrs: {
          databaseId: 'database-id',
          blockId: 'block-id',
          title: 'Board title',
        },
      },
    ],
  };

  let pageRepo: { findById: jest.Mock };
  let pagePermissionRepo: { hasRestrictedAncestor: jest.Mock };
  let service: ShareService;

  beforeEach(() => {
    pageRepo = { findById: jest.fn() };
    pagePermissionRepo = {
      hasRestrictedAncestor: jest.fn().mockResolvedValue(false),
    };
    service = new ShareService(
      { findPasswordStateById: jest.fn() } as any,
      pageRepo as any,
      pagePermissionRepo as any,
      {} as any,
      {} as any,
    );
    jest.spyOn(service, 'getShareForPage').mockResolvedValue(share as any);
  });

  it('returns a board only as an opaque editor node and never projects records', async () => {
    const page = {
      id: 'page-id',
      workspaceId: 'workspace-id',
      spaceId: 'space-id',
      deletedAt: null,
      content: boardContent,
    };
    pageRepo.findById.mockResolvedValue(page);
    jest
      .spyOn(service, 'updatePublicAttachments')
      .mockResolvedValue(boardContent);

    const result = await service.getSharedPage(
      { pageId: 'page-id' },
      'workspace-id',
    );

    expect(result).toEqual({ page, share });
    expect(result.page.content).toBe(boardContent);
    expect(result).not.toHaveProperty('records');
    expect(result).not.toHaveProperty('databaseRecords');
  });

  it('rejects a restricted board host before transforming public content', async () => {
    pageRepo.findById.mockResolvedValue({
      id: 'page-id',
      workspaceId: 'workspace-id',
      spaceId: 'space-id',
      deletedAt: null,
      content: boardContent,
    });
    pagePermissionRepo.hasRestrictedAncestor.mockResolvedValue(true);
    const updatePublicAttachments = jest.spyOn(
      service,
      'updatePublicAttachments',
    );

    await expect(
      service.getSharedPage({ pageId: 'page-id' }, 'workspace-id'),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(updatePublicAttachments).not.toHaveBeenCalled();
  });
});
