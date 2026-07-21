import { AuthenticationExtension } from './authentication.extension';
import { JwtType } from '../../core/auth/dto/jwt-payload';
import { SpaceRole } from '../../common/helpers/types/permission';

describe('AuthenticationExtension', () => {
  it('keeps a space reader readonly even when restricted page permission allows edit', async () => {
    const extension = new AuthenticationExtension(
      {
        verifyJwt: jest.fn().mockResolvedValue({
          sub: 'user-id',
          workspaceId: 'workspace-id',
          sessionId: 'session-id',
          type: JwtType.COLLAB,
        }),
      } as any,
      {
        findById: jest.fn().mockResolvedValue({ id: 'user-id' }),
      } as any,
      {
        findById: jest.fn().mockResolvedValue({
          id: 'page-id',
          spaceId: 'space-id',
          workspaceId: 'workspace-id',
          deletedAt: null,
        }),
      } as any,
      {
        getUserSpaceRoles: jest
          .fn()
          .mockResolvedValue([{ role: SpaceRole.READER }]),
      } as any,
      {
        canUserEditPage: jest.fn().mockResolvedValue({
          hasAnyRestriction: true,
          canAccess: true,
          canEdit: true,
        }),
      } as any,
      {
        findActiveById: jest.fn().mockResolvedValue({
          id: 'session-id',
          userId: 'user-id',
          workspaceId: 'workspace-id',
        }),
      } as any,
      {
        findActiveById: jest.fn().mockResolvedValue({ id: 'workspace-id' }),
      } as any,
      { subscribe: jest.fn().mockReturnValue(jest.fn()) } as any,
    );
    const data = {
      documentName: 'page.page-id',
      token: 'collab-token',
      connectionConfig: {},
    } as any;

    await expect(extension.onAuthenticate(data)).resolves.toEqual({
      authenticatedCollab: true,
      user: { id: 'user-id' },
      userId: 'user-id',
      workspaceId: 'workspace-id',
      sessionId: 'session-id',
      pageId: 'page-id',
      spaceId: 'space-id',
    });
    expect(data.connectionConfig.readOnly).toBe(true);
  });

  it('rejects a revoked collab session before loading page permissions', async () => {
    const pageRepo = { findById: jest.fn() };
    const extension = new AuthenticationExtension(
      {
        verifyJwt: jest.fn().mockResolvedValue({
          sub: 'user-id',
          workspaceId: 'workspace-id',
          sessionId: 'session-id',
          type: JwtType.COLLAB,
        }),
      } as any,
      {
        findById: jest.fn().mockResolvedValue({
          id: 'user-id',
          deactivatedAt: null,
          deletedAt: null,
        }),
      } as any,
      pageRepo as any,
      {} as any,
      {} as any,
      { findActiveById: jest.fn().mockResolvedValue(undefined) } as any,
      {
        findActiveById: jest.fn().mockResolvedValue({ id: 'workspace-id' }),
      } as any,
      { subscribe: jest.fn().mockReturnValue(jest.fn()) } as any,
    );

    await expect(
      extension.onAuthenticate({
        documentName: 'page.page-id',
        token: 'collab-token',
        connectionConfig: {},
      } as any),
    ).rejects.toThrow();
    expect(pageRepo.findById).not.toHaveBeenCalled();
  });

  it('immediately closes tracked connections on a matching security event', async () => {
    let securityListener: (event: any) => Promise<void>;
    const extension = new AuthenticationExtension(
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {
        subscribe: jest.fn((listener) => {
          securityListener = listener;
          return jest.fn();
        }),
      } as any,
    );
    const connection = { close: jest.fn(), readOnly: false };
    const context = {
      authenticatedCollab: true,
      user: { id: 'user-id' },
      userId: 'user-id',
      workspaceId: 'workspace-id',
      sessionId: 'session-id',
      pageId: 'page-id',
      spaceId: 'space-id',
    };
    await extension.connected({
      socketId: 'socket-id',
      documentName: 'page.page-id',
      context,
      connection,
    } as any);

    await securityListener({
      eventId: 'event-id',
      occurredAt: new Date().toISOString(),
      type: 'page.permission-changed',
      pageId: 'ancestor-page-id',
      spaceId: 'space-id',
    });

    expect(connection.close).toHaveBeenCalledWith({
      code: 4403,
      reason: 'Permission revoked',
    });
  });

  it('uses the per-connection validation window for repeated messages', async () => {
    const extension = new AuthenticationExtension(
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      { subscribe: jest.fn().mockReturnValue(jest.fn()) } as any,
    );
    const connection = { close: jest.fn(), readOnly: false };
    const context = {
      authenticatedCollab: true,
      user: { id: 'user-id' },
      userId: 'user-id',
      workspaceId: 'workspace-id',
      sessionId: 'session-id',
      pageId: 'page-id',
      spaceId: 'space-id',
    };
    const validateContext = jest.spyOn(extension as any, 'validateContext');
    await extension.connected({
      socketId: 'socket-id',
      documentName: 'page.page-id',
      context,
      connection,
    } as any);

    await extension.beforeHandleMessage({
      socketId: 'socket-id',
      documentName: 'page.page-id',
      context,
      connection,
    } as any);
    await extension.beforeHandleMessage({
      socketId: 'socket-id',
      documentName: 'page.page-id',
      context,
      connection,
    } as any);

    expect(validateContext).not.toHaveBeenCalled();
  });

  it('periodically closes a connection whose persisted access was revoked', async () => {
    const extension = new AuthenticationExtension(
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      { subscribe: jest.fn().mockReturnValue(jest.fn()) } as any,
    );
    const connection = { close: jest.fn(), readOnly: false };
    const context = {
      authenticatedCollab: true,
      user: { id: 'user-id' },
      userId: 'user-id',
      workspaceId: 'workspace-id',
      sessionId: 'session-id',
      pageId: 'page-id',
      spaceId: 'space-id',
    };
    jest
      .spyOn(extension as any, 'validateContext')
      .mockRejectedValue(new Error('revoked'));
    await extension.connected({
      socketId: 'socket-id',
      documentName: 'page.page-id',
      context,
      connection,
    } as any);

    await extension.revalidateConnections();

    expect(connection.close).toHaveBeenCalledWith({
      code: 4403,
      reason: 'Permission revoked',
    });
  });
});
