import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectKysely } from 'nestjs-kysely';
import { sql } from 'kysely';
import { KyselyDB } from '@docmost/db/types/kysely.types';
import { PageRepo } from '@docmost/db/repos/page/page.repo';
import { SpaceRepo } from '@docmost/db/repos/space/space.repo';
import { User, Workspace } from '@docmost/db/types/entity.types';
import { PageAccessService } from '../page/page-access/page-access.service';
import SpaceAbilityFactory from '../casl/abilities/space-ability.factory';
import {
  SpaceCaslAction,
  SpaceCaslSubject,
} from '../casl/interfaces/space-ability.type';
import { DirectoryVisibilityPolicy } from './directory-visibility.policy';
import {
  DirectoryGroup,
  DirectorySearchInput,
  DirectorySearchPlan,
  DirectoryUser,
} from './directory.types';

@Injectable()
export class DirectoryQueryService {
  private static readonly EMPTY_PAGE_ID =
    '00000000-0000-0000-0000-000000000000';

  constructor(
    @InjectKysely() private readonly db: KyselyDB,
    private readonly pageRepo: PageRepo,
    private readonly spaceRepo: SpaceRepo,
    private readonly pageAccess: PageAccessService,
    private readonly spaceAbility: SpaceAbilityFactory,
    private readonly visibilityPolicy: DirectoryVisibilityPolicy,
  ) {}

  async search(
    input: DirectorySearchInput,
    user: User,
    workspace: Workspace,
  ): Promise<{ users: DirectoryUser[]; groups: DirectoryGroup[] }> {
    const plan = await this.buildPlan(input, user, workspace);
    const [users, groups] = await Promise.all([
      input.includeUsers
        ? this.searchUsers(input, plan, user, workspace.id)
        : Promise.resolve([]),
      input.includeGroups
        ? this.searchGroups(input, plan, workspace.id)
        : Promise.resolve([]),
    ]);

    return { users, groups };
  }

  private async buildPlan(
    input: DirectorySearchInput,
    user: User,
    workspace: Workspace,
  ): Promise<DirectorySearchPlan> {
    let targetPageId: string | undefined;
    let targetSpaceId: string | undefined;

    if (
      input.context === 'mention' ||
      input.context === 'permission-picker' ||
      input.context === 'verification' ||
      input.context === 'database-person'
    ) {
      if (!input.pageId) {
        throw new BadRequestException('pageId is required for this context');
      }

      const page = await this.pageRepo.findById(input.pageId);
      if (
        !page ||
        page.workspaceId !== workspace.id ||
        page.deletedAt !== null
      ) {
        throw new NotFoundException('Page not found');
      }

      if (input.context === 'mention') {
        await this.pageAccess.validateCanView(page, user);
      } else {
        await this.pageAccess.validateCanEdit(page, user);
      }

      targetPageId = page.id;
      targetSpaceId = page.spaceId;
    } else if (input.context === 'space-member') {
      if (!input.spaceId) {
        throw new BadRequestException('spaceId is required for this context');
      }

      const space = await this.spaceRepo.findById(input.spaceId, workspace.id);
      if (!space || space.deletedAt !== null) {
        throw new NotFoundException('Space not found');
      }

      const ability = await this.spaceAbility.createForUser(user, space.id);
      if (ability.cannot(SpaceCaslAction.Manage, SpaceCaslSubject.Member)) {
        throw new ForbiddenException();
      }
      targetSpaceId = space.id;
    }

    return {
      scope: this.visibilityPolicy.resolveScope(
        this.visibilityPolicy.resolveVisibility(workspace.settings),
        user.role,
        input.context,
      ),
      targetPageId,
      targetSpaceId,
    };
  }

  private async searchUsers(
    input: DirectorySearchInput,
    plan: DirectorySearchPlan,
    user: User,
    workspaceId: string,
  ): Promise<DirectoryUser[]> {
    const queryText = input.query.trim();
    if (plan.scope === 'exact' && !queryText) return [];

    let query = this.withPageAccessContext(plan.targetPageId)
      .selectFrom('users')
      .select(['users.id', 'users.name', 'users.avatarUrl'])
      .where('users.workspaceId', '=', workspaceId)
      .where('users.deletedAt', 'is', null)
      .where('users.deactivatedAt', 'is', null)
      .orderBy('users.name', 'asc')
      .orderBy('users.id', 'asc')
      .limit(input.limit);

    if (plan.scope === 'exact') {
      query = query.where(
        sql`LOWER(users.email)`,
        '=',
        queryText.toLowerCase(),
      );
    } else if (queryText) {
      query = query.where(
        sql`LOWER(f_unaccent(users.name))`,
        'like',
        sql`LOWER(f_unaccent(${`%${queryText}%`}))`,
      );
    }

    if (plan.scope === 'self') {
      query = query.where('users.id', '=', user.id);
    } else if (plan.scope === 'target-space' || plan.scope === 'target-page') {
      query = query.where(
        this.userHasSpaceAccess(plan.targetSpaceId as string),
      );
    }

    if (plan.scope === 'target-page') {
      query = query.where(this.userHasPageAccess());
    }

    return query.execute();
  }

  private async searchGroups(
    input: DirectorySearchInput,
    plan: DirectorySearchPlan,
    workspaceId: string,
  ): Promise<DirectoryGroup[]> {
    const queryText = input.query.trim();
    if (plan.scope === 'self' || (plan.scope === 'exact' && !queryText)) {
      return [];
    }

    let query = this.withPageAccessContext(plan.targetPageId)
      .selectFrom('groups')
      .select(['groups.id', 'groups.name'])
      .where('groups.workspaceId', '=', workspaceId)
      .where('groups.deletedAt', 'is', null)
      .orderBy('groups.name', 'asc')
      .orderBy('groups.id', 'asc')
      .limit(input.limit);

    if (plan.scope === 'exact') {
      query = query.where(
        sql`LOWER(f_unaccent(groups.name))`,
        '=',
        sql`LOWER(f_unaccent(${queryText}))`,
      );
    } else if (queryText) {
      query = query.where(
        sql`LOWER(f_unaccent(groups.name))`,
        'like',
        sql`LOWER(f_unaccent(${`%${queryText}%`}))`,
      );
    }

    if (plan.scope === 'target-space' || plan.scope === 'target-page') {
      query = query.where(
        this.groupHasSpaceAccess(plan.targetSpaceId as string),
      );
    }

    if (plan.scope === 'target-page') {
      query = query.where(this.groupHasPageAccess());
    }

    return query.execute();
  }

  private userHasSpaceAccess(spaceId: string) {
    return sql<boolean>`users.id IN (
      SELECT sm.user_id
      FROM space_members sm
      WHERE sm.space_id = ${spaceId}::uuid
        AND sm.deleted_at IS NULL
        AND sm.user_id IS NOT NULL
      UNION
      SELECT gu.user_id
      FROM space_members sm
      JOIN group_users gu ON gu.group_id = sm.group_id
      WHERE sm.space_id = ${spaceId}::uuid
        AND sm.deleted_at IS NULL
        AND sm.group_id IS NOT NULL
    )`;
  }

  private groupHasSpaceAccess(spaceId: string) {
    return sql<boolean>`EXISTS (
      SELECT 1
      FROM space_members sm
      WHERE sm.space_id = ${spaceId}::uuid
        AND sm.deleted_at IS NULL
        AND sm.group_id = groups.id
    )`;
  }

  private withPageAccessContext(pageId?: string) {
    return this.db
      .withRecursive('directoryPageAncestors', (qb) =>
        qb
          .selectFrom('pages')
          .select(['pages.id as ancestorId', 'pages.parentPageId'])
          .where('pages.id', '=', pageId ?? DirectoryQueryService.EMPTY_PAGE_ID)
          .unionAll((eb) =>
            eb
              .selectFrom('pages')
              .innerJoin(
                'directoryPageAncestors',
                'directoryPageAncestors.parentPageId',
                'pages.id',
              )
              .select(['pages.id as ancestorId', 'pages.parentPageId']),
          ),
      )
      .with(
        (cte) => cte('directoryRestrictedAccess').materialized(),
        (qb) =>
          qb
            .selectFrom('directoryPageAncestors')
            .innerJoin(
              'pageAccess',
              'pageAccess.pageId',
              'directoryPageAncestors.ancestorId',
            )
            .select('pageAccess.id'),
      );
  }

  private userHasPageAccess() {
    return sql<boolean>`(
      NOT EXISTS (SELECT 1 FROM directory_restricted_access)
      OR users.id IN (
        SELECT authorized.user_id
        FROM (
          SELECT pp.user_id, pp.page_access_id
          FROM page_permissions pp
          JOIN directory_restricted_access restricted_access
            ON restricted_access.id = pp.page_access_id
          WHERE pp.user_id IS NOT NULL
          UNION
          SELECT gu.user_id, pp.page_access_id
          FROM page_permissions pp
          JOIN directory_restricted_access restricted_access
            ON restricted_access.id = pp.page_access_id
          JOIN group_users gu ON gu.group_id = pp.group_id
          WHERE pp.group_id IS NOT NULL
        ) authorized
        GROUP BY authorized.user_id
        HAVING COUNT(DISTINCT authorized.page_access_id) = (
          SELECT COUNT(*) FROM directory_restricted_access
        )
      )
    )`;
  }

  private groupHasPageAccess() {
    return sql<boolean>`(
      NOT EXISTS (SELECT 1 FROM directory_restricted_access)
      OR groups.id IN (
        SELECT pp.group_id
        FROM page_permissions pp
        JOIN directory_restricted_access restricted_access
          ON restricted_access.id = pp.page_access_id
        WHERE pp.group_id IS NOT NULL
        GROUP BY pp.group_id
        HAVING COUNT(DISTINCT pp.page_access_id) = (
          SELECT COUNT(*) FROM directory_restricted_access
        )
      )
    )`;
  }
}
