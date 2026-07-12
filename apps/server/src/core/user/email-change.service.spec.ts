import { BadRequestException } from '@nestjs/common';
import { EmailChangeService } from './email-change.service';
import * as utils from '../../common/helpers/utils';

describe('EmailChangeService', () => {
  const workspace = {
    id: 'workspace-id',
    hostname: 'workspace',
    enforceSso: false,
  } as any;
  const authUser = { id: 'user-id' } as any;
  const user = {
    id: authUser.id,
    email: 'old@example.test',
    name: 'Test User',
    password: 'password-hash',
    deactivatedAt: null,
    deletedAt: null,
  };
  const ssoEnforcement = {
    assertLocalAuthAllowed: jest.fn(),
    lockWorkspace: jest.fn(),
  };
  const domainService = {
    getUrl: jest.fn().mockReturnValue('https://docs.example.test'),
  };
  const mailService = { sendToQueue: jest.fn() };
  const auditService = { log: jest.fn() };

  beforeEach(() => {
    jest.clearAllMocks();
    ssoEnforcement.assertLocalAuthAllowed.mockResolvedValue(undefined);
    ssoEnforcement.lockWorkspace.mockResolvedValue(undefined);
    mailService.sendToQueue.mockResolvedValue(undefined);
    jest.spyOn(utils, 'comparePasswordHash').mockResolvedValue(true);
  });

  afterEach(() => jest.restoreAllMocks());

  it('stores only a token hash and audits no token material', async () => {
    const inserted: Record<string, unknown>[] = [];
    const trx = requestTransaction(inserted);
    const db = requestDatabase(trx);
    const service = createService(db);

    await expect(
      service.request(
        { email: 'new@example.test', password: 'current-password' },
        authUser,
        workspace,
      ),
    ).resolves.toEqual({ expiresAt: expect.any(Date) });

    expect(inserted).toHaveLength(1);
    expect(inserted[0]).toMatchObject({
      userId: authUser.id,
      workspaceId: workspace.id,
      newEmail: 'new@example.test',
      tokenHash: expect.stringMatching(/^[a-f0-9]{64}$/),
      expiresAt: expect.any(Date),
    });
    expect(inserted[0]).not.toHaveProperty('token');
    expect(mailService.sendToQueue).toHaveBeenCalledWith(
      expect.objectContaining({ to: 'new@example.test' }),
    );
    expect(auditService.log).toHaveBeenCalledWith(
      expect.objectContaining({
        event: 'user.email_change_requested',
        resourceId: authUser.id,
      }),
    );
    expect(JSON.stringify(auditService.log.mock.calls)).not.toContain(
      'tokenHash',
    );
    expect(JSON.stringify(auditService.log.mock.calls)).not.toContain(
      'current-password',
    );
  });

  it('rejects enforced SSO before reading user or creating a request', async () => {
    const db = requestDatabase(requestTransaction([]));
    ssoEnforcement.assertLocalAuthAllowed.mockRejectedValue(
      new BadRequestException('This workspace has enforced SSO login.'),
    );

    await expect(
      createService(db).request(
        { email: 'new@example.test', password: 'current-password' },
        authUser,
        { ...workspace, enforceSso: true },
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(db.selectFrom).not.toHaveBeenCalled();
    expect(mailService.sendToQueue).not.toHaveBeenCalled();
  });

  it('serializes confirmations so a token can be consumed only once', async () => {
    const token = 'a'.repeat(43);
    const state = {
      request: {
        id: 'request-id',
        userId: authUser.id,
        workspaceId: workspace.id,
        newEmail: 'new@example.test',
        tokenHash: 'stored-hash',
        expiresAt: new Date(Date.now() + 60_000),
        usedAt: null as Date | null,
        createdAt: new Date(),
      },
    };
    const db = confirmDatabase(state);
    const service = createService(db);

    const results = await Promise.allSettled([
      service.confirm({ token }, authUser, workspace),
      service.confirm({ token }, authUser, workspace),
    ]);

    expect(
      results.filter((result) => result.status === 'fulfilled'),
    ).toHaveLength(1);
    expect(
      results.filter((result) => result.status === 'rejected'),
    ).toHaveLength(1);
    expect(
      results.find((result) => result.status === 'fulfilled'),
    ).toMatchObject({ value: { email: 'new@example.test' } });
    expect(auditService.log).toHaveBeenCalledTimes(1);
    expect(auditService.log).toHaveBeenCalledWith(
      expect.objectContaining({ event: 'user.email_changed' }),
    );
    expect(mailService.sendToQueue).toHaveBeenCalledTimes(1);
  });

  it('rechecks SSO enforcement while holding the workspace lock', async () => {
    const trx = {
      selectFrom: jest.fn(() => query({ id: workspace.id, enforceSso: true })),
    };
    const db = {
      transaction: jest.fn(() => ({
        execute: jest.fn((callback: (value: any) => unknown) => callback(trx)),
      })),
    };
    ssoEnforcement.assertLocalAuthAllowed.mockRejectedValue(
      new BadRequestException('This workspace has enforced SSO login.'),
    );

    await expect(
      createService(db).confirm({ token: 'a'.repeat(43) }, authUser, workspace),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(ssoEnforcement.lockWorkspace).toHaveBeenCalledWith(
      workspace.id,
      trx,
    );
    expect(trx.selectFrom).toHaveBeenCalledTimes(1);
    expect(auditService.log).not.toHaveBeenCalled();
  });

  function createService(db: any) {
    return new EmailChangeService(
      db,
      ssoEnforcement as any,
      domainService as any,
      mailService as any,
      auditService as any,
    );
  }

  function requestDatabase(trx: any) {
    let userSelectCount = 0;
    return {
      selectFrom: jest.fn((table: string) => {
        expect(table).toBe('users');
        userSelectCount += 1;
        return query(userSelectCount === 1 ? user : undefined);
      }),
      transaction: jest.fn(() => ({
        execute: jest.fn((callback: (value: any) => unknown) => callback(trx)),
      })),
      deleteFrom: jest.fn(() => query(undefined)),
    };
  }

  function requestTransaction(inserted: Record<string, unknown>[]) {
    const insertQuery = query({ id: 'request-id' });
    insertQuery.values.mockImplementation((value: Record<string, unknown>) => {
      inserted.push(value);
      return insertQuery;
    });
    return {
      deleteFrom: jest.fn(() => query(undefined)),
      insertInto: jest.fn(() => insertQuery),
    };
  }

  function confirmDatabase(state: {
    request: { usedAt: Date | null; [key: string]: unknown };
  }) {
    const trx = {
      selectFrom: jest.fn((table: string) => {
        if (table === 'workspaces') {
          return query({ id: workspace.id, enforceSso: false });
        }
        if (table === 'userEmailChangeRequests') {
          return query(state.request);
        }
        if (table === 'users') {
          const builder = query(undefined);
          let locked = false;
          builder.forUpdate.mockImplementation(() => {
            locked = true;
            return builder;
          });
          builder.executeTakeFirst.mockImplementation(() =>
            Promise.resolve(
              locked
                ? {
                    id: user.id,
                    email: user.email,
                    name: user.name,
                    deactivatedAt: null,
                    deletedAt: null,
                  }
                : undefined,
            ),
          );
          return builder;
        }
        throw new Error(`Unexpected table: ${table}`);
      }),
      updateTable: jest.fn((table: string) => {
        const builder = query({ numUpdatedRows: 1n });
        if (table === 'userEmailChangeRequests') {
          builder.executeTakeFirstOrThrow.mockImplementation(() => {
            state.request.usedAt = new Date();
            return Promise.resolve({ numUpdatedRows: 1n });
          });
        }
        return builder;
      }),
      deleteFrom: jest.fn(() => query(undefined)),
    };

    let queue = Promise.resolve();
    return {
      transaction: jest.fn(() => ({
        execute: jest.fn((callback: (value: any) => Promise<unknown>) => {
          const result = queue.then(() => callback(trx));
          queue = result.then(
            () => undefined,
            () => undefined,
          );
          return result;
        }),
      })),
    };
  }

  function query(result: unknown) {
    const builder: Record<string, jest.Mock> = {};
    for (const method of [
      'select',
      'selectAll',
      'where',
      'forUpdate',
      'set',
      'values',
      'onConflict',
      'returning',
    ]) {
      builder[method] = jest.fn(() => builder);
    }
    builder.execute = jest.fn().mockResolvedValue([]);
    builder.executeTakeFirst = jest.fn().mockResolvedValue(result);
    builder.executeTakeFirstOrThrow = jest.fn().mockResolvedValue(result);
    return builder;
  }
});
