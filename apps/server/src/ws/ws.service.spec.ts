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
    const service = new WsService(
      pagePermissionRepo as any,
      cacheManager as any,
    );
    service.setServer(server as any);

    return { pagePermissionRepo, roomEmitter, server, service, sockets };
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
});
