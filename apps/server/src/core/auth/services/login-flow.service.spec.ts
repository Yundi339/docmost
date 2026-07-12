import { LoginFlowService } from './login-flow.service';

describe('LoginFlowService SSO recovery', () => {
  const user = {
    id: 'owner-id',
    role: 'owner',
    email: 'owner@example.com',
    emailVerifiedAt: new Date(),
    deactivatedAt: null,
    deletedAt: null,
  } as any;
  const workspace = {
    id: 'workspace-id',
    enforceSso: true,
    enforceMfa: false,
  } as any;

  function createService(ownerRecoveryUsed: boolean) {
    const mfaQuery = fluentQuery();
    mfaQuery.executeTakeFirst.mockResolvedValue(undefined);
    const auditService = { setActorId: jest.fn(), log: jest.fn() };
    const ssoEnforcement = {
      assertPrimaryAuthAllowed: jest.fn().mockResolvedValue(ownerRecoveryUsed),
    };
    const sessionService = {
      createSessionAndToken: jest.fn().mockResolvedValue('auth-token'),
    };
    const service = new LoginFlowService(
      { selectFrom: jest.fn().mockReturnValue(mfaQuery) } as any,
      {} as any,
      sessionService as any,
      { updateLastLogin: jest.fn() } as any,
      {
        isCloud: () => false,
        getAppSecret: () => 'secret',
      } as any,
      { clearForUser: jest.fn() } as any,
      auditService as any,
      ssoEnforcement as any,
    );
    return { service, auditService, ssoEnforcement };
  }

  it('records owner recovery only after the server validates the bypass', async () => {
    const { service, auditService, ssoEnforcement } = createService(true);

    await expect(
      service.begin(user, workspace, {
        primaryAuth: 'password',
        ownerRecovery: true,
      }),
    ).resolves.toEqual({ authToken: 'auth-token' });

    expect(ssoEnforcement.assertPrimaryAuthAllowed).toHaveBeenCalledTimes(1);
    expect(auditService.log).toHaveBeenCalledWith(
      expect.objectContaining({
        metadata: expect.objectContaining({ ownerRecovery: true }),
      }),
    );
  });

  it('drops a forged recovery marker when enforcement is not bypassed', async () => {
    const { service, auditService } = createService(false);

    await service.begin(user, workspace, {
      primaryAuth: 'password',
      ownerRecovery: true,
    });

    expect(auditService.log.mock.calls[0][0].metadata).not.toHaveProperty(
      'ownerRecovery',
    );
  });
});

function fluentQuery() {
  const query: Record<string, jest.Mock> = {};
  for (const method of ['select', 'where']) {
    query[method] = jest.fn().mockReturnValue(query);
  }
  query.executeTakeFirst = jest.fn();
  return query;
}
