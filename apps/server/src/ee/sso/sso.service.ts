import {
  BadRequestException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectKysely } from 'nestjs-kysely';
import { KyselyDB } from '@docmost/db/types/kysely.types';
import { AuthProvider, User } from '@docmost/db/types/entity.types';
import { UserRole } from '../../common/helpers/types/permission';
import {
  AUDIT_SERVICE,
  IAuditService,
} from '../../integrations/audit/audit.service';
import { AuditEvent, AuditResource } from '../../common/events/audit-events';
import { CreateSsoProviderDto, UpdateSsoProviderDto } from './dto/sso.dto';
import { SsoSecretService } from './sso-secret.service';
import { SsoLoginCapabilityService } from '../../core/auth/services/sso-login-capability.service';

type SsoProviderView = Omit<
  AuthProvider,
  'oidcClientSecret' | 'ldapBindPassword' | 'ldapConfig' | 'settings'
> & {
  hasOidcClientSecret: boolean;
  hasLdapBindPassword: boolean;
  loginAvailable: boolean;
};

type UpdateSsoProviderInput = Omit<UpdateSsoProviderDto, 'providerId'>;

@Injectable()
export class SsoService {
  constructor(
    @InjectKysely() private readonly db: KyselyDB,
    private readonly secretService: SsoSecretService,
    @Inject(AUDIT_SERVICE) private readonly auditService: IAuditService,
    private readonly loginCapability: SsoLoginCapabilityService,
  ) {}

  async getProviders(
    workspaceId: string,
    actor: User,
  ): Promise<{ items: SsoProviderView[]; meta: { count: number } }> {
    this.assertOwner(actor);

    const providers = await this.db
      .selectFrom('authProviders')
      .selectAll()
      .where('workspaceId', '=', workspaceId)
      .where('deletedAt', 'is', null)
      .orderBy('createdAt', 'desc')
      .execute();

    const protectedProviders = await Promise.all(
      providers.map((provider) => this.protectStoredSecrets(provider)),
    );

    return {
      items: protectedProviders.map((provider) =>
        this.toProviderView(provider),
      ),
      meta: { count: providers.length },
    };
  }

  async getProviderById(
    providerId: string,
    workspaceId: string,
    actor: User,
  ): Promise<SsoProviderView> {
    this.assertOwner(actor);
    const provider = await this.findProviderById(providerId, workspaceId);
    return this.toProviderView(await this.protectStoredSecrets(provider));
  }

  async createProvider(
    input: CreateSsoProviderDto,
    workspaceId: string,
    actor: User,
  ): Promise<SsoProviderView> {
    this.assertOwner(actor);

    const provider = await this.db
      .insertInto('authProviders')
      .values({
        workspaceId,
        name: input.name,
        type: input.type,
        creatorId: actor.id,
      })
      .returningAll()
      .executeTakeFirstOrThrow();

    this.auditService.log({
      event: AuditEvent.SSO_PROVIDER_CREATED,
      resourceType: AuditResource.SSO_PROVIDER,
      resourceId: provider.id,
      changes: { after: this.toAuditSnapshot(provider) },
    });

    return this.toProviderView(provider);
  }

  async updateProvider(
    providerId: string,
    workspaceId: string,
    input: UpdateSsoProviderInput,
    actor: User,
  ): Promise<SsoProviderView> {
    this.assertOwner(actor);
    const existing = await this.findProviderById(providerId, workspaceId);
    if (input.isEnabled === true) {
      this.loginCapability.assertLoginAvailable(existing.type);
    }
    const updateData = this.prepareUpdate(input);

    if (Object.keys(updateData).length === 0) {
      return this.toProviderView(await this.protectStoredSecrets(existing));
    }

    const updated = await this.db
      .updateTable('authProviders')
      .set({ ...updateData, updatedAt: new Date() })
      .where('id', '=', providerId)
      .where('workspaceId', '=', workspaceId)
      .where('deletedAt', 'is', null)
      .returningAll()
      .executeTakeFirstOrThrow();

    this.auditService.log({
      event: AuditEvent.SSO_PROVIDER_UPDATED,
      resourceType: AuditResource.SSO_PROVIDER,
      resourceId: updated.id,
      changes: {
        before: this.toAuditSnapshot(existing),
        after: this.toAuditSnapshot(updated),
      },
    });

    return this.toProviderView(updated);
  }

  async deleteProvider(
    providerId: string,
    workspaceId: string,
    actor: User,
  ): Promise<void> {
    this.assertOwner(actor);
    const existing = await this.findProviderById(providerId, workspaceId);

    await this.db
      .updateTable('authProviders')
      .set({ deletedAt: new Date() })
      .where('id', '=', providerId)
      .where('workspaceId', '=', workspaceId)
      .where('deletedAt', 'is', null)
      .execute();

    this.auditService.log({
      event: AuditEvent.SSO_PROVIDER_DELETED,
      resourceType: AuditResource.SSO_PROVIDER,
      resourceId: existing.id,
      changes: { before: this.toAuditSnapshot(existing) },
    });
  }

  private async findProviderById(providerId: string, workspaceId: string) {
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

  private prepareUpdate(input: UpdateSsoProviderInput) {
    const updateData: Record<string, unknown> = {};
    const mutableFields: (keyof UpdateSsoProviderInput)[] = [
      'name',
      'samlUrl',
      'samlCertificate',
      'oidcIssuer',
      'oidcClientId',
      'ldapUrl',
      'ldapBindDn',
      'ldapBaseDn',
      'ldapUserSearchFilter',
      'ldapUserAttributes',
      'ldapTlsEnabled',
      'ldapTlsCaCert',
      'allowSignup',
      'isEnabled',
      'groupSync',
    ];

    for (const field of mutableFields) {
      if (typeof input[field] !== 'undefined') {
        updateData[field] = input[field];
      }
    }

    if (typeof input.samlUrl !== 'undefined') {
      this.assertUrlHasNoCredentials(input.samlUrl, 'SAML URL');
    }
    if (typeof input.oidcIssuer !== 'undefined') {
      this.assertUrlHasNoCredentials(input.oidcIssuer, 'OIDC issuer');
    }
    if (typeof input.ldapUrl !== 'undefined') {
      this.assertUrlHasNoCredentials(input.ldapUrl, 'LDAP URL');
    }

    if (input.oidcClientSecret) {
      updateData.oidcClientSecret = this.secretService.encrypt(
        input.oidcClientSecret,
      );
    }
    if (input.ldapBindPassword) {
      updateData.ldapBindPassword = this.secretService.encrypt(
        input.ldapBindPassword,
      );
    }

    return updateData;
  }

  private async protectStoredSecrets(provider: AuthProvider) {
    const secretUpdates: Partial<AuthProvider> = {};

    if (
      provider.oidcClientSecret &&
      !this.secretService.isEncrypted(provider.oidcClientSecret)
    ) {
      secretUpdates.oidcClientSecret = this.secretService.encryptStored(
        provider.oidcClientSecret,
      );
    }
    if (
      provider.ldapBindPassword &&
      !this.secretService.isEncrypted(provider.ldapBindPassword)
    ) {
      secretUpdates.ldapBindPassword = this.secretService.encryptStored(
        provider.ldapBindPassword,
      );
    }

    if (Object.keys(secretUpdates).length === 0) {
      return provider;
    }

    await this.db
      .updateTable('authProviders')
      .set(secretUpdates)
      .where('id', '=', provider.id)
      .where('workspaceId', '=', provider.workspaceId)
      .where('deletedAt', 'is', null)
      .execute();

    return { ...provider, ...secretUpdates } as AuthProvider;
  }

  private toProviderView(provider: AuthProvider): SsoProviderView {
    const {
      oidcClientSecret,
      ldapBindPassword,
      ldapConfig: _ldapConfig,
      settings: _settings,
      ...safeProvider
    } = provider;
    return {
      ...safeProvider,
      hasOidcClientSecret: Boolean(oidcClientSecret),
      hasLdapBindPassword: Boolean(ldapBindPassword),
      loginAvailable: this.loginCapability.isLoginAvailable(provider.type),
    };
  }

  private toAuditSnapshot(provider: AuthProvider) {
    return {
      name: provider.name,
      type: provider.type,
      isEnabled: provider.isEnabled,
      allowSignup: provider.allowSignup,
      groupSync: provider.groupSync,
      hasOidcClientSecret: Boolean(provider.oidcClientSecret),
      hasLdapBindPassword: Boolean(provider.ldapBindPassword),
    };
  }

  private assertOwner(actor: User) {
    if (actor.role !== UserRole.OWNER) {
      throw new ForbiddenException();
    }
  }

  private assertUrlHasNoCredentials(value: string, label: string) {
    const url = new URL(value);
    if (url.username || url.password) {
      throw new BadRequestException(`${label} must not contain credentials`);
    }
  }
}
