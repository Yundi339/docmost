import { WsService } from './ws.service';

describe('WsService.emitTreeEvent', () => {
  function createService(options?: {
    hasRestrictions?: boolean;
    restrictedPage?: boolean;
    authorizedUserIds?: string[];
    cachedHasRestrictions?: boolean | null;
  }) {
    const pagePermissionRepo = {
      hasRestrictedPagesInSpace: jest
        .fn()
        .mockResolvedValue(options?.hasRestrictions ?? false),
      hasRestrictedAncestor: jest
        .fn()
        .mockResolvedValue(options?.restrictedPage ?? false),
      getUserIdsWithPageAccess: jest
        .fn()
        .mockResolvedValue(options?.authorizedUserIds ?? []),
    };
    const cacheManager = {
      get: jest.fn().mockResolvedValue(options?.cachedHasRestrictions ?? null),
      set: jest.fn().mockResolvedValue(undefined),
      del: jest.fn().mockResolvedValue(undefined),
    };
    const roomEmitter = { emit: jest.fn() };
    const sockets: any[] = [];
    const server = {
      to: jest.fn().mockReturnValue(roomEmitter),
      in: jest.fn().mockReturnValue({
        fetchSockets: jest.fn().mockImplementation(async () => sockets),
      }),
    };
    const spaceMemberRepo = {
      getUserIdsWithSpaceAccess: jest
        .fn()
        .mockImplementation(async (userIds: string[]) => new Set(userIds)),
    };
    const service = new WsService(
      pagePermissionRepo as any,
      cacheManager as any,
      {} as any,
      {} as any,
      {} as any,
      spaceMemberRepo as any,
      { subscribe: jest.fn().mockReturnValue(jest.fn()) } as any,
    );
    service.setServer(server as any);

    return {
      pagePermissionRepo,
      roomEmitter,
      server,
      service,
      sockets,
      spaceMemberRepo,
    };
  }

  const event = {
    operation: 'updateOne',
    spaceId: 'space-id',
    entity: ['pages'],
    id: 'page-id',
    payload: { title: 'Updated page' },
  };

  it('broadcasts updates to the whole space when the page is unrestricted', async () => {
    const { roomEmitter, server, service } = createService();

    await service.emitTreeEvent(event);

    expect(server.to).toHaveBeenCalledWith('space-space-id');
    expect(roomEmitter.emit).toHaveBeenCalledWith('message', event);
  });

  it('only sends restricted page updates to authorized users', async () => {
    const { pagePermissionRepo, roomEmitter, service, sockets } = createService(
      {
        hasRestrictions: true,
        restrictedPage: true,
        authorizedUserIds: ['allowed-user'],
      },
    );
    const allowedSocket = {
      data: { userId: 'allowed-user' },
      emit: jest.fn(),
    };
    const deniedSocket = {
      data: { userId: 'denied-user' },
      emit: jest.fn(),
    };
    sockets.push(allowedSocket, deniedSocket);

    await service.emitTreeEvent(event);

    expect(pagePermissionRepo.getUserIdsWithPageAccess).toHaveBeenCalledWith(
      'page-id',
      ['allowed-user', 'denied-user'],
    );
    expect(allowedSocket.emit).toHaveBeenCalledWith('message', event);
    expect(deniedSocket.emit).not.toHaveBeenCalled();
    expect(roomEmitter.emit).not.toHaveBeenCalled();
  });

  it('does not trust a cached false restriction result', async () => {
    const { pagePermissionRepo, service, sockets } = createService({
      cachedHasRestrictions: false,
      hasRestrictions: true,
      restrictedPage: true,
      authorizedUserIds: [],
    });
    const deniedSocket = {
      data: { userId: 'denied-user' },
      emit: jest.fn(),
    };
    sockets.push(deniedSocket);

    await service.emitTreeEvent(event);

    expect(pagePermissionRepo.hasRestrictedPagesInSpace).toHaveBeenCalledWith(
      'space-id',
    );
    expect(deniedSocket.emit).not.toHaveBeenCalled();
  });

  it('permission-filters generic page-scoped events', async () => {
    const { pagePermissionRepo, service, sockets } = createService({
      hasRestrictions: true,
      restrictedPage: true,
      authorizedUserIds: ['allowed-user'],
    });
    const allowedSocket = {
      data: { userId: 'allowed-user' },
      emit: jest.fn(),
    };
    const deniedSocket = {
      data: { userId: 'denied-user' },
      emit: jest.fn(),
    };
    sockets.push(allowedSocket, deniedSocket);
    const invalidateEvent = {
      operation: 'invalidate',
      spaceId: 'space-id',
      entity: ['database-records'],
      id: 'database-id',
    };

    await service.emitPageEvent('space-id', 'page-id', invalidateEvent);

    expect(pagePermissionRepo.hasRestrictedAncestor).toHaveBeenCalledWith(
      'page-id',
    );
    expect(allowedSocket.emit).toHaveBeenCalledWith('message', invalidateEvent);
    expect(deniedSocket.emit).not.toHaveBeenCalled();
  });

  it('does not trust stale room membership for client tree refreshes', async () => {
    const { pagePermissionRepo, service, spaceMemberRepo } = createService();
    spaceMemberRepo.getUserIdsWithSpaceAccess.mockResolvedValue(new Set());
    const client = {
      data: { userId: 'removed-user' },
      rooms: new Set(['space-space-id']),
      leave: jest.fn().mockResolvedValue(undefined),
      broadcast: { to: jest.fn() },
    };

    await service.handleClientTreeRefresh(client as any, 'space-id');

    expect(spaceMemberRepo.getUserIdsWithSpaceAccess).toHaveBeenCalledWith(
      ['removed-user'],
      'space-id',
    );
    expect(client.leave).toHaveBeenCalledWith('space-space-id');
    expect(pagePermissionRepo.hasRestrictedPagesInSpace).not.toHaveBeenCalled();
  });

  it('accepts only the non-authoritative client tree refresh event', () => {
    const { service } = createService();

    expect(
      service.isClientTreeRefreshEvent({
        operation: 'refetchRootTreeNodeEvent',
        spaceId: 'space-id',
      }),
    ).toBe(true);
    expect(service.isClientTreeRefreshEvent(event)).toBe(false);
    expect(
      service.isClientTreeRefreshEvent({
        operation: 'deleteTreeNode',
        spaceId: 'space-id',
        payload: { node: { id: 'page-id' } },
      }),
    ).toBe(false);
  });
});

describe('WsService connection authentication', () => {
  function createAuthService(overrides: Record<string, any> = {}) {
    const userRepo = {
      findById: jest.fn().mockResolvedValue({
        id: 'user-id',
        workspaceId: 'workspace-id',
        deactivatedAt: null,
        deletedAt: null,
      }),
      ...overrides.userRepo,
    };
    const sessionRepo = {
      findActiveById: jest.fn().mockResolvedValue({
        id: 'session-id',
        userId: 'user-id',
        workspaceId: 'workspace-id',
      }),
      ...overrides.sessionRepo,
    };
    const workspaceRepo = {
      findActiveById: jest.fn().mockResolvedValue({ id: 'workspace-id' }),
      ...overrides.workspaceRepo,
    };
    const spaceMemberRepo = {
      getUserSpaceIds: jest.fn().mockResolvedValue(['space-id']),
    };
    const service = new WsService(
      {} as any,
      {} as any,
      userRepo as any,
      sessionRepo as any,
      workspaceRepo as any,
      spaceMemberRepo as any,
      { subscribe: jest.fn().mockReturnValue(jest.fn()) } as any,
    );
    return { service, spaceMemberRepo };
  }

  it('requires a current session for a new connection', async () => {
    const { service } = createAuthService();

    await expect(
      service.authenticateConnection({
        sub: 'user-id',
        email: 'user@example.test',
        workspaceId: 'workspace-id',
        type: 'access',
      } as any),
    ).rejects.toThrow('Session is required');
  });

  it('rejects a revoked session', async () => {
    const { service } = createAuthService({
      sessionRepo: { findActiveById: jest.fn().mockResolvedValue(undefined) },
    });

    await expect(
      service.authenticateConnection({
        sub: 'user-id',
        email: 'user@example.test',
        workspaceId: 'workspace-id',
        sessionId: 'session-id',
        type: 'access',
      }),
    ).rejects.toThrow('Unauthorized');
  });

  it('reconciles stale space rooms during connection revalidation', async () => {
    const { service, spaceMemberRepo } = createAuthService();
    spaceMemberRepo.getUserSpaceIds.mockResolvedValue(['current-space-id']);
    const rooms = new Set(['socket-id', 'space-stale-space-id']);
    const socket = {
      data: {
        userId: 'user-id',
        workspaceId: 'workspace-id',
        sessionId: 'session-id',
      },
      rooms,
      disconnect: jest.fn(),
      leave: jest.fn(async (room: string) => rooms.delete(room)),
      join: jest.fn(async (room: string | string[]) => {
        for (const roomId of Array.isArray(room) ? room : [room]) {
          rooms.add(roomId);
        }
      }),
    };

    await expect(service.revalidateSocket(socket)).resolves.toBe(true);

    expect(socket.leave).toHaveBeenCalledWith('space-stale-space-id');
    expect(socket.join).toHaveBeenCalledWith('space-current-space-id');
    expect(rooms.has('space-stale-space-id')).toBe(false);
    expect(rooms.has('space-current-space-id')).toBe(true);
  });
});
