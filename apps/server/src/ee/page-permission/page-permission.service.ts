import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectKysely } from 'nestjs-kysely';
import { KyselyDB } from '@docmost/db/types/kysely.types';
import { executeTx } from '@docmost/db/utils';
import { PagePermissionRepo } from '@docmost/db/repos/page/page-permission.repo';
import { PageRepo } from '@docmost/db/repos/page/page.repo';
import { PageAccessService } from '../../core/page/page-access/page-access.service';
import { User } from '@docmost/db/types/entity.types';
import SpaceAbilityFactory from '../../core/casl/abilities/space-ability.factory';
import {
  SpaceCaslAction,
  SpaceCaslSubject,
} from '../../core/casl/interfaces/space-ability.type';

type RoleValue = 'reader' | 'writer';

@Injectable()
export class PagePermissionService {
  constructor(
    @InjectKysely() private readonly db: KyselyDB,
    private readonly pagePermissionRepo: PagePermissionRepo,
    private readonly pageRepo: PageRepo,
    private readonly pageAccessService: PageAccessService,
    private readonly spaceAbility: SpaceAbilityFactory,
  ) {}

  private async getPageOrThrow(pageId: string, workspaceId: string) {
    const page = await this.pageRepo.findById(pageId);
    if (!page || page.workspaceId !== workspaceId) {
      throw new NotFoundException('Page not found');
    }
    return page;
  }

  async getRestrictionInfo(pageId: string, user: User, workspaceId: string) {
    const page = await this.getPageOrThrow(pageId, workspaceId);
    await this.pageAccessService.validateCanView(page, user);

    const access = await this.pagePermissionRepo.getUserPageAccessLevel(
      user.id,
      pageId,
    );

    const [pageAccess, restrictedAncestor, ability] = await Promise.all([
      this.pagePermissionRepo.findPageAccessByPageId(pageId),
      this.pagePermissionRepo.findRestrictedAncestor(pageId),
      this.spaceAbility.createForUser(user, page.spaceId),
    ]);

    let inheritedFrom: { id: string; slugId: string; title: string } | undefined;
    if (access.hasInheritedRestriction && restrictedAncestor) {
      // nearest restricted ancestor (depth > 0 since inherited)
      const ancestorPageId = restrictedAncestor.pageId;
      if (ancestorPageId !== pageId) {
        const ancestorPage = await this.pageRepo.findById(ancestorPageId);
        if (ancestorPage) {
          inheritedFrom = {
            id: ancestorPage.id,
            slugId: ancestorPage.slugId,
            title: ancestorPage.title ?? '',
          };
        }
      }
    }

    const canManageSpace = ability.can(
      SpaceCaslAction.Manage,
      SpaceCaslSubject.Settings,
    );
    const canManage = canManageSpace || access.canEdit;

    return {
      restrictionId: pageAccess?.id,
      hasDirectRestriction: access.hasDirectRestriction,
      hasInheritedRestriction: access.hasInheritedRestriction,
      inheritedFrom,
      userAccess: {
        canView: access.canAccess,
        canEdit: access.canEdit,
        canManage,
      },
    };
  }

  async listPermissions(
    pageId: string,
    user: User,
    workspaceId: string,
    pagination: { limit?: number; cursor?: string; query?: string },
  ) {
    const page = await this.getPageOrThrow(pageId, workspaceId);
    await this.pageAccessService.validateCanView(page, user);

    const pageAccess =
      await this.pagePermissionRepo.findPageAccessByPageId(pageId);
    if (!pageAccess) {
      return {
        items: [],
        meta: { hasNextPage: false, hasPrevPage: false, nextCursor: null, prevCursor: null },
      };
    }

    return this.pagePermissionRepo.getPagePermissionsPaginated(pageAccess.id, {
      limit: pagination.limit ?? 50,
      cursor: pagination.cursor,
      query: pagination.query,
    } as any);
  }

  async restrictPage(pageId: string, user: User, workspaceId: string) {
    const page = await this.getPageOrThrow(pageId, workspaceId);
    await this.pageAccessService.validateCanEdit(page, user);

    await executeTx(this.db, async (trx) => {
      const existing = await this.pagePermissionRepo.findPageAccessByPageId(
        pageId,
        trx,
      );
      if (existing) return;

      const pageAccess = await this.pagePermissionRepo.insertPageAccess(
        {
          pageId,
          workspaceId,
          spaceId: page.spaceId,
          accessLevel: 'restricted',
          creatorId: user.id,
        },
        trx,
      );

      // Auto-grant current user writer so they don't lock themselves out.
      await this.pagePermissionRepo.insertPagePermissions(
        [
          {
            pageAccessId: pageAccess.id,
            userId: user.id,
            role: 'writer',
            addedById: user.id,
          },
        ],
        trx,
      );
    });
  }

  async unrestrictPage(pageId: string, user: User, workspaceId: string) {
    const page = await this.getPageOrThrow(pageId, workspaceId);
    await this.pageAccessService.validateCanEdit(page, user);

    await this.pagePermissionRepo.deletePageAccess(pageId);
  }

  async addPermissions(
    data: {
      pageId: string;
      role: RoleValue;
      userIds?: string[];
      groupIds?: string[];
    },
    user: User,
    workspaceId: string,
  ) {
    const page = await this.getPageOrThrow(data.pageId, workspaceId);
    await this.pageAccessService.validateCanEdit(page, user);

    if (!this.isValidRole(data.role)) {
      throw new BadRequestException('Invalid role');
    }

    const hasUsers = data.userIds?.length;
    const hasGroups = data.groupIds?.length;
    if (!hasUsers && !hasGroups) {
      throw new BadRequestException('No members provided');
    }

    await executeTx(this.db, async (trx) => {
      const pageAccess = await this.pagePermissionRepo.findPageAccessByPageId(
        data.pageId,
        trx,
      );
      if (!pageAccess) {
        throw new BadRequestException('Page is not restricted');
      }

      const rows = [] as any[];

      if (data.userIds?.length) {
        for (const userId of data.userIds) {
          const existing =
            await this.pagePermissionRepo.findPagePermissionByUserId(
              pageAccess.id,
              userId,
              trx,
            );
          if (existing) continue;
          rows.push({
            pageAccessId: pageAccess.id,
            userId,
            role: data.role,
            addedById: user.id,
          });
        }
      }

      if (data.groupIds?.length) {
        for (const groupId of data.groupIds) {
          const existing =
            await this.pagePermissionRepo.findPagePermissionByGroupId(
              pageAccess.id,
              groupId,
              trx,
            );
          if (existing) continue;
          rows.push({
            pageAccessId: pageAccess.id,
            groupId,
            role: data.role,
            addedById: user.id,
          });
        }
      }

      if (rows.length) {
        await this.pagePermissionRepo.insertPagePermissions(rows, trx);
      }
    });
  }

  async removePermissions(
    data: {
      pageId: string;
      userIds?: string[];
      groupIds?: string[];
    },
    user: User,
    workspaceId: string,
  ) {
    const page = await this.getPageOrThrow(data.pageId, workspaceId);
    await this.pageAccessService.validateCanEdit(page, user);

    const pageAccess = await this.pagePermissionRepo.findPageAccessByPageId(
      data.pageId,
    );
    if (!pageAccess) return;

    await executeTx(this.db, async (trx) => {
      if (data.userIds?.length) {
        await this.pagePermissionRepo.deletePagePermissionsByUserIds(
          pageAccess.id,
          data.userIds,
          trx,
        );
      }
      if (data.groupIds?.length) {
        await this.pagePermissionRepo.deletePagePermissionsByGroupIds(
          pageAccess.id,
          data.groupIds,
          trx,
        );
      }
    });
  }

  async updatePermissionRole(
    data: {
      pageId: string;
      role: RoleValue;
      userId?: string;
      groupId?: string;
    },
    user: User,
    workspaceId: string,
  ) {
    const page = await this.getPageOrThrow(data.pageId, workspaceId);
    await this.pageAccessService.validateCanEdit(page, user);

    if (!this.isValidRole(data.role)) {
      throw new BadRequestException('Invalid role');
    }

    if (!data.userId && !data.groupId) {
      throw new BadRequestException('userId or groupId required');
    }

    const pageAccess = await this.pagePermissionRepo.findPageAccessByPageId(
      data.pageId,
    );
    if (!pageAccess) {
      throw new NotFoundException('Page is not restricted');
    }

    await this.pagePermissionRepo.updatePagePermissionRole(
      pageAccess.id,
      data.role,
      { userId: data.userId, groupId: data.groupId },
    );
  }

  private isValidRole(role: string): role is RoleValue {
    return role === 'reader' || role === 'writer';
  }
}
