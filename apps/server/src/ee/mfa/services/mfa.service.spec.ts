import { UnauthorizedException } from '@nestjs/common';
import { hashPassword } from '../../../common/helpers';
import { MfaSecretService } from './mfa-secret.service';
import { MfaService } from './mfa.service';

describe('MfaService security boundaries', () => {
  let db: any;
  let updateQuery: any;
  let userRepo: { findById: jest.Mock };
  let service: MfaService;
  let secretService: MfaSecretService;
  let loginAttempt: { assertAllowed: jest.Mock; recordFailure: jest.Mock };
  let auditService: { log: jest.Mock; setActorId: jest.Mock };
  let mfaTokenConsumptionService: { consume: jest.Mock };

  beforeEach(() => {
    updateQuery = fluentQuery();
    db = {
      updateTable: jest.fn().mockReturnValue(updateQuery),
    };
    userRepo = { findById: jest.fn() };
    loginAttempt = {
      assertAllowed: jest.fn(),
      recordFailure: jest.fn(),
    };
    auditService = { log: jest.fn(), setActorId: jest.fn() };
    mfaTokenConsumptionService = { consume: jest.fn() };
    secretService = new MfaSecretService({
      getAppSecret: () => 'test-app-secret',
    } as any);
    service = new MfaService(
      db,
      {} as any,
      loginAttempt as any,
      userRepo as any,
      secretService,
      mfaTokenConsumptionService as any,
      auditService as any,
    );
  });

  it('rejects MFA disable when the current password is wrong', async () => {
    userRepo.findById.mockResolvedValue({
      id: 'user-id',
      password: await hashPassword('correct-password'),
      hasGeneratedPassword: false,
    });

    await expect(
      service.disableMfa('user-id', 'workspace-id', 'wrong-password'),
    ).rejects.toBeInstanceOf(UnauthorizedException);
    expect(db.updateTable).not.toHaveBeenCalled();
    expect(loginAttempt.recordFailure).toHaveBeenCalledWith(
      'workspace-id',
      'user-id',
      'password',
    );
    expect(auditService.log).toHaveBeenCalledWith(
      expect.objectContaining({
        event: 'user.login_failed',
        metadata: { source: 'password', reason: 'step_up_failed' },
      }),
    );
  });

  it('allows MFA disable only after server-side password verification', async () => {
    userRepo.findById.mockResolvedValue({
      id: 'user-id',
      password: await hashPassword('correct-password'),
      hasGeneratedPassword: false,
    });

    await expect(
      service.disableMfa('user-id', 'workspace-id', 'correct-password'),
    ).resolves.toEqual({ success: true });
    expect(updateQuery.set).toHaveBeenCalledWith(
      expect.objectContaining({
        isEnabled: false,
        secret: null,
        backupCodes: null,
      }),
    );
    expect(auditService.log).toHaveBeenCalledWith(
      expect.objectContaining({ event: 'user.mfa_disabled' }),
    );
  });

  it('generates 128-bit backup codes suitable for hashing at rest', () => {
    const codes = (service as any).generateBackupCodes();

    expect(codes).toHaveLength(10);
    for (const code of codes) {
      const normalized = secretService.normalizeBackupCode(code);
      expect(normalized).toMatch(/^[a-f0-9]{32}$/);
      expect(Buffer.from(normalized, 'hex')).toHaveLength(16);
      expect(code).not.toEqual(normalized);
    }
  });
});

function fluentQuery() {
  const query: Record<string, jest.Mock> = {};
  for (const method of ['set', 'where']) {
    query[method] = jest.fn().mockReturnValue(query);
  }
  query.execute = jest.fn().mockResolvedValue(undefined);
  return query;
}
