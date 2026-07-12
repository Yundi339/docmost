import { UnauthorizedException } from '@nestjs/common';
import { hashPassword } from '../../../common/helpers';
import { AuditEvent } from '../../../common/events/audit-events';
import { AuthService } from './auth.service';

describe('AuthService password authentication', () => {
  let userRepo: { findByEmail: jest.Mock };
  let loginAttempt: {
    assertAllowed: jest.Mock;
    recordFailure: jest.Mock;
  };
  let auditService: { setActorId: jest.Mock; log: jest.Mock };
  let service: AuthService;

  beforeEach(() => {
    userRepo = { findByEmail: jest.fn() };
    loginAttempt = {
      assertAllowed: jest.fn(),
      recordFailure: jest.fn(),
    };
    auditService = { setActorId: jest.fn(), log: jest.fn() };
    service = new AuthService(
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      userRepo as any,
      {} as any,
      {} as any,
      {} as any,
      { isCloud: () => false, getAppSecret: () => 'test-secret' } as any,
      loginAttempt as any,
      {} as any,
      auditService as any,
    );
  });

  it('counts and audits a known active user password failure', async () => {
    userRepo.findByEmail.mockResolvedValue({
      id: 'user-id',
      workspaceId: 'workspace-id',
      password: await hashPassword('correct-password'),
      deactivatedAt: null,
      deletedAt: null,
    });

    await expect(
      service.authenticatePassword(
        { email: 'user@example.com', password: 'wrong-password' },
        'workspace-id',
      ),
    ).rejects.toBeInstanceOf(UnauthorizedException);

    expect(loginAttempt.assertAllowed).toHaveBeenCalledWith(
      'workspace-id',
      'user-id',
      'password',
    );
    expect(loginAttempt.recordFailure).toHaveBeenCalledWith(
      'workspace-id',
      'user-id',
      'password',
    );
    expect(auditService.log).toHaveBeenCalledWith({
      event: AuditEvent.USER_LOGIN_FAILED,
      resourceType: 'user',
      resourceId: 'user-id',
      metadata: { source: 'password', reason: 'invalid_credentials' },
    });
  });

  it('does not create arbitrary account counters or audit rows for an unknown email', async () => {
    userRepo.findByEmail.mockResolvedValue(undefined);

    await expect(
      service.authenticatePassword(
        { email: 'unknown@example.com', password: 'wrong-password' },
        'workspace-id',
      ),
    ).rejects.toBeInstanceOf(UnauthorizedException);

    expect(loginAttempt.recordFailure).not.toHaveBeenCalled();
    expect(auditService.log).not.toHaveBeenCalled();
  });

  it('returns the user after a valid password without creating the session itself', async () => {
    const user = {
      id: 'user-id',
      email: 'user@example.com',
      workspaceId: 'workspace-id',
      password: await hashPassword('correct-password'),
      emailVerifiedAt: null,
      deactivatedAt: null,
      deletedAt: null,
    };
    userRepo.findByEmail.mockResolvedValue(user);

    await expect(
      service.authenticatePassword(
        { email: user.email, password: 'correct-password' },
        user.workspaceId,
      ),
    ).resolves.toBe(user);
    expect(loginAttempt.recordFailure).not.toHaveBeenCalled();
    expect(auditService.log).not.toHaveBeenCalled();
  });
});
