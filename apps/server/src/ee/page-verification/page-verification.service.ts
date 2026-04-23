import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectKysely } from 'nestjs-kysely';
import { KyselyDB } from '@docmost/db/types/kysely.types';

@Injectable()
export class PageVerificationService {
  constructor(@InjectKysely() private readonly db: KyselyDB) {}

  async getVerificationInfo(pageId: string, workspaceId: string, userId: string) {
    const verification = await this.db
      .selectFrom('pageVerifications')
      .selectAll()
      .where('pageId', '=', pageId)
      .where('workspaceId', '=', workspaceId)
      .executeTakeFirst();

    if (!verification) {
      return {
        status: 'none',
        permissions: {
          canVerify: false,
          canManage: true,
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
      .execute();

    const isVerifier = verifiers.some((v) => v.userId === userId);

    // Get user refs for verifiedBy, requestedBy, rejectedBy
    const getUserRef = async (uid: string | null) => {
      if (!uid) return null;
      const u = await this.db
        .selectFrom('users')
        .select(['id', 'name', 'email', 'avatarUrl'])
        .where('id', '=', uid)
        .executeTakeFirst();
      return u || null;
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
      verifiers: verifiers.map((v) => ({
        id: v.userId,
        name: v.name,
        email: v.email,
        avatarUrl: v.avatarUrl,
        isPrimary: v.isPrimary,
      })),
      permissions: {
        canVerify: isVerifier,
        canManage: true,
        canSubmitForApproval: true,
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
    userId: string,
  ) {
    // Get page to find spaceId
    const page = await this.db
      .selectFrom('pages')
      .select(['id', 'spaceId'])
      .where('id', '=', data.pageId)
      .where('workspaceId', '=', workspaceId)
      .executeTakeFirst();

    if (!page) throw new NotFoundException('Page not found');

    // Check if verification already exists
    const existing = await this.db
      .selectFrom('pageVerifications')
      .select('id')
      .where('pageId', '=', data.pageId)
      .where('workspaceId', '=', workspaceId)
      .executeTakeFirst();

    if (existing) {
      throw new BadRequestException('Verification already exists for this page');
    }

    let expiresAt: Date | null = null;
    if (data.mode === 'fixed' && data.fixedExpiresAt) {
      expiresAt = new Date(data.fixedExpiresAt);
    } else if (data.mode === 'period' && data.periodAmount && data.periodUnit) {
      expiresAt = this.calculateExpiration(data.periodAmount, data.periodUnit);
    }

    const [verification] = await this.db
      .insertInto('pageVerifications')
      .values({
        pageId: data.pageId,
        workspaceId,
        spaceId: page.spaceId,
        type: data.type || 'expiring',
        status: 'draft',
        mode: data.mode || null,
        periodAmount: data.periodAmount || null,
        periodUnit: data.periodUnit || null,
        expiresAt,
        creatorId: userId,
      })
      .returningAll()
      .execute();

    // Add verifiers
    if (data.verifierIds?.length) {
      await this.db
        .insertInto('pageVerifiers')
        .values(
          data.verifierIds.map((vid, index) => ({
            pageVerificationId: verification.id,
            userId: vid,
            isPrimary: index === 0,
            addedById: userId,
          })),
        )
        .execute();
    }
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
    userId: string,
  ) {
    const verification = await this.db
      .selectFrom('pageVerifications')
      .selectAll()
      .where('pageId', '=', data.pageId)
      .where('workspaceId', '=', workspaceId)
      .executeTakeFirst();

    if (!verification) throw new NotFoundException('Verification not found');

    const updateData: Record<string, any> = { updatedAt: new Date() };

    if (data.mode !== undefined) updateData.mode = data.mode;
    if (data.periodAmount !== undefined) updateData.periodAmount = data.periodAmount;
    if (data.periodUnit !== undefined) updateData.periodUnit = data.periodUnit;

    if (data.mode === 'fixed' && data.fixedExpiresAt) {
      updateData.expiresAt = new Date(data.fixedExpiresAt);
    } else if (data.mode === 'period' && data.periodAmount && data.periodUnit) {
      updateData.expiresAt = this.calculateExpiration(
        data.periodAmount,
        data.periodUnit,
      );
    }

    await this.db
      .updateTable('pageVerifications')
      .set(updateData)
      .where('id', '=', verification.id)
      .execute();

    // Update verifiers if provided
    if (data.verifierIds) {
      await this.db
        .deleteFrom('pageVerifiers')
        .where('pageVerificationId', '=', verification.id)
        .execute();

      if (data.verifierIds.length) {
        await this.db
          .insertInto('pageVerifiers')
          .values(
            data.verifierIds.map((vid, index) => ({
              pageVerificationId: verification.id,
              userId: vid,
              isPrimary: index === 0,
              addedById: userId,
            })),
          )
          .execute();
      }
    }
  }

  async removeVerification(pageId: string, workspaceId: string) {
    const verification = await this.db
      .selectFrom('pageVerifications')
      .select('id')
      .where('pageId', '=', pageId)
      .where('workspaceId', '=', workspaceId)
      .executeTakeFirst();

    if (!verification) throw new NotFoundException('Verification not found');

    await this.db
      .deleteFrom('pageVerifiers')
      .where('pageVerificationId', '=', verification.id)
      .execute();

    await this.db
      .deleteFrom('pageVerifications')
      .where('id', '=', verification.id)
      .execute();
  }

  async verifyPage(pageId: string, workspaceId: string, userId: string) {
    const verification = await this.db
      .selectFrom('pageVerifications')
      .selectAll()
      .where('pageId', '=', pageId)
      .where('workspaceId', '=', workspaceId)
      .executeTakeFirst();

    if (!verification) throw new NotFoundException('Verification not found');

    let newExpiresAt: Date | null = null;
    if (verification.mode === 'period' && verification.periodAmount && verification.periodUnit) {
      newExpiresAt = this.calculateExpiration(
        verification.periodAmount,
        verification.periodUnit,
      );
    } else if (verification.mode === 'indefinite') {
      newExpiresAt = null;
    } else {
      newExpiresAt = verification.expiresAt;
    }

    await this.db
      .updateTable('pageVerifications')
      .set({
        status: 'verified',
        verifiedAt: new Date(),
        verifiedById: userId,
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

  async submitForApproval(pageId: string, workspaceId: string, userId: string) {
    const verification = await this.db
      .selectFrom('pageVerifications')
      .select('id')
      .where('pageId', '=', pageId)
      .where('workspaceId', '=', workspaceId)
      .executeTakeFirst();

    if (!verification) throw new NotFoundException('Verification not found');

    await this.db
      .updateTable('pageVerifications')
      .set({
        status: 'in_approval',
        requestedAt: new Date(),
        requestedById: userId,
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
    userId: string,
    comment?: string,
  ) {
    const verification = await this.db
      .selectFrom('pageVerifications')
      .select('id')
      .where('pageId', '=', pageId)
      .where('workspaceId', '=', workspaceId)
      .executeTakeFirst();

    if (!verification) throw new NotFoundException('Verification not found');

    await this.db
      .updateTable('pageVerifications')
      .set({
        status: 'draft',
        rejectedAt: new Date(),
        rejectedById: userId,
        rejectionComment: comment || null,
        updatedAt: new Date(),
      })
      .where('id', '=', verification.id)
      .execute();
  }

  async markObsolete(pageId: string, workspaceId: string, userId: string) {
    const verification = await this.db
      .selectFrom('pageVerifications')
      .select('id')
      .where('pageId', '=', pageId)
      .where('workspaceId', '=', workspaceId)
      .executeTakeFirst();

    if (!verification) throw new NotFoundException('Verification not found');

    await this.db
      .updateTable('pageVerifications')
      .set({
        status: 'obsolete',
        updatedAt: new Date(),
      })
      .where('id', '=', verification.id)
      .execute();
  }

  async getVerificationList(
    workspaceId: string,
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
      .where('pageVerifications.workspaceId', '=', workspaceId);

    if (params.spaceIds?.length) {
      query = query.where('pageVerifications.spaceId', 'in', params.spaceIds);
    }

    if (params.type) {
      query = query.where('pageVerifications.type', '=', params.type);
    }

    if (params.cursor) {
      query = query.where('pageVerifications.createdAt', '<', new Date(params.cursor));
    }

    query = query.orderBy('pageVerifications.createdAt', 'desc').limit(limit + 1);

    const items = await query.execute();

    const hasMore = items.length > limit;
    if (hasMore) items.pop();

    // Fetch verifiers for each item
    const verificationIds = items.map((i) => i.id);
    let verifierMap: Record<string, any[]> = {};
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
        .execute();

      for (const v of verifiers) {
        if (!verifierMap[v.pageVerificationId]) {
          verifierMap[v.pageVerificationId] = [];
        }
        verifierMap[v.pageVerificationId].push({
          id: v.userId,
          name: v.name,
          email: v.email,
          avatarUrl: v.avatarUrl,
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
        cursor: hasMore && items.length > 0
          ? items[items.length - 1].createdAt
          : null,
      },
    };
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
