import { Injectable } from '@nestjs/common';
import { InjectKysely } from 'nestjs-kysely';
import { sql } from 'kysely';
import { KyselyDB } from '@docmost/db/types/kysely.types';
import { PagePermissionRepo } from '@docmost/db/repos/page/page-permission.repo';
import { SpaceMemberRepo } from '@docmost/db/repos/space/space-member.repo';
import { SearchDTO } from './dto/search.dto';

// eslint-disable-next-line @typescript-eslint/no-require-imports
const tsquery = require('pg-tsquery')();

const MAX_SEARCH_LIMIT = 200;

@Injectable()
export class SearchAttachmentsService {
  constructor(
    private readonly spaceMemberRepo: SpaceMemberRepo,
    private readonly pagePermissionRepo: PagePermissionRepo,
    @InjectKysely() private readonly db: KyselyDB,
  ) {}

  async searchAttachments(
    searchDto: SearchDTO,
    userId: string,
    workspaceId: string,
  ) {
    const query = searchDto.query?.trim();
    if (!query) {
      return { items: [] };
    }

    const limit = clampNumber(searchDto.limit ?? 25, 1, MAX_SEARCH_LIMIT);
    const offset = clampNumber(searchDto.offset ?? 0, 0, MAX_SEARCH_LIMIT);
    const searchQuery = tsquery(query + '*');
    const userSpaceIds = this.spaceMemberRepo.getUserSpaceIdsQuery(userId);

    const rows = await this.db
      .selectFrom('attachments as a')
      .innerJoin('pages as p', 'p.id', 'a.pageId')
      .innerJoin('spaces as s', 's.id', 'a.spaceId')
      .select([
        'a.id',
        'a.fileName',
        'a.pageId',
        'a.creatorId',
        'a.createdAt',
        'a.updatedAt',
        sql<number>`ts_rank(a.tsv, to_tsquery('english', f_unaccent(${searchQuery})))`.as(
          'rank',
        ),
        sql<string>`ts_headline('english', a.text_content, to_tsquery('english', f_unaccent(${searchQuery})), 'MinWords=9, MaxWords=10, MaxFragments=3')`.as(
          'highlight',
        ),
        's.id as spaceId',
        's.name as spaceName',
        's.slug as spaceSlug',
        sql<string>`s.icon`.as('spaceIcon'),
        'p.id as pageIdRef',
        'p.title as pageTitle',
        'p.slugId as pageSlugId',
      ])
      .where(
        'a.tsv',
        '@@',
        sql<string>`to_tsquery('english', f_unaccent(${searchQuery}))`,
      )
      .where('a.workspaceId', '=', workspaceId)
      .where('a.spaceId', 'in', userSpaceIds)
      .where('a.deletedAt', 'is', null)
      .where('p.deletedAt', 'is', null)
      .$if(Boolean(searchDto.spaceId), (qb) =>
        qb.where('a.spaceId', '=', searchDto.spaceId),
      )
      .orderBy('rank', 'desc')
      .limit(MAX_SEARCH_LIMIT)
      .execute();

    const accessiblePageIds =
      await this.pagePermissionRepo.filterAccessiblePageIds({
        pageIds: [...new Set(rows.map((row) => row.pageId))],
        userId,
        spaceId: searchDto.spaceId,
      });
    const accessiblePageIdSet = new Set(accessiblePageIds);

    const items = rows
      .filter((row) => accessiblePageIdSet.has(row.pageId))
      .slice(offset, offset + limit)
      .map((row: any) => ({
        id: row.id,
        fileName: row.fileName,
        pageId: row.pageId,
        creatorId: row.creatorId,
        createdAt: row.createdAt,
        updatedAt: row.updatedAt,
        rank: row.rank,
        highlight: row.highlight,
        space: {
          id: row.spaceId,
          name: row.spaceName,
          slug: row.spaceSlug,
          icon: row.spaceIcon,
        },
        page: {
          id: row.pageIdRef,
          title: row.pageTitle,
          slugId: row.pageSlugId,
        },
      }));

    return { items };
  }
}

function clampNumber(value: number, min: number, max: number) {
  if (!Number.isFinite(value)) {
    return min;
  }
  return Math.min(Math.max(Math.trunc(value), min), max);
}
