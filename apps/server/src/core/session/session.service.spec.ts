import { ForbiddenException } from '@nestjs/common';
import { SessionService } from './session.service';

describe('SessionService', () => {
  function createService(lockedUser: any) {
    const query: any = {
      selectAll: jest.fn(() => query),
      where: jest.fn(() => query),
      forUpdate: jest.fn(() => query),
      executeTakeFirst: jest.fn().mockResolvedValue(lockedUser),
    };
    const trx = { selectFrom: jest.fn(() => query) };
    const db = {
      transaction: jest.fn(() => ({
        execute: (callback: (trx: any) => Promise<any>) => callback(trx),
      })),
    };
    const sessionRepo = {
      insertSession: jest.fn().mockResolvedValue({ id: 'session-id' }),
      revokeById: jest.fn().mockResolvedValue(undefined),
      revokeAllExceptCurrent: jest.fn().mockResolvedValue(undefined),
    };
    const tokenService = {
      generateAccessToken: jest.fn().mockResolvedValue('access-token'),
    };
    const securityEvents = { publish: jest.fn().mockResolvedValue(undefined) };
    const service = new SessionService(
      tokenService as any,
      sessionRepo as any,
      { getCookieExpiresIn: () => new Date('2027-01-01') } as any,
      { get: jest.fn() } as any,
      db as any,
      securityEvents as any,
    );

    return { query, service, sessionRepo, securityEvents, trx };
  }

  it('locks and rechecks the user before inserting a session', async () => {
    const lockedUser = {
      id: 'user-id',
      workspaceId: 'workspace-id',
      email: 'user@example.test',
      deactivatedAt: null,
      deletedAt: null,
      updatedAt: new Date('2026-01-01'),
    };
    const { query, service, sessionRepo, trx } = createService(lockedUser);

    await expect(
      service.createSessionAndToken(lockedUser as any),
    ).resolves.toBe('access-token');

    expect(trx.selectFrom).toHaveBeenCalledWith('users');
    expect(query.forUpdate).toHaveBeenCalledTimes(1);
    expect(sessionRepo.insertSession).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: 'user-id',
        workspaceId: 'workspace-id',
      }),
      trx,
    );
  });

  it('does not create a late session after the locked user becomes inactive', async () => {
    const staleUser = {
      id: 'user-id',
      workspaceId: 'workspace-id',
      deactivatedAt: null,
      deletedAt: null,
    };
    const { service, sessionRepo } = createService({
      ...staleUser,
      deactivatedAt: new Date(),
    });

    await expect(
      service.createSessionAndToken(staleUser as any),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(sessionRepo.insertSession).not.toHaveBeenCalled();
  });

  it('allows session creation after a benign user update', async () => {
    const staleUser = {
      id: 'user-id',
      workspaceId: 'workspace-id',
      deactivatedAt: null,
      deletedAt: null,
      updatedAt: new Date('2026-01-01'),
    };
    const { service, sessionRepo } = createService({
      ...staleUser,
      updatedAt: new Date('2026-01-02'),
    });

    await expect(service.createSessionAndToken(staleUser as any)).resolves.toBe(
      'access-token',
    );
    expect(sessionRepo.insertSession).toHaveBeenCalledTimes(1);
  });

  it('publishes a session revalidation event after revocation', async () => {
    const { service, securityEvents } = createService(null);

    await service.revokeSession('session-id', 'user-id', 'workspace-id');

    expect(securityEvents.publish).toHaveBeenCalledWith({
      type: 'session.access-changed',
      userId: 'user-id',
      workspaceId: 'workspace-id',
      sessionIds: ['session-id'],
    });
  });

  it('targets every session except the current one when revoking others', async () => {
    const { service, securityEvents } = createService(null);

    await service.revokeAllOtherSessions(
      'current-session-id',
      'user-id',
      'workspace-id',
    );

    expect(securityEvents.publish).toHaveBeenCalledWith({
      type: 'session.access-changed',
      userId: 'user-id',
      workspaceId: 'workspace-id',
      excludeSessionId: 'current-session-id',
    });
  });
});
