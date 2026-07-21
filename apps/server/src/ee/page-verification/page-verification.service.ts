import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectKysely } from 'nestjs-kysely';
import { KyselyDB, KyselyTransaction } from '@docmost/db/types/kysely.types';
import { dbOrTx, executeTx } from '@docmost/db/utils';
import { PageRepo } from '@docmost/db/repos/page/page.repo';
import { SpaceMemberRepo } from '@docmost/db/repos/space/space-member.repo';
import { PageAccessService } from '../../core/page/page-access/page-access.service';
import type { User } from '@docmost/db/types/entity.types';
import { PagePermissionRepo } from '@docmost/db/repos/page/page-permission.repo';
import { sql } from 'kysely';

@Injectable()
export class PageVerificationService {
  constructor(
    @InjectKysely() private readonly db: KyselyDB,
    private readonly pageRepo: PageRepo,
    private readonly spaceMemberRepo: SpaceMemberRepo,
    private readonly pageAccessService: PageAccessService,
    private readonly pagePermissionRepo: PagePermissionRepo,
  ) {}

  async getVerificationInfo(pageId: string, workspaceId: string, user: User) {
    const page = await this.getPageOrThrow(pageId, workspaceId);
    const { canEdit } =
      await this.pageAccessService.validateCanViewWithPermissions(page, user);
    const verification = await this.findVerification(page.id, workspaceId);

    if (!verification) {
      return {
        status: 'none',
        permissions: {
          canVerify: false,
          canManage: canEdit,
          canSubmitForApproval: false,
          canMarkObsolete: false,
        },
      };
    }

    const verifiers = await this.db
      .selectFrom('pageVerifiers')
      .innerJoin('users', 'users.id', 'pageVerifiers.userId')
      .select([
        'pageVerifiers.userId',
        'pageVerifiers.isPrimary',
        'users.name',
        'users.email',
        'users.avatarUrl',
      ])
      .where('pageVerifiers.pageVerificationId', '=', verification.id)
      .where('users.workspaceId', '=', workspaceId)
      .where('users.deactivatedAt', 'is', null)
      .where('users.deletedAt', 'is', null)
      .execute();

    const isVerifier = verifiers.some(
      (verifier) => verifier.userId === user.id,
    );
    const getUserRef = async (referencedUserId: string | null) => {
      if (!referencedUserId) return null;
      return (
        (await this.db
          .selectFrom('users')
          .select(['id', 'name', 'email', 'avatarUrl'])
          .where('id', '=', referencedUserId)
          .where('workspaceId', '=', workspaceId)
          .executeTakeFirst()) ?? null
      );
    };

    const [verifiedBy, requestedBy, rejectedBy] = await Promise.all([
      getUserRef(verification.verifiedById),
      getUserRef(verification.requestedById),
      getUserRef(verification.rejectedById),
    ]);

    return {
      id: verification.id,
      pageId: verification.pageId,
      type: verification.type,
      mode: verification.mode,
      periodAmount: verification.periodAmount,
      periodUnit: verification.periodUnit,
      status: verification.status ?? 'none',
      verifiedAt: verification.verifiedAt,
      verifiedBy,
      expiresAt: verification.expiresAt,
      requestedAt: verification.requestedAt,
      requestedBy,
      rejectedAt: verification.rejectedAt,
      rejectedBy,
      rejectionComment: verification.rejectionComment,
      verifiers: verifiers.map((verifier) => ({
        id: verifier.userId,
        name: verifier.name,
        email: verifier.email,
        avatarUrl: verifier.avatarUrl,
        isPrimary: verifier.isPrimary,
      })),
      permissions: {
        canVerify: isVerifier,
        canManage: canEdit,
        canSubmitForApproval: canEdit,
        canMarkObsolete: isVerifier,
      },
    };
  }

  async setupVerification(
    data: {
      pageId: string;
      type?: string;
      mode?: string;
      periodAmount?: number;
      periodUnit?: string;
      fixedExpiresAt?: string;
      verifierIds: string[];
    },
    workspaceId: string,
    user: User,
  ) {
    const page = await this.getPageOrThrow(data.pageId, workspaceId);
    await this.pageAccessService.validateCanEdit(page, user);

    await executeTx(this.db, async (trx) => {
      const existing = await this.findVerification(page.id, workspaceId, trx);
      if (existing) {
        throw new BadRequestException(
          'Verification already exists for this page',
        );
      }
      await this.validateVerifierIds(data.verifierIds ?? [], workspaceId, trx);

      let expiresAt: Date | null = null;
      if (data.mode === 'fixed' && data.fixedExpiresAt) {
        expiresAt = new Date(data.fixedExpiresAt);
      } else if (
        data.mode === 'period' &&
        data.periodAmount &&
        data.periodUnit
      ) {
        expiresAt = this.calculateExpiration(
          data.periodAmount,
          data.periodUnit,
        );
      }

      const [verification] = await trx
        .insertInto('pageVerifications')
        .values({
          pageId: page.id,
          workspaceId,
          spaceId: page.spaceId,
          type: data.type || 'expiring',
          status: 'draft',
          mode: data.mode || null,
          periodAmount: data.periodAmount || null,
          periodUnit: data.periodUnit || null,
          expiresAt,
          creatorId: user.id,
        })
        .returningAll()
        .execute();

      if (data.verifierIds?.length) {
        await trx
          .insertInto('pageVerifiers')
          .values(
            [...new Set(data.verifierIds)].map((verifierId, index) => ({
              pageVerificationId: verification.id,
              userId: verifierId,
              isPrimary: index === 0,
              addedById: user.id,
            })),
          )
          .execute();
      }
    });
  }

  async updateVerification(
    data: {
      pageId: string;
      mode?: string;
      periodAmount?: number;
      periodUnit?: string;
      fixedExpiresAt?: string;
      verifierIds?: string[];
    },
    workspaceId: string,
    user: User,
  ) {
    const page = await this.getPageOrThrow(data.pageId, workspaceId);
    await this.pageAccessService.validateCanEdit(page, user);

    await executeTx(this.db, async (trx) => {
      const verification = await this.getVerificationOrThrow(
        page.id,
        workspaceId,
        trx,
      );
      if (data.verifierIds) {
        await this.validateVerifierIds(data.verifierIds, workspaceId, trx);
      }

      const updateData: Record<string, unknown> = { updatedAt: new Date() };
      if (data.mode !== undefined) updateData.mode = data.mode;
      if (data.periodAmount !== undefined) {
        updateData.periodAmount = data.periodAmount;
      }
      if (data.periodUnit !== undefined)
        updateData.periodUnit = data.periodUnit;

      if (data.mode === 'fixed' && data.fixedExpiresAt) {
        updateData.expiresAt = new Date(data.fixedExpiresAt);
      } else if (
        data.mode === 'period' &&
        data.periodAmount &&
        data.periodUnit
      ) {
        updateData.expiresAt = this.calculateExpiration(
          data.periodAmount,
          data.periodUnit,
        );
      }

      await trx
        .updateTable('pageVerifications')
        .set(updateData)
        .where('id', '=', verification.id)
        .execute();

      if (data.verifierIds) {
        await trx
          .deleteFrom('pageVerifiers')
          .where('pageVerificationId', '=', verification.id)
          .execute();

        if (data.verifierIds.length) {
          await trx
            .insertInto('pageVerifiers')
            .values(
              [...new Set(data.verifierIds)].map((verifierId, index) => ({
                pageVerificationId: verification.id,
                userId: verifierId,
                isPrimary: index === 0,
                addedById: user.id,
              })),
            )
            .execute();
        }
      }
    });
  }

  async removeVerification(pageId: string, workspaceId: string, user: User) {
    const page = await this.getPageOrThrow(pageId, workspaceId);
    await this.pageAccessService.validateCanEdit(page, user);

    await executeTx(this.db, async (trx) => {
      const verification = await this.getVerificationOrThrow(
        page.id,
        workspaceId,
        trx,
      );
      await trx
        .deleteFrom('pageVerifiers')
        .where('pageVerificationId', '=', verification.id)
        .execute();
      await trx
        .deleteFrom('pageVerifications')
        .where('id', '=', verification.id)
        .execute();
    });
  }

  async verifyPage(pageId: string, workspaceId: string, user: User) {
    const { verification } = await this.getVerifierActionContext(
      pageId,
      workspaceId,
      user,
    );

    let newExpiresAt: Date | null = null;
    if (
      verification.mode === 'period' &&
      verification.periodAmount &&
      verification.periodUnit
    ) {
      newExpiresAt = this.calculateExpiration(
        verification.periodAmount,
        verification.periodUnit,
      );
    } else if (verification.mode !== 'indefinite') {
      newExpiresAt = verification.expiresAt;
    }

    await this.db
      .updateTable('pageVerifications')
      .set({
        status: 'verified',
        verifiedAt: new Date(),
        verifiedById: user.id,
        expiresAt: newExpiresAt,
        requestedAt: null,
        requestedById: null,
        rejectedAt: null,
        rejectedById: null,
        rejectionComment: null,
        updatedAt: new Date(),
      })
      .where('id', '=', verification.id)
      .execute();
  }

  async submitForApproval(pageId: string, workspaceId: string, user: User) {
    const page = await this.getPageOrThrow(pageId, workspaceId);
    await this.pageAccessService.validateCanEdit(page, user);
    const verification = await this.getVerificationOrThrow(
      page.id,
      workspaceId,
    );

    await this.db
      .updateTable('pageVerifications')
      .set({
        status: 'in_approval',
        requestedAt: new Date(),
        requestedById: user.id,
        rejectedAt: null,
        rejectedById: null,
        rejectionComment: null,
        updatedAt: new Date(),
      })
      .where('id', '=', verification.id)
      .execute();
  }

  async rejectApproval(
    pageId: string,
    workspaceId: string,
    user: User,
    comment?: string,
  ) {
    const { verification } = await this.getVerifierActionContext(
      pageId,
      workspaceId,
      user,
    );
    await this.db
      .updateTable('pageVerifications')
      .set({
        status: 'draft',
        rejectedAt: new Date(),
        rejectedById: user.id,
        rejectionComment: comment || null,
        updatedAt: new Date(),
      })
      .where('id', '=', verification.id)
      .execute();
  }

  async markObsolete(pageId: string, workspaceId: string, user: User) {
    const { verification } = await this.getVerifierActionContext(
      pageId,
      workspaceId,
      user,
    );
    await this.db
      .updateTable('pageVerifications')
      .set({ status: 'obsolete', updatedAt: new Date() })
      .where('id', '=', verification.id)
      .execute();
  }

  async getVerificationList(
    workspaceId: string,
    user: User,
    params: {
      spaceIds?: string[];
      verifierId?: string;
      type?: string;
      cursor?: string;
      limit?: number;
      query?: string;
    },
  ) {
    const limit = params.limit || 50;
    const accessibleSpaceIds = await this.spaceMemberRepo.getUserSpaceIds(
      user.id,
    );
    if (accessibleSpaceIds.length === 0) {
      return { items: [], meta: { hasMore: false, cursor: null } };
    }

    const cursor = this.parseVerificationCursor(params.cursor);
    let query = this.db
      .selectFrom('pageVerifications')
      .innerJoin('pages', 'pages.id', 'pageVerifications.pageId')
      .innerJoin('spaces', 'spaces.id', 'pageVerifications.spaceId')
      .select([
        'pageVerifications.id',
        'pageVerifications.pageId',
        'pageVerifications.spaceId',
        'pageVerifications.type',
        'pageVerifications.status',
        'pageVerifications.mode',
        'pageVerifications.periodAmount',
        'pageVerifications.periodUnit',
        'pageVerifications.verifiedAt',
        'pageVerifications.expiresAt',
        'pageVerifications.createdAt',
        'pages.title as pageTitle',
        'pages.slugId as pageSlugId',
        'pages.icon as pageIcon',
        'spaces.name as spaceName',
        'spaces.slug as spaceSlug',
      ])
      .where('pageVerifications.workspaceId', '=', workspaceId)
      .where('pageVerifications.spaceId', 'in', accessibleSpaceIds)
      .where('pages.deletedAt', 'is', null)
      .where(
        this.pagePermissionRepo.userCanAccessPagePredicate(
          user.id,
          sql.ref('pageVerifications.pageId'),
        ),
      );

    if (params.spaceIds?.length) {
      query = query.where('pageVerifications.spaceId', 'in', params.spaceIds);
    }
    if (params.type) {
      query = query.where('pageVerifications.type', '=', params.type);
    }
    if (params.query?.trim()) {
      const search = `%${params.query.trim()}%`;
      query = query.where((eb) =>
        eb.or([
          eb(sql`f_unaccent(pages.title)`, 'ilike', sql`f_unaccent(${search})`),
          eb(sql`f_unaccent(spaces.name)`, 'ilike', sql`f_unaccent(${search})`),
        ]),
      );
    }
    if (params.verifierId) {
      query = query.where((eb) =>
        eb.exists(
          eb
            .selectFrom('pageVerifiers')
            .select('pageVerifiers.userId')
            .whereRef(
              'pageVerifiers.pageVerificationId',
              '=',
              'pageVerifications.id',
            )
            .where('pageVerifiers.userId', '=', params.verifierId),
        ),
      );
    }
    if (cursor) {
      query = query.where((eb) =>
        cursor.id
          ? eb.or([
              eb('pageVerifications.createdAt', '<', cursor.createdAt),
              eb.and([
                eb('pageVerifications.createdAt', '=', cursor.createdAt),
                eb('pageVerifications.id', '<', cursor.id),
              ]),
            ])
          : eb('pageVerifications.createdAt', '<', cursor.createdAt),
      );
    }

    const candidates = await query
      .orderBy('pageVerifications.createdAt', 'desc')
      .orderBy('pageVerifications.id', 'desc')
      .limit(limit + 1)
      .execute();
    const hasMore = candidates.length > limit;
    const items = candidates.slice(0, limit);

    const verificationIds = items.map((item) => item.id);
    const verifierMap: Record<string, Array<Record<string, unknown>>> = {};
    if (verificationIds.length > 0) {
      const verifiers = await this.db
        .selectFrom('pageVerifiers')
        .innerJoin('users', 'users.id', 'pageVerifiers.userId')
        .select([
          'pageVerifiers.pageVerificationId',
          'pageVerifiers.userId',
          'users.name',
          'users.email',
          'users.avatarUrl',
        ])
        .where('pageVerifiers.pageVerificationId', 'in', verificationIds)
        .where('users.workspaceId', '=', workspaceId)
        .where('users.deactivatedAt', 'is', null)
        .where('users.deletedAt', 'is', null)
        .execute();

      for (const verifier of verifiers) {
        verifierMap[verifier.pageVerificationId] ??= [];
        verifierMap[verifier.pageVerificationId].push({
          id: verifier.userId,
          name: verifier.name,
          email: verifier.email,
          avatarUrl: verifier.avatarUrl,
        });
      }
    }

    return {
      items: items.map((item) => ({
        ...item,
        verifiers: verifierMap[item.id] || [],
      })),
      meta: {
        hasMore,
        cursor:
          hasMore && items.length > 0
            ? this.encodeVerificationCursor(items[items.length - 1])
            : null,
      },
    };
  }

  private parseVerificationCursor(cursor?: string) {
    if (!cursor) return undefined;
    try {
      const parsed = JSON.parse(
        Buffer.from(cursor, 'base64url').toString('utf8'),
      ) as { createdAt?: string; id?: string };
      const createdAt = new Date(parsed.createdAt ?? '');
      if (!Number.isNaN(createdAt.getTime()) && parsed.id) {
        return { createdAt, id: parsed.id };
      }
    } catch {
      // Legacy cursors were ISO date strings.
    }

    const createdAt = new Date(cursor);
    if (Number.isNaN(createdAt.getTime())) {
      throw new BadRequestException('Invalid cursor');
    }
    return { createdAt, id: undefined };
  }

  private encodeVerificationCursor(item: { id: string; createdAt: Date }) {
    return Buffer.from(
      JSON.stringify({
        createdAt: item.createdAt.toISOString(),
        id: item.id,
      }),
    ).toString('base64url');
  }

  private async getVerifierActionContext(
    pageId: string,
    workspaceId: string,
    user: User,
  ) {
    const page = await this.getPageOrThrow(pageId, workspaceId);
    await this.pageAccessService.validateCanView(page, user);
    const verification = await this.getVerificationOrThrow(
      page.id,
      workspaceId,
    );
    const verifier = await this.db
      .selectFrom('pageVerifiers')
      .innerJoin('users', 'users.id', 'pageVerifiers.userId')
      .select('pageVerifiers.userId')
      .where('pageVerifiers.pageVerificationId', '=', verification.id)
      .where('pageVerifiers.userId', '=', user.id)
      .where('users.workspaceId', '=', workspaceId)
      .where('users.deactivatedAt', 'is', null)
      .where('users.deletedAt', 'is', null)
      .executeTakeFirst();
    if (!verifier) {
      throw new ForbiddenException();
    }
    return { page, verification };
  }

  private async getPageOrThrow(pageId: string, workspaceId: string) {
    const page = await this.pageRepo.findById(pageId);
    if (!page || page.workspaceId !== workspaceId || page.deletedAt) {
      throw new NotFoundException('Page not found');
    }
    return page;
  }

  private async findVerification(
    pageId: string,
    workspaceId: string,
    trx?: KyselyTransaction,
  ) {
    return dbOrTx(this.db, trx)
      .selectFrom('pageVerifications')
      .selectAll()
      .where('pageId', '=', pageId)
      .where('workspaceId', '=', workspaceId)
      .executeTakeFirst();
  }

  private async getVerificationOrThrow(
    pageId: string,
    workspaceId: string,
    trx?: KyselyTransaction,
  ) {
    const verification = await this.findVerification(pageId, workspaceId, trx);
    if (!verification) {
      throw new NotFoundException('Verification not found');
    }
    return verification;
  }

  private async validateVerifierIds(
    verifierIds: string[],
    workspaceId: string,
    trx: KyselyTransaction,
  ) {
    const uniqueVerifierIds = [...new Set(verifierIds)];
    if (uniqueVerifierIds.length === 0) return;

    const validVerifiers = await trx
      .selectFrom('users')
      .select('id')
      .where('id', 'in', uniqueVerifierIds)
      .where('workspaceId', '=', workspaceId)
      .where('deactivatedAt', 'is', null)
      .where('deletedAt', 'is', null)
      .execute();
    if (validVerifiers.length !== uniqueVerifierIds.length) {
      throw new NotFoundException('Verifier not found');
    }
  }

  private calculateExpiration(amount: number, unit: string): Date {
    const now = new Date();
    switch (unit) {
      case 'day':
        now.setDate(now.getDate() + amount);
        break;
      case 'week':
        now.setDate(now.getDate() + amount * 7);
        break;
      case 'month':
        now.setMonth(now.getMonth() + amount);
        break;
      case 'year':
        now.setFullYear(now.getFullYear() + amount);
        break;
    }
    return now;
  }
}
