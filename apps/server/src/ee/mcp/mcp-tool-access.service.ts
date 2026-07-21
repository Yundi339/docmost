import {
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectKysely } from 'nestjs-kysely';
import { KyselyDB } from '@docmost/db/types/kysely.types';
import { PageRepo } from '@docmost/db/repos/page/page.repo';
import type { Page, User } from '@docmost/db/types/entity.types';
import { PaginationOptions } from '../../database/pagination/pagination-options';
import SpaceAbilityFactory from '../../core/casl/abilities/space-ability.factory';
import {
  SpaceCaslAction,
  SpaceCaslSubject,
} from '../../core/casl/interfaces/space-ability.type';
import { PageAccessService } from '../../core/page/page-access/page-access.service';
import type { McpRequestContext, McpToolResourcePolicy } from './mcp.types';

const MAX_LIMIT = 200;

@Injectable()
export class McpToolAccessService {
  constructor(
    private readonly pageRepo: PageRepo,
    private readonly spaceAbility: SpaceAbilityFactory,
    private readonly pageAccessService: PageAccessService,
    @InjectKysely() private readonly db: KyselyDB,
  ) {}

  async assertCredentialResourceAccess(
    context: McpRequestContext,
    workspaceId: string,
    policy: McpToolResourcePolicy,
    args: Record<string, any>,
  ) {
    if (policy.kind === 'identity') {
      return;
    }
    if (policy.kind === 'scoped_collection') {
      const allowed = new Set(context.spaceAccess.effectiveSpaceIds);
      const directSpaceIds = getArgumentValues(args, policy.spaceIds);
      if (directSpaceIds.some((spaceId) => !allowed.has(spaceId))) {
        throw new NotFoundException('Resource not found');
      }
      return;
    }
    if (policy.kind === 'all_spaces_only') {
      if (context.spaceAccess.mode !== 'all') {
        throw new ForbiddenException(
          'This MCP tool is unavailable for selected-space credentials',
        );
      }
      return;
    }

    const allowed = new Set(context.spaceAccess.effectiveSpaceIds);
    const directSpaceIds = getArgumentValues(args, policy.spaceIds);
    if (directSpaceIds.some((spaceId) => !allowed.has(spaceId))) {
      throw new NotFoundException('Resource not found');
    }

    const pageIds = getArgumentValues(args, policy.pageIds);
    if (pageIds.length > 0) {
      const pages = await this.db
        .selectFrom('pages')
        .select(['id', 'spaceId'])
        .where('workspaceId', '=', workspaceId)
        .where('id', 'in', pageIds)
        .execute();
      const spacesByPage = new Map(
        pages.map((page) => [page.id, page.spaceId]),
      );
      if (
        pageIds.some((pageId) => {
          const spaceId = spacesByPage.get(pageId);
          return !spaceId || !allowed.has(spaceId);
        })
      ) {
        throw new NotFoundException('Resource not found');
      }
    }

    const commentIds = getArgumentValues(args, policy.commentIds);
    if (commentIds.length > 0) {
      const comments = await this.db
        .selectFrom('comments')
        .innerJoin('pages', 'pages.id', 'comments.pageId')
        .select(['comments.id', 'pages.spaceId'])
        .where('comments.workspaceId', '=', workspaceId)
        .where('comments.id', 'in', commentIds)
        .execute();
      const spacesByComment = new Map(
        comments.map((comment) => [comment.id, comment.spaceId]),
      );
      if (
        commentIds.some((commentId) => {
          const spaceId = spacesByComment.get(commentId);
          return !spaceId || !allowed.has(spaceId);
        })
      ) {
        throw new NotFoundException('Resource not found');
      }
    }
  }

  paginate(limit?: number): PaginationOptions {
    const options = new PaginationOptions();
    options.limit = Math.min(Math.max(1, limit ?? 50), MAX_LIMIT);
    options.query = '';
    options.adminView = false;
    return options;
  }

  async findActiveWorkspacePage(
    pageId: string,
    workspaceId: string,
    options?: Parameters<PageRepo['findById']>[1],
    context?: McpRequestContext,
  ): Promise<Page | null> {
    const page = await this.pageRepo.findById(pageId, options);
    if (!page || page.workspaceId !== workspaceId || page.deletedAt) {
      return null;
    }
    this.assertPageInCredentialContext(page, context);
    return page;
  }

  async assertSpacePageAccess(
    user: User,
    spaceId: string,
    action: SpaceCaslAction = SpaceCaslAction.Read,
    context?: McpRequestContext,
  ): Promise<void> {
    this.assertSpaceInCredentialContext(spaceId, context);
    const ability = await this.spaceAbility.createForUser(user, spaceId);
    if (ability.cannot(action, SpaceCaslSubject.Page)) {
      throw new ForbiddenException('Forbidden: insufficient space permissions');
    }
  }

  async getSpacePageEditAccess(
    user: User,
    spaceId: string,
    context?: McpRequestContext,
  ): Promise<boolean> {
    this.assertSpaceInCredentialContext(spaceId, context);
    const ability = await this.spaceAbility.createForUser(user, spaceId);
    if (ability.cannot(SpaceCaslAction.Read, SpaceCaslSubject.Page)) {
      throw new ForbiddenException('Forbidden: insufficient space permissions');
    }
    return ability.can(SpaceCaslAction.Edit, SpaceCaslSubject.Page);
  }

  async assertSpaceSettingsManage(
    user: User,
    spaceId: string,
    context?: McpRequestContext,
  ): Promise<void> {
    this.assertSpaceInCredentialContext(spaceId, context);
    const ability = await this.spaceAbility.createForUser(user, spaceId);
    if (ability.cannot(SpaceCaslAction.Manage, SpaceCaslSubject.Settings)) {
      throw new ForbiddenException(
        'Forbidden: space settings management required',
      );
    }
  }

  async assertSpaceSettingsRead(
    user: User,
    spaceId: string,
    context?: McpRequestContext,
  ): Promise<void> {
    this.assertSpaceInCredentialContext(spaceId, context);
    const ability = await this.spaceAbility.createForUser(user, spaceId);
    if (ability.cannot(SpaceCaslAction.Read, SpaceCaslSubject.Settings)) {
      throw new ForbiddenException('Forbidden: space settings read required');
    }
  }

  validateCanView(
    page: Page,
    user: User,
    context?: McpRequestContext,
  ): Promise<void> {
    this.assertPageInCredentialContext(page, context);
    return this.pageAccessService.validateCanView(page, user);
  }

  async validateCanEdit(
    page: Page,
    user: User,
    context?: McpRequestContext,
  ): Promise<void> {
    this.assertPageInCredentialContext(page, context);
    await this.pageAccessService.validateCanEdit(page, user);
  }

  async validateCanComment(
    page: Page,
    user: User,
    workspaceId: string,
    context?: McpRequestContext,
  ): Promise<void> {
    this.assertPageInCredentialContext(page, context);
    await this.pageAccessService.validateCanComment(page, user, workspaceId);
  }

  private assertPageInCredentialContext(
    page: Pick<Page, 'spaceId'>,
    context?: McpRequestContext,
  ) {
    this.assertSpaceInCredentialContext(page.spaceId, context);
  }

  private assertSpaceInCredentialContext(
    spaceId: string,
    context?: McpRequestContext,
  ) {
    if (context && !context.spaceAccess.effectiveSpaceIds.includes(spaceId)) {
      throw new NotFoundException('Resource not found');
    }
  }
}

function getArgumentValues(
  args: Record<string, any>,
  names: string[] | undefined,
) {
  return [
    ...new Set(
      (names ?? [])
        .map((name) => args[name])
        .filter((value): value is string => typeof value === 'string'),
    ),
  ];
}
