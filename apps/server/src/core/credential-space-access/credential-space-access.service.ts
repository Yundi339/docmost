import {
  BadRequestException,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { createHash } from 'node:crypto';
import { InjectKysely } from 'nestjs-kysely';
import { KyselyTransaction } from '@docmost/db/types/kysely.types';
import { KyselyDB } from '@docmost/db/types/kysely.types';
import { dbOrTx } from '@docmost/db/utils';
import {
  CredentialSpace,
  CredentialSpaceAccessContext,
  CredentialSpaceAccessInput,
  CredentialSpaceAccessMode,
  CredentialSpaceAccessView,
} from './credential-space-access.types';

type CredentialRecord = {
  id: string;
  workspaceId: string;
  spaceAccessMode: string;
};

@Injectable()
export class CredentialSpaceAccessService {
  constructor(@InjectKysely() private readonly db: KyselyDB) {}

  async normalizeSelection(
    input: CredentialSpaceAccessInput | undefined,
    userId: string,
    workspaceId: string,
  ): Promise<{ mode: CredentialSpaceAccessMode; spaceIds: string[] }> {
    if (input && input.mode !== 'all' && input.mode !== 'selected') {
      throw new BadRequestException('Invalid space access mode');
    }
    if (!input || input.mode === 'all') {
      if (input && (input as any).spaceIds !== undefined) {
        throw new BadRequestException(
          'spaceIds must not be provided when all spaces are selected',
        );
      }
      return { mode: 'all', spaceIds: [] };
    }

    if (!Array.isArray(input.spaceIds)) {
      throw new BadRequestException('spaceIds must be an array');
    }
    if (
      input.spaceIds.some(
        (spaceId) =>
          typeof spaceId !== 'string' ||
          !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
            spaceId,
          ),
      )
    ) {
      throw new BadRequestException('spaceIds must contain valid UUIDs');
    }
    const spaceIds = [...new Set(input.spaceIds)];
    if (spaceIds.length === 0) {
      throw new BadRequestException('Select at least one space');
    }
    if (spaceIds.length > 200) {
      throw new BadRequestException('A maximum of 200 spaces can be selected');
    }

    const accessible = new Set(
      await this.getAccessibleSpaceIds(userId, workspaceId),
    );
    if (spaceIds.some((spaceId) => !accessible.has(spaceId))) {
      throw new ForbiddenException(
        'One or more selected spaces are not accessible',
      );
    }

    return { mode: 'selected', spaceIds: spaceIds.sort() };
  }

  async replaceApiKeyAccess(
    apiKeyId: string,
    selection: { mode: CredentialSpaceAccessMode; spaceIds: string[] },
    trx?: KyselyTransaction,
  ) {
    const db = dbOrTx(this.db, trx);
    await db
      .updateTable('apiKeys')
      .set({ spaceAccessMode: selection.mode, updatedAt: new Date() })
      .where('id', '=', apiKeyId)
      .execute();
    await db
      .deleteFrom('apiKeySpaceGrants')
      .where('apiKeyId', '=', apiKeyId)
      .execute();
    if (selection.mode === 'selected') {
      await db
        .insertInto('apiKeySpaceGrants')
        .values(selection.spaceIds.map((spaceId) => ({ apiKeyId, spaceId })))
        .execute();
    }
  }

  async replaceOAuthAuthorizationAccess(
    authorizationId: string,
    selection: { mode: CredentialSpaceAccessMode; spaceIds: string[] },
    trx?: KyselyTransaction,
  ) {
    const db = dbOrTx(this.db, trx);
    await db
      .updateTable('oauthAuthorizations')
      .set({ spaceAccessMode: selection.mode, updatedAt: new Date() })
      .where('id', '=', authorizationId)
      .execute();
    await db
      .deleteFrom('oauthAuthorizationSpaceGrants')
      .where('authorizationId', '=', authorizationId)
      .execute();
    if (selection.mode === 'selected') {
      await db
        .insertInto('oauthAuthorizationSpaceGrants')
        .values(
          selection.spaceIds.map((spaceId) => ({
            authorizationId,
            spaceId,
          })),
        )
        .execute();
    }
  }

  async resolveApiKeyAccess(input: {
    id: string;
    creatorId: string;
    workspaceId: string;
    spaceAccessMode: string;
  }) {
    const selectedSpaceIds = await this.getApiKeyGrantIds(input.id);
    return this.resolveContext(
      input.spaceAccessMode,
      selectedSpaceIds,
      input.creatorId,
      input.workspaceId,
    );
  }

  async resolveOAuthAuthorizationAccess(input: {
    id: string;
    userId: string;
    workspaceId: string;
    spaceAccessMode: string;
  }) {
    const selectedSpaceIds = await this.getOAuthGrantIds(input.id);
    return this.resolveContext(
      input.spaceAccessMode,
      selectedSpaceIds,
      input.userId,
      input.workspaceId,
    );
  }

  async listSelectableSpaces(
    userId: string,
    workspaceId: string,
  ): Promise<CredentialSpace[]> {
    const ids = await this.getAccessibleSpaceIds(userId, workspaceId);
    if (ids.length === 0) return [];
    return this.db
      .selectFrom('spaces')
      .select(['id', 'name', 'slug'])
      .where('workspaceId', '=', workspaceId)
      .where('id', 'in', ids)
      .orderBy('name', 'asc')
      .execute();
  }

  async addApiKeyViews<T extends CredentialRecord & { creatorId: string }>(
    records: T[],
  ) {
    return this.addViews(
      records.map((record) => ({ record, ownerId: record.creatorId })),
      'api_key',
    );
  }

  async addOAuthViews<T extends CredentialRecord & { userId: string }>(
    records: T[],
  ) {
    return this.addViews(
      records.map((record) => ({ record, ownerId: record.userId })),
      'oauth',
    );
  }

  private async addViews<T extends CredentialRecord>(
    entries: Array<{ record: T; ownerId: string }>,
    kind: 'api_key' | 'oauth',
  ): Promise<Array<T & { spaceAccess: CredentialSpaceAccessView }>> {
    const accessibleByUser = new Map<string, Set<string>>();
    const result = [];
    for (const { record, ownerId } of entries) {
      const userKey = `${ownerId}:${record.workspaceId}`;
      let accessible = accessibleByUser.get(userKey);
      if (!accessible) {
        accessible = new Set(
          await this.getAccessibleSpaceIds(ownerId, record.workspaceId),
        );
        accessibleByUser.set(userKey, accessible);
      }

      const spaces =
        kind === 'api_key'
          ? await this.getApiKeyGrantSpaces(record.id, record.workspaceId)
          : await this.getOAuthGrantSpaces(record.id, record.workspaceId);
      const mode = normalizeMode(record.spaceAccessMode);
      const effectiveCount =
        mode === 'all'
          ? accessible.size
          : spaces.filter((space) => accessible.has(space.id)).length;
      result.push({
        ...record,
        spaceAccess: {
          mode,
          spaces,
          selectedCount: spaces.length,
          effectiveCount,
          status: effectiveCount > 0 ? 'active' : 'no_effective_spaces',
        },
      });
    }
    return result;
  }

  private async resolveContext(
    rawMode: string,
    selectedSpaceIds: string[],
    userId: string,
    workspaceId: string,
  ): Promise<CredentialSpaceAccessContext> {
    const mode = normalizeMode(rawMode);
    const accessible = await this.getAccessibleSpaceIds(userId, workspaceId);
    const accessibleSet = new Set(accessible);
    const effectiveSpaceIds = (
      mode === 'all'
        ? accessible
        : selectedSpaceIds.filter((spaceId) => accessibleSet.has(spaceId))
    ).sort();

    if (effectiveSpaceIds.length === 0) {
      throw new ForbiddenException('Credential has no accessible spaces');
    }

    const normalizedSelected = [...selectedSpaceIds].sort();
    return {
      mode,
      selectedSpaceIds: normalizedSelected,
      effectiveSpaceIds,
      revision: createHash('sha256')
        .update(
          JSON.stringify({
            mode,
            selectedSpaceIds: normalizedSelected,
            effectiveSpaceIds,
          }),
        )
        .digest('hex'),
    };
  }

  private async getAccessibleSpaceIds(userId: string, workspaceId: string) {
    const rows = await this.db
      .selectFrom('spaces')
      .select('spaces.id')
      .where('spaces.workspaceId', '=', workspaceId)
      .where((eb) =>
        eb.or([
          eb.exists(
            eb
              .selectFrom('spaceMembers')
              .select('spaceMembers.id')
              .whereRef('spaceMembers.spaceId', '=', 'spaces.id')
              .where('spaceMembers.userId', '=', userId),
          ),
          eb.exists(
            eb
              .selectFrom('spaceMembers')
              .innerJoin(
                'groupUsers',
                'groupUsers.groupId',
                'spaceMembers.groupId',
              )
              .select('spaceMembers.id')
              .whereRef('spaceMembers.spaceId', '=', 'spaces.id')
              .where('groupUsers.userId', '=', userId),
          ),
        ]),
      )
      .execute();
    return rows.map((row) => row.id);
  }

  private async getApiKeyGrantIds(apiKeyId: string) {
    const rows = await this.db
      .selectFrom('apiKeySpaceGrants')
      .select('spaceId')
      .where('apiKeyId', '=', apiKeyId)
      .execute();
    return rows.map((row) => row.spaceId);
  }

  private async getOAuthGrantIds(authorizationId: string) {
    const rows = await this.db
      .selectFrom('oauthAuthorizationSpaceGrants')
      .select('spaceId')
      .where('authorizationId', '=', authorizationId)
      .execute();
    return rows.map((row) => row.spaceId);
  }

  private getApiKeyGrantSpaces(apiKeyId: string, workspaceId: string) {
    return this.db
      .selectFrom('apiKeySpaceGrants as grant')
      .innerJoin('spaces', 'spaces.id', 'grant.spaceId')
      .select(['spaces.id', 'spaces.name', 'spaces.slug'])
      .where('grant.apiKeyId', '=', apiKeyId)
      .where('spaces.workspaceId', '=', workspaceId)
      .orderBy('spaces.name', 'asc')
      .execute();
  }

  private getOAuthGrantSpaces(authorizationId: string, workspaceId: string) {
    return this.db
      .selectFrom('oauthAuthorizationSpaceGrants as grant')
      .innerJoin('spaces', 'spaces.id', 'grant.spaceId')
      .select(['spaces.id', 'spaces.name', 'spaces.slug'])
      .where('grant.authorizationId', '=', authorizationId)
      .where('spaces.workspaceId', '=', workspaceId)
      .orderBy('spaces.name', 'asc')
      .execute();
  }
}

function normalizeMode(value: string): CredentialSpaceAccessMode {
  if (value === 'all' || value === 'selected') return value;
  throw new ForbiddenException('Invalid credential space access mode');
}
