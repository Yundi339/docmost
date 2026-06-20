import { ForbiddenException } from '@nestjs/common';
import { PageAccessService } from './page-access.service';
import {
  SpaceCaslAction,
  SpaceCaslSubject,
} from '../../casl/interfaces/space-ability.type';

describe('PageAccessService', () => {
  let pagePermissionRepo: { canUserEditPage: jest.Mock };
  let spaceAbility: { createForUser: jest.Mock };
  let service: PageAccessService;

  const user = { id: 'user-id' } as any;
  const page = { id: 'page-id', spaceId: 'space-id' } as any;

  beforeEach(() => {
    pagePermissionRepo = {
      canUserEditPage: jest.fn(),
    };
    spaceAbility = {
      createForUser: jest.fn(),
    };
    service = new PageAccessService(
      pagePermissionRepo as any,
      spaceAbility as any,
      {} as any,
    );
  });

  function spacePerms({ canRead = true, canEdit = false } = {}) {
    const can = jest.fn((action: SpaceCaslAction, subject: SpaceCaslSubject) => {
      if (subject !== SpaceCaslSubject.Page) return false;
      if (action === SpaceCaslAction.Read) return canRead;
      if (action === SpaceCaslAction.Edit) return canEdit;
      return false;
    });

    return {
      can,
      cannot: jest.fn(
        (action: SpaceCaslAction, subject: SpaceCaslSubject) =>
          !can(action, subject),
      ),
    };
  }

  function pagePerms({
    hasAnyRestriction = false,
    canAccess = true,
    canEdit = true,
  } = {}) {
    pagePermissionRepo.canUserEditPage.mockResolvedValue({
      hasAnyRestriction,
      canAccess,
      canEdit,
    });
  }

  it('blocks edit for a space reader on an open page', async () => {
    spaceAbility.createForUser.mockResolvedValue(
      spacePerms({ canRead: true, canEdit: false }),
    );

    await expect(service.validateCanEdit(page, user)).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    expect(pagePermissionRepo.canUserEditPage).not.toHaveBeenCalled();
  });

  it('blocks edit for a space reader even when restricted page allows edit', async () => {
    spaceAbility.createForUser.mockResolvedValue(
      spacePerms({ canRead: true, canEdit: false }),
    );
    pagePerms({ hasAnyRestriction: true, canAccess: true, canEdit: true });

    await expect(service.validateCanEdit(page, user)).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    expect(pagePermissionRepo.canUserEditPage).not.toHaveBeenCalled();
  });

  it('allows edit for a space writer on an open page', async () => {
    spaceAbility.createForUser.mockResolvedValue(
      spacePerms({ canRead: true, canEdit: true }),
    );
    pagePerms({ hasAnyRestriction: false });

    await expect(service.validateCanEdit(page, user)).resolves.toEqual({
      hasRestriction: false,
    });
  });

  it('blocks edit for a space writer when restricted page only allows view', async () => {
    spaceAbility.createForUser.mockResolvedValue(
      spacePerms({ canRead: true, canEdit: true }),
    );
    pagePerms({ hasAnyRestriction: true, canAccess: true, canEdit: false });

    await expect(service.validateCanEdit(page, user)).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });

  it('allows edit for a space writer when restricted page allows edit', async () => {
    spaceAbility.createForUser.mockResolvedValue(
      spacePerms({ canRead: true, canEdit: true }),
    );
    pagePerms({ hasAnyRestriction: true, canAccess: true, canEdit: true });

    await expect(service.validateCanEdit(page, user)).resolves.toEqual({
      hasRestriction: true,
    });
  });

  it('reports canEdit false for a space reader even when restricted page allows edit', async () => {
    spaceAbility.createForUser.mockResolvedValue(
      spacePerms({ canRead: true, canEdit: false }),
    );
    pagePerms({ hasAnyRestriction: true, canAccess: true, canEdit: true });

    await expect(
      service.validateCanViewWithPermissions(page, user),
    ).resolves.toEqual({
      canEdit: false,
      hasRestriction: true,
    });
  });

  it('reports canEdit false for a space writer when restricted page only allows view', async () => {
    spaceAbility.createForUser.mockResolvedValue(
      spacePerms({ canRead: true, canEdit: true }),
    );
    pagePerms({ hasAnyRestriction: true, canAccess: true, canEdit: false });

    await expect(
      service.validateCanViewWithPermissions(page, user),
    ).resolves.toEqual({
      canEdit: false,
      hasRestriction: true,
    });
  });

  it('reports canEdit true for a space writer when restricted page allows edit', async () => {
    spaceAbility.createForUser.mockResolvedValue(
      spacePerms({ canRead: true, canEdit: true }),
    );
    pagePerms({ hasAnyRestriction: true, canAccess: true, canEdit: true });

    await expect(
      service.validateCanViewWithPermissions(page, user),
    ).resolves.toEqual({
      canEdit: true,
      hasRestriction: true,
    });
  });

  it('reports canEdit true for a space writer on an open page', async () => {
    spaceAbility.createForUser.mockResolvedValue(
      spacePerms({ canRead: true, canEdit: true }),
    );
    pagePerms({ hasAnyRestriction: false });

    await expect(
      service.validateCanViewWithPermissions(page, user),
    ).resolves.toEqual({
      canEdit: true,
      hasRestriction: false,
    });
  });
});
