import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectKysely } from 'nestjs-kysely';
import { KyselyDB } from '@docmost/db/types/kysely.types';
import {
  AuthProvider,
  InsertableAuthProvider,
} from '@docmost/db/types/entity.types';

@Injectable()
export class SsoService {
  constructor(@InjectKysely() private readonly db: KyselyDB) {}

  async getProviders(
    workspaceId: string,
  ): Promise<{ items: AuthProvider[]; meta: Record<string, any> }> {
    const items = await this.db
      .selectFrom('authProviders')
      .selectAll()
      .where('workspaceId', '=', workspaceId)
      .where('deletedAt', 'is', null)
      .orderBy('createdAt', 'desc')
      .execute();

    return { items, meta: { count: items.length } };
  }

  async getProviderById(
    providerId: string,
    workspaceId: string,
  ): Promise<AuthProvider> {
    const provider = await this.db
      .selectFrom('authProviders')
      .selectAll()
      .where('id', '=', providerId)
      .where('workspaceId', '=', workspaceId)
      .where('deletedAt', 'is', null)
      .executeTakeFirst();

    if (!provider) {
      throw new NotFoundException('SSO provider not found');
    }

    return provider;
  }

  async createProvider(
    data: Partial<InsertableAuthProvider> & { workspaceId: string; name: string; type: string },
  ): Promise<AuthProvider> {
    const validTypes = ['saml', 'oidc', 'google', 'ldap'];
    if (!validTypes.includes(data.type)) {
      throw new BadRequestException(`Invalid provider type: ${data.type}`);
    }

    const [provider] = await this.db
      .insertInto('authProviders')
      .values({
        workspaceId: data.workspaceId,
        name: data.name,
        type: data.type,
        samlUrl: data.samlUrl ?? null,
        samlCertificate: data.samlCertificate ?? null,
        oidcIssuer: data.oidcIssuer ?? null,
        oidcClientId: data.oidcClientId ?? null,
        oidcClientSecret: data.oidcClientSecret ?? null,
        ldapUrl: data.ldapUrl ?? null,
        ldapBindDn: data.ldapBindDn ?? null,
        ldapBindPassword: data.ldapBindPassword ?? null,
        ldapBaseDn: data.ldapBaseDn ?? null,
        ldapUserSearchFilter: data.ldapUserSearchFilter ?? null,
        ldapUserAttributes: data.ldapUserAttributes ?? null,
        ldapTlsEnabled: data.ldapTlsEnabled ?? false,
        ldapTlsCaCert: data.ldapTlsCaCert ?? null,
        allowSignup: data.allowSignup ?? false,
        isEnabled: data.isEnabled ?? false,
        groupSync: data.groupSync ?? false,
        creatorId: data.creatorId ?? null,
      })
      .returningAll()
      .execute();

    return provider;
  }

  async updateProvider(
    providerId: string,
    workspaceId: string,
    data: Partial<InsertableAuthProvider>,
  ): Promise<AuthProvider> {
    const existing = await this.getProviderById(providerId, workspaceId);

    const updateData: Record<string, any> = {};
    const allowedFields = [
      'name', 'samlUrl', 'samlCertificate',
      'oidcIssuer', 'oidcClientId', 'oidcClientSecret',
      'ldapUrl', 'ldapBindDn', 'ldapBindPassword',
      'ldapBaseDn', 'ldapUserSearchFilter', 'ldapUserAttributes',
      'ldapTlsEnabled', 'ldapTlsCaCert',
      'allowSignup', 'isEnabled', 'groupSync', 'settings',
    ];

    for (const field of allowedFields) {
      if (field in data) {
        updateData[field] = (data as any)[field];
      }
    }

    if (Object.keys(updateData).length === 0) {
      return existing;
    }

    const [updated] = await this.db
      .updateTable('authProviders')
      .set({ ...updateData, updatedAt: new Date() })
      .where('id', '=', providerId)
      .where('workspaceId', '=', workspaceId)
      .returningAll()
      .execute();

    return updated;
  }

  async deleteProvider(
    providerId: string,
    workspaceId: string,
  ): Promise<void> {
    await this.getProviderById(providerId, workspaceId);

    await this.db
      .updateTable('authProviders')
      .set({ deletedAt: new Date() })
      .where('id', '=', providerId)
      .where('workspaceId', '=', workspaceId)
      .execute();
  }
}
