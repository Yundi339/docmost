import { NotFoundException } from '@nestjs/common';
import { PagePermissionService } from './page-permission.service';

describe('PagePermissionService subject authorization', () => {
  const workspaceId = 'workspace_1';
  const actor = { id: 'actor_1' } as any;
  const page = {
    id: 'page_1',
    workspaceId,
    spaceId: 'space_1',
  } as any;

  function queryRows(rows: Array<{ id: string }>) {
    const query: any = {
      select: jest.fn(() => query),
      where: jest.fn(() => query),
      execute: jest.fn().mockResolvedValue(rows),
    };
    return query;
  }

  function createService(options?: {
    validUsers?: string[];
    validGroups?: string[];
  }) {
    const trx = {
      selectFrom: jest.fn((table: string) =>
        queryRows(
          (table === 'users'
            ? (options?.validUsers ?? [])
            : (options?.validGroups ?? [])
          ).map((id) => ({ id })),
        ),
      ),
    };
    const db = {
      transaction: jest.fn().mockReturnValue({
        execute: jest.fn((callback) => callback(trx)),
      }),
    };
    const pagePermissionRepo = {
      findPageAccessByPageId: jest
        .fn()
        .mockResolvedValue({ id: 'page_access_1' }),
      findPagePermissionByUserId: jest.fn().mockResolvedValue(undefined),
      findPagePermissionByGroupId: jest.fn().mockResolvedValue(undefined),
      insertPagePermissions: jest.fn(),
      deletePagePermissionsByUserIds: jest.fn(),
      deletePagePermissionsByGroupIds: jest.fn(),
      updatePagePermissionRole: jest.fn(),
    };
    const pageRepo = { findById: jest.fn().mockResolvedValue(page) };
    const pageAccessService = {
      validateCanEdit: jest.fn().mockResolvedValue(undefined),
    };
    const spaceAbility = {};
    const securityEvents = { publish: jest.fn().mockResolvedValue(undefined) };
    const service = new PagePermissionService(
      db as never,
      pagePermissionRepo as never,
      pageRepo as never,
      pageAccessService as never,
      spaceAbility as never,
      securityEvents as never,
    );
    return { pagePermissionRepo, securityEvents, service };
  }

  it('rejects cross-workspace or inactive users before adding permissions', async () => {
    const { pagePermissionRepo, service } = createService();

    await expect(
      service.addPermissions(
        { pageId: page.id, role: 'reader', userIds: ['invalid_user'] },
        actor,
        workspaceId,
      ),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(pagePermissionRepo.findPageAccessByPageId).not.toHaveBeenCalled();
    expect(pagePermissionRepo.insertPagePermissions).not.toHaveBeenCalled();
  });

  it('rejects cross-workspace groups before removing permissions', async () => {
    const { pagePermissionRepo, service } = createService();

    await expect(
      service.removePermissions(
        { pageId: page.id, groupIds: ['invalid_group'] },
        actor,
        workspaceId,
      ),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(
      pagePermissionRepo.deletePagePermissionsByGroupIds,
    ).not.toHaveBeenCalled();
  });

  it('rejects invalid subjects before updating a role', async () => {
    const { pagePermissionRepo, service } = createService();

    await expect(
      service.updatePermissionRole(
        { pageId: page.id, role: 'writer', userId: 'inactive_user' },
        actor,
        workspaceId,
      ),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(pagePermissionRepo.updatePagePermissionRole).not.toHaveBeenCalled();
  });

  it('deduplicates valid subjects and writes only workspace-owned ids', async () => {
    const { pagePermissionRepo, securityEvents, service } = createService({
      validUsers: ['valid_user'],
      validGroups: ['valid_group'],
    });

    await service.addPermissions(
      {
        pageId: page.id,
        role: 'writer',
        userIds: ['valid_user', 'valid_user'],
        groupIds: ['valid_group', 'valid_group'],
      },
      actor,
      workspaceId,
    );

    expect(pagePermissionRepo.insertPagePermissions).toHaveBeenCalledWith(
      [
        expect.objectContaining({ userId: 'valid_user' }),
        expect.objectContaining({ groupId: 'valid_group' }),
      ],
      expect.anything(),
    );
    expect(securityEvents.publish).toHaveBeenCalledWith({
      type: 'page.permission-changed',
      pageId: page.id,
      spaceId: page.spaceId,
    });
  });

  it('does not publish permission changes when the transaction fails', async () => {
    const { pagePermissionRepo, securityEvents, service } = createService({
      validUsers: ['valid_user'],
    });
    pagePermissionRepo.insertPagePermissions.mockRejectedValue(
      new Error('write failed'),
    );

    await expect(
      service.addPermissions(
        { pageId: page.id, role: 'reader', userIds: ['valid_user'] },
        actor,
        workspaceId,
      ),
    ).rejects.toThrow('write failed');

    expect(securityEvents.publish).not.toHaveBeenCalled();
  });
});
