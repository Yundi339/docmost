import { ForbiddenException, NotFoundException } from '@nestjs/common';

jest.mock('./page.service', () => ({ PageService: class PageService {} }));

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
    parentPageId: null,
    deletedAt: null,
  } as any;
  let pageRepo: any;
  let pageService: any;
  let pageAccessService: any;
  let spaceAbility: any;
  let pageOperationPolicy: any;
  let db: any;
  let eventEmitter: any;
  let auditService: any;
  let service: PageLifecycleService;
  let lockDescendants: jest.SpyInstance;

  beforeEach(() => {
    pageRepo = {
      findById: jest.fn().mockResolvedValue(page),
      removePage: jest.fn().mockResolvedValue([page.id]),
      restorePage: jest.fn().mockResolvedValue([page.id]),
    };
    pageService = {
      forceDelete: jest.fn().mockResolvedValue([page.id]),
      finalizeForceDelete: jest.fn().mockResolvedValue(undefined),
    };
    pageAccessService = {
      validateCanEditPages: jest.fn().mockResolvedValue(undefined),
      validateCanViewPages: jest.fn().mockResolvedValue(undefined),
    };
    spaceAbility = {
      createForUser: jest.fn().mockResolvedValue({
        cannot: jest.fn().mockReturnValue(false),
      }),
    };
    pageOperationPolicy = {
      assertOperation: jest.fn().mockResolvedValue(undefined),
    };
    const trx = { id: 'trx' };
    db = {
      transaction: jest.fn().mockReturnValue({
        execute: jest.fn((callback) => callback(trx)),
      }),
    };
    eventEmitter = { emit: jest.fn() };
    auditService = { log: jest.fn() };
    service = new PageLifecycleService(
      pageRepo,
      pageService,
      pageAccessService,
      spaceAbility,
      pageOperationPolicy,
      db,
      eventEmitter,
      auditService,
    );
    lockDescendants = jest
      .spyOn(service as any, 'lockDescendantPages')
      .mockResolvedValue([page]);
  });

  it('trashes the locked authorized subtree through the repository', async () => {
    await expect(service.trashPage(page.id, user, workspace)).resolves.toBe(
      page,
    );

    expect(pageAccessService.validateCanEditPages).toHaveBeenCalledWith(
      [page],
      user,
    );
    expect(pageRepo.removePage).toHaveBeenCalledWith(
      page.id,
      user.id,
      workspace.id,
      { id: 'trx' },
      false,
    );
    expect(eventEmitter.emit).toHaveBeenCalledWith('page.soft_deleted', {
      pageIds: [page.id],
      workspaceId: workspace.id,
    });
  });

  it('fails closed when one trash descendant cannot be edited', async () => {
    const restrictedChild = { ...page, id: 'restricted-child' };
    lockDescendants.mockResolvedValue([page, restrictedChild]);
    pageAccessService.validateCanEditPages.mockRejectedValue(
      new ForbiddenException(),
    );

    await expect(
      service.trashPage(page.id, user, workspace),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(pageRepo.removePage).not.toHaveBeenCalled();
    expect(eventEmitter.emit).not.toHaveBeenCalled();
    expect(auditService.log).not.toHaveBeenCalled();
  });

  it('rejects pages from another workspace before permission or mutation', async () => {
    pageRepo.findById.mockResolvedValue({
      ...page,
      workspaceId: 'other-workspace',
    });

    await expect(
      service.trashPage(page.id, user, workspace),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(lockDescendants).not.toHaveBeenCalled();
    expect(pageRepo.removePage).not.toHaveBeenCalled();
  });

  it('does not re-trash an already deleted page', async () => {
    pageRepo.findById.mockResolvedValue({ ...page, deletedAt: new Date() });

    await expect(
      service.trashPage(page.id, user, workspace),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(pageRepo.removePage).not.toHaveBeenCalled();
  });

  it('restores only after every locked descendant is editable', async () => {
    const deleted = { ...page, deletedAt: new Date() };
    const restored = { ...page, hasChildren: true };
    pageRepo.findById
      .mockResolvedValueOnce(deleted)
      .mockResolvedValueOnce(restored);
    lockDescendants.mockResolvedValue([deleted]);

    await expect(service.restorePage(page.id, user, workspace)).resolves.toBe(
      restored,
    );

    expect(pageAccessService.validateCanEditPages).toHaveBeenCalledWith(
      [deleted],
      user,
    );
    expect(pageOperationPolicy.assertOperation).toHaveBeenCalledWith({
      operation: 'restore',
      page: deleted,
      actorId: user.id,
      trx: { id: 'trx' },
    });
    expect(pageRepo.restorePage).toHaveBeenCalledWith(
      page.id,
      workspace.id,
      { id: 'trx' },
      false,
    );
  });

  it('fails closed when one restore descendant cannot be edited', async () => {
    const deleted = { ...page, deletedAt: new Date() };
    const restrictedChild = {
      ...deleted,
      id: 'restricted-child',
    };
    pageRepo.findById.mockResolvedValue(deleted);
    lockDescendants.mockResolvedValue([deleted, restrictedChild]);
    pageAccessService.validateCanEditPages.mockRejectedValue(
      new ForbiddenException(),
    );

    await expect(
      service.restorePage(page.id, user, workspace),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(pageRepo.restorePage).not.toHaveBeenCalled();
    expect(eventEmitter.emit).not.toHaveBeenCalled();
  });

  it('does not restore an active page', async () => {
    await expect(
      service.restorePage(page.id, user, workspace),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(pageRepo.restorePage).not.toHaveBeenCalled();
  });

  it('does not restore when an extension policy rejects the operation', async () => {
    const deleted = { ...page, deletedAt: new Date() };
    pageRepo.findById.mockResolvedValue(deleted);
    lockDescendants.mockResolvedValue([deleted]);
    pageOperationPolicy.assertOperation.mockRejectedValue(
      new Error('Restore the board first'),
    );

    await expect(service.restorePage(page.id, user, workspace)).rejects.toThrow(
      'Restore the board first',
    );
    expect(pageRepo.restorePage).not.toHaveBeenCalled();
  });

  it('locks a deleted parent before locking the restore subtree', async () => {
    const parent = { ...page, id: 'parent-page' };
    const deleted = {
      ...page,
      parentPageId: parent.id,
      deletedAt: new Date(),
    };
    const restored = { ...deleted, deletedAt: null };
    pageRepo.findById
      .mockResolvedValueOnce(deleted)
      .mockResolvedValueOnce(parent)
      .mockResolvedValueOnce(restored);
    lockDescendants.mockResolvedValue([deleted]);

    await service.restorePage(deleted.id, user, workspace);

    const parentLockOrder = pageRepo.findById.mock.invocationCallOrder[1];
    const subtreeLockOrder = lockDescendants.mock.invocationCallOrder[0];
    expect(parentLockOrder).toBeLessThan(subtreeLockOrder);
    expect(pageRepo.findById).toHaveBeenNthCalledWith(2, parent.id, {
      withLock: true,
      trx: { id: 'trx' },
    });
  });

  it('validates view access for every descendant before permanent deletion', async () => {
    const deleted = { ...page, deletedAt: new Date() };
    const child = { ...deleted, id: 'child-page' };
    pageRepo.findById.mockResolvedValue(deleted);
    lockDescendants.mockResolvedValue([deleted, child]);
    pageService.forceDelete.mockResolvedValue([deleted.id, child.id]);

    await service.permanentlyDeletePage(page.id, user, workspace);

    expect(pageAccessService.validateCanViewPages).toHaveBeenCalledWith(
      [deleted, child],
      user,
    );
    expect(pageService.forceDelete).toHaveBeenCalledWith(
      page.id,
      workspace.id,
      { id: 'trx' },
      false,
    );
    expect(pageService.finalizeForceDelete).toHaveBeenCalledWith(
      [deleted.id, child.id],
      workspace.id,
    );
  });

  it('does not permanently delete when a descendant is not viewable', async () => {
    const deleted = { ...page, deletedAt: new Date() };
    const restrictedChild = { ...deleted, id: 'restricted-child' };
    pageRepo.findById.mockResolvedValue(deleted);
    lockDescendants.mockResolvedValue([deleted, restrictedChild]);
    pageAccessService.validateCanViewPages.mockRejectedValue(
      new ForbiddenException(),
    );

    await expect(
      service.permanentlyDeletePage(page.id, user, workspace),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(pageService.forceDelete).not.toHaveBeenCalled();
  });

  it('does not permanently delete a descendant outside the managed space', async () => {
    const deleted = { ...page, deletedAt: new Date() };
    const unmanagedChild = {
      ...deleted,
      id: 'unmanaged-child',
      spaceId: 'unmanaged-space',
    };
    pageRepo.findById.mockResolvedValue(deleted);
    lockDescendants.mockResolvedValue([deleted, unmanagedChild]);
    spaceAbility.createForUser.mockImplementation(
      async (_user: unknown, spaceId: string) => ({
        cannot: jest.fn().mockReturnValue(spaceId === unmanagedChild.spaceId),
      }),
    );

    await expect(
      service.permanentlyDeletePage(page.id, user, workspace),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(pageService.forceDelete).not.toHaveBeenCalled();
  });

  it('does not finalize permanent deletion when the affected subtree changes', async () => {
    const deleted = { ...page, deletedAt: new Date() };
    const child = { ...deleted, id: 'child-page' };
    pageRepo.findById.mockResolvedValue(deleted);
    lockDescendants.mockResolvedValue([deleted, child]);
    pageService.forceDelete.mockResolvedValue([deleted.id]);

    await expect(
      service.permanentlyDeletePage(page.id, user, workspace),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(pageService.finalizeForceDelete).not.toHaveBeenCalled();
  });

  it('requires space admin permission for permanent deletion', async () => {
    pageRepo.findById.mockResolvedValue({ ...page, deletedAt: new Date() });
    spaceAbility.createForUser.mockResolvedValue({
      cannot: jest.fn().mockReturnValue(true),
    });

    await expect(
      service.permanentlyDeletePage(page.id, user, workspace),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(pageService.forceDelete).not.toHaveBeenCalled();
  });

  it('returns explicit partial results for batch restore without duplicate work', async () => {
    const restore = jest
      .spyOn(service, 'restorePage')
      .mockResolvedValueOnce(page)
      .mockRejectedValueOnce(new ForbiddenException());

    await expect(
      service.restorePages([page.id, page.id, 'other-page'], user, workspace),
    ).resolves.toEqual({
      succeededPageIds: [page.id],
      failedPageIds: ['other-page'],
    });
    expect(restore).toHaveBeenCalledTimes(2);
  });
});
