import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { UserRole } from '../../common/helpers/types/permission';
import { AuditEvent } from '../../common/events/audit-events';
import { SsoSecretService } from './sso-secret.service';
import { SsoService } from './sso.service';

describe('SsoService', () => {
  let db: any;
  let selectQuery: any;
  let updateQuery: any;
  let insertQuery: any;
  let auditService: { log: jest.Mock };
  let secretService: SsoSecretService;
  let service: SsoService;

  const owner = { id: 'owner-id', role: UserRole.OWNER } as any;
  const admin = { id: 'admin-id', role: UserRole.ADMIN } as any;
  const provider = (overrides: Record<string, unknown> = {}) =>
    ({
      id: '01900000-0000-7000-8000-000000000001',
      workspaceId: 'workspace-id',
      creatorId: owner.id,
      name: 'OIDC',
      type: 'oidc',
      samlUrl: null,
      samlCertificate: null,
      oidcIssuer: 'https://id.example.com',
      oidcClientId: 'client-id',
      oidcClientSecret: null,
      ldapUrl: null,
      ldapBindDn: null,
      ldapBindPassword: null,
      ldapBaseDn: null,
      ldapUserSearchFilter: null,
      ldapUserAttributes: null,
      ldapTlsEnabled: false,
      ldapTlsCaCert: null,
      ldapConfig: null,
      settings: null,
      allowSignup: false,
      isEnabled: false,
      groupSync: false,
      createdAt: new Date(),
      updatedAt: new Date(),
      deletedAt: null,
      ...overrides,
    }) as any;

  beforeEach(() => {
    selectQuery = fluentQuery();
    updateQuery = fluentQuery();
    insertQuery = fluentQuery();
    db = {
      selectFrom: jest.fn().mockReturnValue(selectQuery),
      updateTable: jest.fn().mockReturnValue(updateQuery),
      insertInto: jest.fn().mockReturnValue(insertQuery),
    };
    auditService = { log: jest.fn() };
    secretService = new SsoSecretService({
      getAppSecret: () => 'test-app-secret',
    } as any);
    service = new SsoService(db, secretService, auditService as any);
  });

  it('rejects non-owners from every management operation before database access', async () => {
    const operations = [
      () => service.getProviders('workspace-id', admin),
      () => service.getProviderById(provider().id, 'workspace-id', admin),
      () =>
        service.createProvider(
          { name: 'OIDC', type: 'oidc' as any },
          'workspace-id',
          admin,
        ),
      () =>
        service.updateProvider(
          provider().id,
          'workspace-id',
          { name: 'Changed' },
          admin,
        ),
      () => service.deleteProvider(provider().id, 'workspace-id', admin),
    ];

    for (const operation of operations) {
      await expect(operation()).rejects.toBeInstanceOf(ForbiddenException);
    }

    expect(db.selectFrom).not.toHaveBeenCalled();
    expect(db.insertInto).not.toHaveBeenCalled();
    expect(db.updateTable).not.toHaveBeenCalled();
  });

  it('never returns secrets and lazily encrypts legacy plaintext values', async () => {
    selectQuery.execute.mockResolvedValue([
      provider({
        oidcClientSecret: 'legacy-oidc-secret',
        ldapBindPassword: 'legacy-ldap-secret',
        settings: { privateValue: 'do-not-return' },
        ldapConfig: { password: 'do-not-return' },
      }),
    ]);

    const result = await service.getProviders('workspace-id', owner);

    expect(result.items[0]).toMatchObject({
      hasOidcClientSecret: true,
      hasLdapBindPassword: true,
    });
    expect(result.items[0]).not.toHaveProperty('oidcClientSecret');
    expect(result.items[0]).not.toHaveProperty('ldapBindPassword');
    expect(result.items[0]).not.toHaveProperty('settings');
    expect(result.items[0]).not.toHaveProperty('ldapConfig');

    const stored = updateQuery.set.mock.calls[0][0];
    expect(secretService.decryptStored(stored.oidcClientSecret)).toBe(
      'legacy-oidc-secret',
    );
    expect(secretService.decryptStored(stored.ldapBindPassword)).toBe(
      'legacy-ldap-secret',
    );
  });

  it('encrypts replacement secrets and excludes them from audit logs', async () => {
    const existing = provider();
    selectQuery.executeTakeFirst.mockResolvedValue(existing);
    updateQuery.executeTakeFirstOrThrow.mockImplementation(() => {
      return Promise.resolve({
        ...existing,
        ...updateQuery.set.mock.calls[0][0],
      });
    });

    const result = await service.updateProvider(
      existing.id,
      existing.workspaceId,
      { oidcClientSecret: 'new-secret', isEnabled: true },
      owner,
    );

    const stored = updateQuery.set.mock.calls[0][0];
    expect(secretService.decryptStored(stored.oidcClientSecret)).toBe(
      'new-secret',
    );
    expect(result).not.toHaveProperty('oidcClientSecret');
    expect(JSON.stringify(auditService.log.mock.calls)).not.toContain(
      'new-secret',
    );
    expect(auditService.log).toHaveBeenCalledWith(
      expect.objectContaining({ event: AuditEvent.SSO_PROVIDER_UPDATED }),
    );
  });

  it('rejects credentials embedded in provider URLs', async () => {
    const existing = provider();
    selectQuery.executeTakeFirst.mockResolvedValue(existing);

    await expect(
      service.updateProvider(
        existing.id,
        existing.workspaceId,
        { oidcIssuer: 'https://user:password@id.example.com' },
        owner,
      ),
    ).rejects.toBeInstanceOf(BadRequestException);

    expect(db.updateTable).not.toHaveBeenCalled();
  });
});

function fluentQuery() {
  const query: Record<string, jest.Mock> = {};
  for (const method of [
    'selectAll',
    'where',
    'orderBy',
    'values',
    'returningAll',
    'set',
  ]) {
    query[method] = jest.fn().mockReturnValue(query);
  }
  query.execute = jest.fn().mockResolvedValue(undefined);
  query.executeTakeFirst = jest.fn().mockResolvedValue(undefined);
  query.executeTakeFirstOrThrow = jest.fn().mockResolvedValue(undefined);
  return query;
}
