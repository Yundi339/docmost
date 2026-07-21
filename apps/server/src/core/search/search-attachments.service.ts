import { Injectable } from '@nestjs/common';
import { InjectKysely } from 'nestjs-kysely';
import { sql } from 'kysely';
import { KyselyDB } from '@docmost/db/types/kysely.types';
import { PagePermissionRepo } from '@docmost/db/repos/page/page-permission.repo';
import { SpaceMemberRepo } from '@docmost/db/repos/space/space-member.repo';
import {
  SEARCH_MAX_LIMIT,
  SEARCH_MAX_OFFSET,
  SearchDTO,
} from './dto/search.dto';

// eslint-disable-next-line @typescript-eslint/no-require-imports
const tsquery = require('pg-tsquery')();

const SEARCH_CANDIDATE_BATCH_SIZE = 200;
const MAX_SEARCH_CANDIDATES_TO_SCAN = 20_000;

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
    allowedSpaceIds?: string[],
  ) {
    const query = searchDto.query?.trim();
    if (!query) {
      return { items: [] };
    }

    const limit = clampNumber(searchDto.limit ?? 25, 1, SEARCH_MAX_LIMIT);
    const offset = clampNumber(searchDto.offset ?? 0, 0, SEARCH_MAX_OFFSET);
    const searchQuery = tsquery(query + '*');
    const userSpaceIds = this.spaceMemberRepo.getUserSpaceIdsQuery(userId);

    const rows = await this.collectAccessibleAttachmentRows(
      async (batchLimit, batchOffset) => {
        let attachmentQuery = this.db
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
          .orderBy('rank', 'desc');
        if (allowedSpaceIds) {
          attachmentQuery =
            allowedSpaceIds.length === 0
              ? attachmentQuery.where(sql<boolean>`false`)
              : attachmentQuery.where('a.spaceId', 'in', allowedSpaceIds);
        }
        return attachmentQuery.limit(batchLimit).offset(batchOffset).execute();
      },
      userId,
      searchDto.spaceId,
      offset,
      limit,
    );

    const items = rows.slice(offset, offset + limit).map((row: any) => ({
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

  private async collectAccessibleAttachmentRows(
    fetchCandidates: (limit: number, offset: number) => Promise<any[]>,
    userId: string,
    spaceId: string | undefined,
    requestedOffset: number,
    requestedLimit: number,
  ) {
    const needed = requestedOffset + requestedLimit;
    const accessibleRows: any[] = [];
    let dbOffset = 0;

    while (
      accessibleRows.length < needed &&
      dbOffset < MAX_SEARCH_CANDIDATES_TO_SCAN
    ) {
      const rows = await fetchCandidates(SEARCH_CANDIDATE_BATCH_SIZE, dbOffset);
      if (rows.length === 0) break;

      const accessiblePageIds =
        await this.pagePermissionRepo.filterAccessiblePageIds({
          pageIds: [...new Set(rows.map((row) => row.pageId))],
          userId,
          spaceId,
        });
      const accessiblePageIdSet = new Set(accessiblePageIds);
      accessibleRows.push(
        ...rows.filter((row) => accessiblePageIdSet.has(row.pageId)),
      );

      dbOffset += rows.length;
      if (rows.length < SEARCH_CANDIDATE_BATCH_SIZE) break;
    }

    return accessibleRows;
  }
}

function clampNumber(value: number, min: number, max: number) {
  if (!Number.isFinite(value)) {
    return min;
  }
  return Math.min(Math.max(Math.trunc(value), min), max);
}
