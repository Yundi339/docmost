import { Injectable } from '@nestjs/common';
import {
  SEARCH_MAX_LIMIT,
  SEARCH_MAX_OFFSET,
  SearchDTO,
  SearchSuggestionDTO,
} from './dto/search.dto';
import { SearchResponseDto } from './dto/search-response.dto';
import { InjectKysely } from 'nestjs-kysely';
import { KyselyDB } from '@docmost/db/types/kysely.types';
import { sql } from 'kysely';
import { PageRepo } from '@docmost/db/repos/page/page.repo';
import { SpaceMemberRepo } from '@docmost/db/repos/space/space-member.repo';
import { ShareRepo } from '@docmost/db/repos/share/share.repo';
import { PagePermissionRepo } from '@docmost/db/repos/page/page-permission.repo';

// eslint-disable-next-line @typescript-eslint/no-require-imports
const tsquery = require('pg-tsquery')();
const SEARCH_CANDIDATE_BATCH_SIZE = 200;
const MAX_SEARCH_CANDIDATES_TO_SCAN = 20_000;

@Injectable()
export class SearchService {
  constructor(
    @InjectKysely() private readonly db: KyselyDB,
    private pageRepo: PageRepo,
    private shareRepo: ShareRepo,
    private spaceMemberRepo: SpaceMemberRepo,
    private pagePermissionRepo: PagePermissionRepo,
  ) {}

  async searchPage(
    searchParams: SearchDTO,
    opts: {
      userId?: string;
      workspaceId: string;
    },
  ): Promise<{ items: SearchResponseDto[] }> {
    const trimmedQuery = searchParams.query?.trim();
    if (!trimmedQuery) {
      return { items: [] };
    }

    const requestedLimit = clampNumber(
      searchParams.limit ?? 25,
      1,
      SEARCH_MAX_LIMIT,
    );
    const requestedOffset = clampNumber(
      searchParams.offset ?? 0,
      0,
      SEARCH_MAX_OFFSET,
    );
    // With *: used only for ts_rank/ts_headline (prefix-aware scoring/highlights)
    const searchQuery = tsquery(trimmedQuery + '*');
    // Without *: used for content FTS filter to avoid stemming-based false positives
    const filterQuery = tsquery(trimmedQuery);

    let sharedPageIdsToSearch: string[] | undefined;
    if (searchParams.shareId && !searchParams.spaceId && !opts.userId) {
      const shareId = searchParams.shareId;
      const share = await this.shareRepo.findById(shareId);
      if (!share || share.workspaceId !== opts.workspaceId) {
        return { items: [] };
      }

      const isRestricted =
        await this.pagePermissionRepo.hasRestrictedAncestor(share.pageId);
      if (isRestricted) {
        return { items: [] };
      }

      sharedPageIdsToSearch = [];
      if (share.includeSubPages) {
        const pageList = await this.pageRepo.getPageAndDescendantsExcludingRestricted(
          share.pageId,
          {
            includeContent: false,
          },
        );

        sharedPageIdsToSearch.push(...pageList.map((page) => page.id));
      } else {
        sharedPageIdsToSearch.push(share.pageId);
      }

      if (sharedPageIdsToSearch.length === 0) {
        return { items: [] };
      }
    }

    const buildQuery = (limit: number, offset: number) => {
      let queryResults = this.db
        .selectFrom('pages')
        .select([
          'id',
          'slugId',
          'title',
          'icon',
          'parentPageId',
          'creatorId',
          'createdAt',
          'updatedAt',
          sql<number>`ts_rank(tsv, to_tsquery('english', f_unaccent(${searchQuery})))`.as(
            'rank',
          ),
          sql<string>`ts_headline('english', text_content, to_tsquery('english', f_unaccent(${searchQuery})),'MinWords=9, MaxWords=10, MaxFragments=3')`.as(
            'highlight',
          ),
        ])
        .where((eb) =>
          eb.or([
            // Title: raw text substring match (accent-insensitive, case-insensitive)
            eb(
              sql`LOWER(f_unaccent(pages.title))`,
              'like',
              sql`LOWER(f_unaccent(${`%${trimmedQuery}%`}))`,
            ),
            // Content: FTS without prefix wildcard to avoid stem-level false positives
            eb(
              'tsv',
              '@@',
              sql<string>`to_tsquery('english', f_unaccent(${filterQuery}))`,
            ),
          ]),
        )
        .$if(Boolean(searchParams.creatorId), (qb) =>
          qb.where('creatorId', '=', searchParams.creatorId),
        )
        .where('deletedAt', 'is', null)
        .orderBy('rank', 'desc')
        .limit(limit)
        .offset(offset);

      if (!searchParams.shareId) {
        queryResults = queryResults.select((eb) => this.pageRepo.withSpace(eb));
      }

      if (searchParams.spaceId) {
        return queryResults.where('spaceId', '=', searchParams.spaceId);
      }

      if (opts.userId) {
        return queryResults
          .where(
            'spaceId',
            'in',
            this.spaceMemberRepo.getUserSpaceIdsQuery(opts.userId),
          )
          .where('workspaceId', '=', opts.workspaceId);
      }

      if (sharedPageIdsToSearch) {
        return queryResults
          .where('id', 'in', sharedPageIdsToSearch)
          .where('workspaceId', '=', opts.workspaceId);
      }

      return undefined;
    };

    const queryResults = buildQuery(requestedLimit, requestedOffset);
    if (!queryResults) return { items: [] };

    const results = opts.userId
      ? await this.collectAccessiblePageResults(
          async (limit, offset) =>
            (await buildQuery(limit, offset)?.execute()) ?? [],
          opts.userId,
          searchParams.spaceId,
          requestedOffset,
          requestedLimit,
        )
      : await queryResults.execute();

    //@ts-ignore
    const searchResults = results.map((result: SearchResponseDto) => {
      if (result.highlight) {
        result.highlight = result.highlight
          .replace(/\r\n|\r|\n/g, ' ')
          .replace(/\s+/g, ' ');
      }
      return result;
    });

    return { items: searchResults };
  }

  private async collectAccessiblePageResults(
    fetchCandidates: (limit: number, offset: number) => Promise<any[]>,
    userId: string,
    spaceId: string | undefined,
    requestedOffset: number,
    requestedLimit: number,
  ) {
    const needed = requestedOffset + requestedLimit;
    const accessibleResults: any[] = [];
    let dbOffset = 0;

    while (
      accessibleResults.length < needed &&
      dbOffset < MAX_SEARCH_CANDIDATES_TO_SCAN
    ) {
      const rows = await fetchCandidates(SEARCH_CANDIDATE_BATCH_SIZE, dbOffset);
      if (rows.length === 0) break;

      const accessibleIds =
        await this.pagePermissionRepo.filterAccessiblePageIds({
          pageIds: [...new Set(rows.map((row) => row.id))],
          userId,
          spaceId,
        });
      const accessibleSet = new Set(accessibleIds);
      accessibleResults.push(
        ...rows.filter((row) => accessibleSet.has(row.id)),
      );

      dbOffset += rows.length;
      if (rows.length < SEARCH_CANDIDATE_BATCH_SIZE) break;
    }

    return accessibleResults.slice(
      requestedOffset,
      requestedOffset + requestedLimit,
    );
  }

  async searchSuggestions(
    suggestion: SearchSuggestionDTO,
    userId: string,
    workspaceId: string,
  ) {
    let users = [];
    let groups = [];
    let pages = [];

    const limit = suggestion?.limit || 10;
    const query = suggestion.query.toLowerCase().trim();

    if (suggestion.includeUsers) {
      const userQuery = this.db
        .selectFrom('users')
        .select(['id', 'name', 'email', 'avatarUrl'])
        .where('workspaceId', '=', workspaceId)
        .where('deletedAt', 'is', null)
        .where((eb) =>
          eb.or([
            eb(
              sql`LOWER(f_unaccent(users.name))`,
              'like',
              sql`LOWER(f_unaccent(${`%${query}%`}))`,
            ),
            eb(sql`users.email`, 'ilike', sql`f_unaccent(${`%${query}%`})`),
          ]),
        )
        .limit(limit);

      users = await userQuery.execute();
    }

    if (suggestion.includeGroups) {
      groups = await this.db
        .selectFrom('groups')
        .select(['id', 'name', 'description'])
        .where((eb) =>
          eb(
            sql`LOWER(f_unaccent(groups.name))`,
            'like',
            sql`LOWER(f_unaccent(${`%${query}%`}))`,
          ),
        )
        .where('workspaceId', '=', workspaceId)
        .limit(limit)
        .execute();
    }

    if (suggestion.includePages) {
      let pageSearch = this.db
        .selectFrom('pages')
        .select(['id', 'slugId', 'title', 'icon', 'spaceId'])
        .select((eb) => this.pageRepo.withSpace(eb))
        .where((eb) =>
          eb(
            sql`LOWER(f_unaccent(pages.title))`,
            'like',
            sql`LOWER(f_unaccent(${`%${query}%`}))`,
          ),
        )
        .where('deletedAt', 'is', null)
        .where('workspaceId', '=', workspaceId)
        .limit(limit);

      // search all spaces the user has access to, prioritizing the current space
      const userSpaceIds = await this.spaceMemberRepo.getUserSpaceIds(userId);

      if (userSpaceIds?.length > 0) {
        pageSearch = pageSearch.where('spaceId', 'in', userSpaceIds);

        if (suggestion?.spaceId) {
          pageSearch = pageSearch.orderBy(
            sql`CASE WHEN pages."space_id" = ${suggestion.spaceId} THEN 0 ELSE 1 END`,
            'asc',
          );
        }

        pages = await pageSearch.execute();
      }

      // Filter by page-level permissions
      if (pages.length > 0) {
        const pageIds = pages.map((p) => p.id);
        const accessibleIds =
          await this.pagePermissionRepo.filterAccessiblePageIds({
            pageIds,
            userId,
          });
        const accessibleSet = new Set(accessibleIds);
        pages = pages.filter((p) => accessibleSet.has(p.id));
      }

      // Attach breadcrumb titles (ancestor titles, root-first, excluding the page itself)
      if (pages.length > 0) {
        const breadcrumbsByPageId = await this.getAncestorTitles(
          pages.map((p) => p.id),
        );
        pages = pages.map((p) => ({
          ...p,
          breadcrumbs: breadcrumbsByPageId.get(p.id) ?? [],
        }));
      }
    }

    return { users, groups, pages };
  }

  /**
   * For each page id, return its ancestor titles ordered root-first,
   * excluding the page itself. Single recursive CTE for the whole batch.
   */
  private async getAncestorTitles(
    pageIds: string[],
  ): Promise<Map<string, string[]>> {
    if (pageIds.length === 0) return new Map();

    const rows = await this.db
      .withRecursive('page_ancestors', (db) =>
        db
          .selectFrom('pages')
          .select([
            'id as startId',
            'id',
            'title',
            'parentPageId',
            sql<number>`0`.as('depth'),
          ])
          .where('id', 'in', pageIds)
          .unionAll((exp) =>
            exp
              .selectFrom('pages as p')
              .innerJoin(
                'page_ancestors as pa',
                'pa.parentPageId',
                'p.id',
              )
              .select([
                'pa.startId as startId',
                'p.id as id',
                'p.title as title',
                'p.parentPageId as parentPageId',
                sql<number>`pa.depth + 1`.as('depth'),
              ]),
          ),
      )
      .selectFrom('page_ancestors')
      .select(['startId', 'title', 'depth'])
      .where('depth', '>', 0) // exclude the page itself
      .orderBy('startId')
      .orderBy('depth', 'desc') // root first
      .execute();

    const result = new Map<string, string[]>();
    for (const row of rows) {
      const key = row.startId as string;
      const list = result.get(key) ?? [];
      list.push(row.title as string);
      result.set(key, list);
    }
    return result;
  }
}

function clampNumber(value: number, min: number, max: number) {
  if (!Number.isFinite(value)) {
    return min;
  }
  return Math.min(Math.max(Math.trunc(value), min), max);
}
