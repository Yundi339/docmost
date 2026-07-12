import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { PageLifecycleService } from './page-lifecycle.service';

describe('PageLifecycleService', () => {
  const workspace = { id: 'workspace-id' } as any;
  const user = { id: 'user-id' } as any;
  const page = {
    id: 'page-id',
    slugId: 'page-slug',
    title: 'Lifecycle page',
    workspaceId: workspace.id,
    spaceId: 'space-id',
    deletedAt: null,
  } as any;
  let pageRepo: any;
  let pageService: any;
  let pageAccessService: any;
  let spaceAbility: any;
  let auditService: any;
  let service: PageLifecycleService;

  beforeEach(() => {
    pageRepo = {
      findById: jest.fn().mockResolvedValue(page),
      restorePage: jest.fn().mockResolvedValue(undefined),
    };
    pageService = { removePage: jest.fn().mockResolvedValue(undefined) };
    pageAccessService = {
      validateCanEdit: jest.fn().mockResolvedValue(undefined),
    };
    spaceAbility = {
      createForUser: jest.fn().mockResolvedValue({
        cannot: jest.fn().mockReturnValue(false),
      }),
    };
    auditService = { log: jest.fn() };
    service = new PageLifecycleService(
      pageRepo,
      pageService,
      pageAccessService,
      spaceAbility,
      auditService,
    );
  });

  it('trashes through the existing page service after page permission checks', async () => {
    await expect(service.trashPage(page.id, user, workspace)).resolves.toBe(
      page,
    );

    expect(pageAccessService.validateCanEdit).toHaveBeenCalledWith(page, user);
    expect(pageService.removePage).toHaveBeenCalledWith(
      page.id,
      user.id,
      workspace.id,
    );
    expect(auditService.log).toHaveBeenCalledWith(
      expect.objectContaining({ event: 'page.trashed', resourceId: page.id }),
    );
  });

  it('rejects pages from another workspace before permission or mutation', async () => {
    pageRepo.findById.mockResolvedValue({
      ...page,
      workspaceId: 'other-workspace',
    });

    await expect(
      service.trashPage(page.id, user, workspace),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(pageAccessService.validateCanEdit).not.toHaveBeenCalled();
    expect(pageService.removePage).not.toHaveBeenCalled();
  });

  it('does not re-trash an already deleted page', async () => {
    pageRepo.findById.mockResolvedValue({ ...page, deletedAt: new Date() });

    await expect(
      service.trashPage(page.id, user, workspace),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(pageService.removePage).not.toHaveBeenCalled();
  });

  it('restores through the existing repository after space and page checks', async () => {
    const deleted = { ...page, deletedAt: new Date() };
    const restored = { ...page, hasChildren: true };
    pageRepo.findById
      .mockResolvedValueOnce(deleted)
      .mockResolvedValueOnce(restored);

    await expect(service.restorePage(page.id, user, workspace)).resolves.toBe(
      restored,
    );

    expect(spaceAbility.createForUser).toHaveBeenCalledWith(user, page.spaceId);
    expect(pageAccessService.validateCanEdit).toHaveBeenCalledWith(
      deleted,
      user,
    );
    expect(pageRepo.restorePage).toHaveBeenCalledWith(page.id, workspace.id);
    expect(auditService.log).toHaveBeenCalledWith(
      expect.objectContaining({ event: 'page.restored', resourceId: page.id }),
    );
  });

  it('requires space edit permission to restore', async () => {
    pageRepo.findById.mockResolvedValue({ ...page, deletedAt: new Date() });
    spaceAbility.createForUser.mockResolvedValue({
      cannot: jest.fn().mockReturnValue(true),
    });

    await expect(
      service.restorePage(page.id, user, workspace),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(pageAccessService.validateCanEdit).not.toHaveBeenCalled();
    expect(pageRepo.restorePage).not.toHaveBeenCalled();
  });

  it('does not restore an active page', async () => {
    await expect(
      service.restorePage(page.id, user, workspace),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(pageRepo.restorePage).not.toHaveBeenCalled();
  });
});
