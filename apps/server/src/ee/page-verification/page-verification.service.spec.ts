import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { PageVerificationService } from './page-verification.service';

describe('PageVerificationService authorization', () => {
  const user = { id: 'user_1' } as any;
  const workspaceId = 'workspace_1';
  const page = {
    id: 'page_1',
    workspaceId,
    spaceId: 'space_1',
    deletedAt: null,
  } as any;

  function queryResult(options?: { one?: unknown; many?: unknown[] }) {
    const query: any = {
      select: jest.fn(() => query),
      selectAll: jest.fn(() => query),
      innerJoin: jest.fn(() => query),
      where: jest.fn(() => query),
      orderBy: jest.fn(() => query),
      limit: jest.fn(() => query),
      set: jest.fn(() => query),
      values: jest.fn(() => query),
      returningAll: jest.fn(() => query),
      executeTakeFirst: jest.fn().mockResolvedValue(options?.one),
      execute: jest.fn().mockResolvedValue(options?.many ?? []),
    };
    return query;
  }

  function createService() {
    const pageRepo = {
      findById: jest.fn().mockResolvedValue(page),
      findByIds: jest.fn(),
    };
    const spaceMemberRepo = {
      getUserSpaceIds: jest.fn().mockResolvedValue([page.spaceId]),
    };
    const pageAccessService = {
      validateCanView: jest.fn().mockResolvedValue(undefined),
      validateCanEdit: jest.fn().mockResolvedValue(undefined),
      validateCanViewWithPermissions: jest
        .fn()
        .mockResolvedValue({ canEdit: true }),
      filterViewablePagesWithPermissions: jest.fn(),
    };
    const pagePermissionRepo = {
      userCanAccessPagePredicate: jest.fn().mockReturnValue({}),
    };
    const db: any = {
      selectFrom: jest.fn(),
      updateTable: jest.fn(),
      transaction: jest.fn(),
    };
    const service = new PageVerificationService(
      db,
      pageRepo as never,
      spaceMemberRepo as never,
      pageAccessService as never,
      pagePermissionRepo as never,
    );
    return {
      db,
      pageAccessService,
      pagePermissionRepo,
      pageRepo,
      service,
      spaceMemberRepo,
    };
  }

  it('checks page view before returning verification info', async () => {
    const { db, pageAccessService, service } = createService();
    pageAccessService.validateCanViewWithPermissions.mockRejectedValue(
      new ForbiddenException(),
    );

    await expect(
      service.getVerificationInfo(page.id, workspaceId, user),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(db.selectFrom).not.toHaveBeenCalled();
  });

  it.each([
    [
      'setup',
      (service: PageVerificationService) =>
        service.setupVerification(
          { pageId: page.id, verifierIds: [] },
          workspaceId,
          user,
        ),
    ],
    [
      'update',
      (service: PageVerificationService) =>
        service.updateVerification({ pageId: page.id }, workspaceId, user),
    ],
    [
      'delete',
      (service: PageVerificationService) =>
        service.removeVerification(page.id, workspaceId, user),
    ],
    [
      'submit',
      (service: PageVerificationService) =>
        service.submitForApproval(page.id, workspaceId, user),
    ],
  ])('requires page edit before %s', async (_name, operation) => {
    const { db, pageAccessService, service } = createService();
    pageAccessService.validateCanEdit.mockRejectedValue(
      new ForbiddenException(),
    );

    await expect(operation(service)).rejects.toBeInstanceOf(ForbiddenException);
    expect(db.transaction).not.toHaveBeenCalled();
    expect(db.updateTable).not.toHaveBeenCalled();
  });

  it('requires verifier actions to retain page view access', async () => {
    const { db, pageAccessService, service } = createService();
    pageAccessService.validateCanView.mockRejectedValue(
      new ForbiddenException(),
    );

    await expect(
      service.verifyPage(page.id, workspaceId, user),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(db.selectFrom).not.toHaveBeenCalled();
    expect(db.updateTable).not.toHaveBeenCalled();
  });

  it('rejects a viewer who is not a configured active verifier', async () => {
    const { db, service } = createService();
    const verification = { id: 'verification_1', pageId: page.id };
    db.selectFrom.mockImplementation((table: string) =>
      table === 'pageVerifications'
        ? queryResult({ one: verification })
        : queryResult({ one: undefined }),
    );

    await expect(
      service.markObsolete(page.id, workspaceId, user),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(db.updateTable).not.toHaveBeenCalled();
  });

  it('rejects cross-workspace or inactive verifier ids before setup writes', async () => {
    const { db, service } = createService();
    const trx: any = {
      selectFrom: jest.fn((table: string) =>
        table === 'pageVerifications'
          ? queryResult({ one: undefined })
          : queryResult({ many: [] }),
      ),
      insertInto: jest.fn(),
    };
    db.transaction.mockReturnValue({
      execute: jest.fn((callback) => callback(trx)),
    });

    await expect(
      service.setupVerification(
        { pageId: page.id, verifierIds: ['other_workspace_user'] },
        workspaceId,
        user,
      ),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(trx.insertInto).not.toHaveBeenCalled();
  });

  it('applies page access inside the verification list query', async () => {
    const { db, pageAccessService, pagePermissionRepo, pageRepo, service } =
      createService();
    const candidates = [
      {
        id: 'verification_1',
        pageId: page.id,
        createdAt: new Date('2026-01-02'),
      },
    ];
    db.selectFrom.mockImplementation((table: string) =>
      table === 'pageVerifications'
        ? queryResult({ many: candidates })
        : queryResult({ many: [] }),
    );
    await expect(
      service.getVerificationList(workspaceId, user, { limit: 10 }),
    ).resolves.toMatchObject({
      items: [{ id: 'verification_1', pageId: page.id }],
      meta: { hasMore: false },
    });
    expect(pagePermissionRepo.userCanAccessPagePredicate).toHaveBeenCalledTimes(
      1,
    );
    expect(pageRepo.findByIds).not.toHaveBeenCalled();
    expect(
      pageAccessService.filterViewablePagesWithPermissions,
    ).not.toHaveBeenCalled();
  });

  it('paginates accessible verification rows with one candidate query', async () => {
    const { db, service } = createService();
    const candidateQuery = queryResult({
      many: [
        {
          id: 'visible_verification_1',
          pageId: 'visible_page_1',
          createdAt: new Date('2026-01-02'),
        },
        {
          id: 'visible_verification_2',
          pageId: 'visible_page_2',
          createdAt: new Date('2026-01-01'),
        },
      ],
    });
    db.selectFrom.mockImplementation((table: string) =>
      table === 'pageVerifications'
        ? candidateQuery
        : queryResult({ many: [] }),
    );

    const result = await service.getVerificationList(workspaceId, user, {
      limit: 1,
    });

    expect(result.items).toEqual([
      expect.objectContaining({
        id: 'visible_verification_1',
        pageId: 'visible_page_1',
      }),
    ]);
    expect(result.meta).toEqual({
      hasMore: true,
      cursor: expect.any(String),
    });
    expect(candidateQuery.execute).toHaveBeenCalledTimes(1);
  });
});
