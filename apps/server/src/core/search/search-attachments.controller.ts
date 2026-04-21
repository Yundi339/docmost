import {
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Post,
  UseGuards,
} from '@nestjs/common';
import { SearchDTO } from './dto/search.dto';
import { AuthWorkspace } from '../../common/decorators/auth-workspace.decorator';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { User, Workspace } from '@docmost/db/types/entity.types';
import { AuthUser } from '../../common/decorators/auth-user.decorator';
import { SpaceMemberRepo } from '@docmost/db/repos/space/space-member.repo';
import { InjectKysely } from 'nestjs-kysely';
import { KyselyDB } from '@docmost/db/types/kysely.types';
import { sql } from 'kysely';

// eslint-disable-next-line @typescript-eslint/no-require-imports
const tsquery = require('pg-tsquery')();

@UseGuards(JwtAuthGuard)
@Controller('search-attachments')
export class SearchAttachmentsController {
  constructor(
    private readonly spaceMemberRepo: SpaceMemberRepo,
    @InjectKysely() private readonly db: KyselyDB,
  ) {}

  @HttpCode(HttpStatus.OK)
  @Post()
  async searchAttachments(
    @Body() searchDto: SearchDTO,
    @AuthUser() user: User,
    @AuthWorkspace() workspace: Workspace,
  ) {
    const { query } = searchDto;
    if (!query || query.length < 1) {
      return { items: [] };
    }

    const searchQuery = tsquery(query.trim() + '*');
    const userSpaceIds = this.spaceMemberRepo.getUserSpaceIdsQuery(user.id);

    const items = await this.db
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
      .where('a.workspaceId', '=', workspace.id)
      .where('a.spaceId', 'in', userSpaceIds)
      .where('a.deletedAt', 'is', null)
      .where('p.deletedAt', 'is', null)
      .$if(Boolean(searchDto.spaceId), (qb) =>
        qb.where('a.spaceId', '=', searchDto.spaceId),
      )
      .orderBy('rank', 'desc')
      .limit(searchDto.limit || 25)
      .offset(searchDto.offset || 0)
      .execute();

    return {
      items: items.map((row: any) => ({
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
      })),
    };
  }
}
