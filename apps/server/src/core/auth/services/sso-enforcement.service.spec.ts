import { BadRequestException } from '@nestjs/common';
import { SsoEnforcementService } from './sso-enforcement.service';
import { SsoLoginCapabilityService } from './sso-login-capability.service';
import { UserRole } from '../../../common/helpers/types/permission';

describe('SsoEnforcementService', () => {
  let capability: SsoLoginCapabilityService;

  beforeEach(() => {
    capability = new SsoLoginCapabilityService();
  });

  it('treats a legacy enforced workspace as recoverable when no login handler exists', async () => {
    const db = { selectFrom: jest.fn() } as any;
    const service = new SsoEnforcementService(db, capability);

    await expect(
      service.isEnforced({ id: 'workspace-id', enforceSso: true }),
    ).resolves.toBe(false);
    await expect(
      service.assertLocalAuthAllowed({
        id: 'workspace-id',
        enforceSso: true,
      }),
    ).resolves.toBeUndefined();
    expect(db.selectFrom).not.toHaveBeenCalled();
  });

  it('enforces SSO only when an enabled provider has a registered handler', async () => {
    capability.register({ providerType: 'oidc', handler: 'OidcController' });
    const providerQuery = fluentQuery();
    providerQuery.executeTakeFirst.mockResolvedValue({ id: 'provider-id' });
    const service = new SsoEnforcementService(
      { selectFrom: jest.fn().mockReturnValue(providerQuery) } as any,
      capability,
    );

    await expect(
      service.isEnforced({ id: 'workspace-id', enforceSso: true }),
    ).resolves.toBe(true);
    await expect(
      service.assertLocalAuthAllowed({
        id: 'workspace-id',
        enforceSso: true,
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('allows only an explicitly requested owner recovery login', async () => {
    capability.register({ providerType: 'oidc', handler: 'OidcController' });
    const providerQuery = fluentQuery();
    providerQuery.executeTakeFirst.mockResolvedValue({ id: 'provider-id' });
    const db = { selectFrom: jest.fn().mockReturnValue(providerQuery) } as any;
    const service = new SsoEnforcementService(db, capability);
    const workspace = { id: 'workspace-id', enforceSso: true } as any;

    await expect(
      service.assertPrimaryAuthAllowed(
        workspace,
        { role: UserRole.OWNER },
        true,
      ),
    ).resolves.toBe(true);
    await expect(
      service.assertPrimaryAuthAllowed(
        workspace,
        { role: UserRole.OWNER },
        false,
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      service.assertPrimaryAuthAllowed(
        workspace,
        { role: UserRole.ADMIN },
        true,
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('refuses enforcement without an enabled provider backed by a handler', async () => {
    const service = new SsoEnforcementService({} as any, capability);

    await expect(
      service.assertCanEnforce('workspace-id'),
    ).rejects.toMatchObject({
      response: expect.objectContaining({ code: 'SSO_PROVIDER_REQUIRED' }),
    });
  });

  it('requires a local owner credential before enforcement can be enabled', async () => {
    capability.register({ providerType: 'oidc', handler: 'OidcController' });
    const providerQuery = fluentQuery();
    providerQuery.executeTakeFirst.mockResolvedValue({ id: 'provider-id' });
    const ownerQuery = fluentQuery();
    ownerQuery.executeTakeFirst.mockResolvedValue(undefined);
    const db = {
      selectFrom: jest
        .fn()
        .mockReturnValueOnce(providerQuery)
        .mockReturnValueOnce(ownerQuery),
    } as any;
    const service = new SsoEnforcementService(db, capability);

    await expect(
      service.assertCanEnforce('workspace-id'),
    ).rejects.toMatchObject({
      response: expect.objectContaining({
        code: 'SSO_OWNER_RECOVERY_UNAVAILABLE',
      }),
    });
    expect(ownerQuery.where).toHaveBeenCalledWith('password', 'is not', null);
  });

  it('prevents removal of the last available provider while enforcement is configured', async () => {
    capability.register({ providerType: 'oidc', handler: 'OidcController' });
    const workspaceQuery = fluentQuery();
    workspaceQuery.executeTakeFirst.mockResolvedValue({ enforceSso: true });
    const providerQuery = fluentQuery();
    providerQuery.executeTakeFirst.mockResolvedValue(undefined);
    const db = {
      selectFrom: jest
        .fn()
        .mockReturnValueOnce(workspaceQuery)
        .mockReturnValueOnce(providerQuery),
    } as any;
    const service = new SsoEnforcementService(db, capability);

    await expect(
      service.assertCanDeactivateProvider('workspace-id', 'provider-id'),
    ).rejects.toMatchObject({
      response: expect.objectContaining({ code: 'SSO_PROVIDER_REQUIRED' }),
    });
    expect(providerQuery.where).toHaveBeenCalledWith('id', '!=', 'provider-id');
  });
});

function fluentQuery() {
  const query: Record<string, jest.Mock> = {};
  for (const method of ['select', 'where', 'forUpdate']) {
    query[method] = jest.fn().mockReturnValue(query);
  }
  query.executeTakeFirst = jest.fn().mockResolvedValue(undefined);
  return query;
}
