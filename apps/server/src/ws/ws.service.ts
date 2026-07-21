import { Inject, Injectable, OnModuleDestroy } from '@nestjs/common';
import { Interval } from '@nestjs/schedule';
import { CACHE_MANAGER } from '@nestjs/cache-manager';
import { Cache } from 'cache-manager';
import { Server, Socket } from 'socket.io';
import { PagePermissionRepo } from '@docmost/db/repos/page/page-permission.repo';
import {
  TREE_EVENTS,
  WS_SPACE_RESTRICTION_CACHE_PREFIX,
  WS_CACHE_TTL_MS,
  getSpaceRoomName,
  getUserRoomName,
} from './ws.utils';
import { UserRepo } from '@docmost/db/repos/user/user.repo';
import { UserSessionRepo } from '@docmost/db/repos/session/user-session.repo';
import { WorkspaceRepo } from '@docmost/db/repos/workspace/workspace.repo';
import { SpaceMemberRepo } from '@docmost/db/repos/space/space-member.repo';
import { JwtPayload } from '../core/auth/dto/jwt-payload';
import { isUserDisabled } from '../common/helpers';
import {
  SecurityEvent,
  SecurityEventService,
} from '../common/events/security-event.service';

@Injectable()
export class WsService implements OnModuleDestroy {
  private server: Server;
  private readonly unsubscribeSecurityEvents: () => void;
  private revalidationInProgress = false;

  constructor(
    private readonly pagePermissionRepo: PagePermissionRepo,
    @Inject(CACHE_MANAGER) private readonly cacheManager: Cache,
    private readonly userRepo: UserRepo,
    private readonly userSessionRepo: UserSessionRepo,
    private readonly workspaceRepo: WorkspaceRepo,
    private readonly spaceMemberRepo: SpaceMemberRepo,
    private readonly securityEvents: SecurityEventService,
  ) {
    this.unsubscribeSecurityEvents = this.securityEvents.subscribe((event) =>
      this.handleSecurityEvent(event),
    );
  }

  onModuleDestroy(): void {
    this.unsubscribeSecurityEvents();
  }

  setServer(server: Server): void {
    this.server = server;
  }

  async authenticateConnection(payload: JwtPayload): Promise<{
    userId: string;
    workspaceId: string;
    sessionId: string;
    spaceIds: string[];
  }> {
    if (!payload.sessionId) throw new Error('Session is required');

    const [workspace, user, session] = await Promise.all([
      this.workspaceRepo.findActiveById(payload.workspaceId),
      this.userRepo.findById(payload.sub, payload.workspaceId),
      this.userSessionRepo.findActiveById(payload.sessionId),
    ]);

    if (
      !workspace ||
      !user ||
      isUserDisabled(user) ||
      !session ||
      session.userId !== payload.sub ||
      session.workspaceId !== payload.workspaceId
    ) {
      throw new Error('Unauthorized');
    }

    return {
      userId: payload.sub,
      workspaceId: payload.workspaceId,
      sessionId: payload.sessionId,
      spaceIds: await this.spaceMemberRepo.getUserSpaceIds(payload.sub),
    };
  }

  async revalidateSocket(socket: {
    data: Record<string, any>;
    disconnect: (close?: boolean) => unknown;
    rooms?: Set<string>;
    join?: (room: string | string[]) => Promise<unknown> | unknown;
    leave?: (room: string) => Promise<unknown> | unknown;
  }): Promise<boolean> {
    const { userId, workspaceId, sessionId } = socket.data;
    if (!userId || !workspaceId || !sessionId) {
      socket.disconnect(true);
      return false;
    }

    const [workspace, user, session] = await Promise.all([
      this.workspaceRepo.findActiveById(workspaceId),
      this.userRepo.findById(userId, workspaceId),
      this.userSessionRepo.findActiveById(sessionId),
    ]);
    const active = Boolean(
      workspace &&
      user &&
      !isUserDisabled(user) &&
      session &&
      session.userId === userId &&
      session.workspaceId === workspaceId,
    );

    if (!active) {
      socket.disconnect(true);
      return false;
    }

    socket.data.lastSecurityValidatedAt = Date.now();
    if (socket.rooms && socket.join && socket.leave) {
      const activeSpaceIds = new Set(
        await this.spaceMemberRepo.getUserSpaceIds(userId),
      );
      const currentSpaceRooms = [...socket.rooms].filter((room) =>
        room.startsWith('space-'),
      );
      for (const room of currentSpaceRooms) {
        const spaceId = room.slice('space-'.length);
        if (!activeSpaceIds.has(spaceId)) await socket.leave(room);
      }
      for (const spaceId of activeSpaceIds) {
        const room = getSpaceRoomName(spaceId);
        if (!socket.rooms.has(room)) await socket.join(room);
      }
    }
    return active;
  }

  @Interval('ws-security-revalidation', 30_000)
  async revalidateConnectedSockets(): Promise<void> {
    if (!this.server || this.revalidationInProgress) return;
    this.revalidationInProgress = true;
    try {
      const sockets = await this.server.fetchSockets();
      await Promise.allSettled(
        sockets.map((socket) => this.revalidateSocket(socket)),
      );
    } finally {
      this.revalidationInProgress = false;
    }
  }

  async handleClientTreeRefresh(client: Socket, spaceId: string): Promise<void> {
    const room = getSpaceRoomName(spaceId);
    const userId = client.data.userId as string | undefined;
    if (!userId) return;

    const activeMembers = await this.spaceMemberRepo.getUserIdsWithSpaceAccess(
      [userId],
      spaceId,
    );
    if (!activeMembers.has(userId)) {
      await client.leave(room);
      return;
    }

    if (!client.rooms.has(room)) {
      return;
    }

    client.broadcast.to(room).emit('message', {
      operation: 'refetchRootTreeNodeEvent',
      spaceId,
    });
  }

  async emitTreeEvent(data: any): Promise<void> {
    if (!this.server || !this.isTreeEvent(data)) return;

    const room = getSpaceRoomName(data.spaceId);

    if (data.operation === 'refetchRootTreeNodeEvent') {
      this.server.to(room).emit('message', data);
      return;
    }

    const pageId = this.extractPageId(data);
    if (!pageId) return;

    const hasRestrictions = await this.spaceHasRestrictions(data.spaceId);
    if (!hasRestrictions) {
      this.server.to(room).emit('message', data);
      return;
    }

    const isRestricted =
      await this.pagePermissionRepo.hasRestrictedAncestor(pageId);
    if (!isRestricted) {
      this.server.to(room).emit('message', data);
      return;
    }

    await this.broadcastToAuthorizedUsers(room, null, pageId, data);
  }

  async invalidateSpaceRestrictionCache(spaceId: string): Promise<void> {
    await this.cacheManager.del(
      `${WS_SPACE_RESTRICTION_CACHE_PREFIX}${spaceId}`,
    );
  }

  async emitCommentEvent(
    spaceId: string,
    pageId: string,
    data: any,
  ): Promise<void> {
    await this.emitPageEvent(spaceId, pageId, data);
  }

  async emitPageEvent(
    spaceId: string,
    pageId: string,
    data: any,
  ): Promise<void> {
    if (!this.server) return;
    const room = getSpaceRoomName(spaceId);

    const hasRestrictions = await this.spaceHasRestrictions(spaceId);
    if (!hasRestrictions) {
      this.server.to(room).emit('message', data);
      return;
    }

    const isRestricted =
      await this.pagePermissionRepo.hasRestrictedAncestor(pageId);
    if (!isRestricted) {
      this.server.to(room).emit('message', data);
      return;
    }

    await this.broadcastToAuthorizedUsers(room, null, pageId, data);
  }

  async emitToUsers(userIds: string[], data: any): Promise<void> {
    if (!this.server || userIds.length === 0) return;
    const rooms = userIds.map((id) => getUserRoomName(id));
    this.server.to(rooms).emit('message', data);
  }

  async getAuthorizedTreeUserIds(
    spaceId: string,
    pageId: string,
  ): Promise<string[]> {
    if (!this.server) return [];

    const sockets = await this.server
      .in(getSpaceRoomName(spaceId))
      .fetchSockets();
    const userIds = Array.from(
      new Set(
        sockets
          .map((socket) => socket.data.userId as string | undefined)
          .filter((userId): userId is string => !!userId),
      ),
    );
    if (userIds.length === 0) return [];

    if (!(await this.spaceHasRestrictions(spaceId))) return userIds;
    if (!(await this.pagePermissionRepo.hasRestrictedAncestor(pageId))) {
      return userIds;
    }

    return this.pagePermissionRepo.getUserIdsWithPageAccess(pageId, userIds);
  }

  async emitToSpaceExceptUsers(
    spaceId: string,
    excludeUserIds: string[],
    data: any,
  ): Promise<void> {
    const room = getSpaceRoomName(spaceId);
    const sockets = await this.server.in(room).fetchSockets();
    const excludeSet = new Set(excludeUserIds);

    for (const socket of sockets) {
      const userId = socket.data.userId as string;
      if (userId && !excludeSet.has(userId)) {
        socket.emit('message', data);
      }
    }
  }

  isTreeEvent(data: any): boolean {
    return TREE_EVENTS.has(data?.operation) && !!data?.spaceId;
  }

  isClientTreeRefreshEvent(data: unknown): data is {
    operation: 'refetchRootTreeNodeEvent';
    spaceId: string;
  } {
    if (!data || typeof data !== 'object') return false;
    const event = data as Record<string, unknown>;
    return (
      event.operation === 'refetchRootTreeNodeEvent' &&
      typeof event.spaceId === 'string' &&
      event.spaceId.length > 0 &&
      event.spaceId.length <= 64
    );
  }

  private async broadcastToAuthorizedUsers(
    room: string,
    excludeSocketId: string | null,
    pageId: string,
    data: any,
  ): Promise<void> {
    const sockets = await this.server.in(room).fetchSockets();

    // Exclude only the originating socket, not every socket of the originating
    // user. Excluding by userId silently dropped the originator's other tabs
    // from receiving restricted-space tree events.
    const otherSockets = excludeSocketId
      ? sockets.filter((s) => s.id !== excludeSocketId)
      : sockets;
    if (otherSockets.length === 0) return;

    const userSocketMap = new Map<string, typeof otherSockets>();
    for (const socket of otherSockets) {
      const userId = socket.data.userId as string;
      if (!userId) continue;
      const existing = userSocketMap.get(userId);
      if (existing) {
        existing.push(socket);
      } else {
        userSocketMap.set(userId, [socket]);
      }
    }

    const candidateUserIds = Array.from(userSocketMap.keys());
    if (candidateUserIds.length === 0) return;

    const authorizedUserIds =
      await this.pagePermissionRepo.getUserIdsWithPageAccess(
        pageId,
        candidateUserIds,
      );

    const authorizedSet = new Set(authorizedUserIds);
    for (const [userId, userSockets] of userSocketMap) {
      if (authorizedSet.has(userId)) {
        for (const socket of userSockets) {
          socket.emit('message', data);
        }
      }
    }
  }

  private async spaceHasRestrictions(spaceId: string): Promise<boolean> {
    const cacheKey = `${WS_SPACE_RESTRICTION_CACHE_PREFIX}${spaceId}`;

    const cached = await this.cacheManager.get<boolean>(cacheKey);
    // A stale false would expose newly restricted tree nodes until the TTL
    // expires. Only positive restriction results are safe to cache.
    if (cached === true) return true;

    const hasRestrictions =
      await this.pagePermissionRepo.hasRestrictedPagesInSpace(spaceId);

    await this.cacheManager.set(cacheKey, hasRestrictions, WS_CACHE_TTL_MS);

    return hasRestrictions;
  }

  private extractPageId(data: any): string | null {
    switch (data.operation) {
      case 'addTreeNode':
        return data.payload?.data?.id ?? null;
      case 'moveTreeNode':
        return data.payload?.id ?? null;
      case 'deleteTreeNode':
        return data.payload?.node?.id ?? null;
      case 'updateOne':
        return data.id ?? null;
      default:
        return null;
    }
  }

  private async handleSecurityEvent(event: SecurityEvent): Promise<void> {
    if (!this.server) return;

    if (event.type === 'user.access-revoked') {
      this.server.in(getUserRoomName(event.userId)).disconnectSockets(true);
      return;
    }

    if (event.type === 'session.access-changed') {
      const sockets = await this.server
        .in(getUserRoomName(event.userId))
        .fetchSockets();
      await Promise.all(
        sockets.map((socket) => {
          const sessionId = socket.data.sessionId as string | undefined;
          const explicitlyRevoked =
            (event.sessionIds?.includes(sessionId ?? '') ?? false) ||
            (event.excludeSessionId !== undefined &&
              sessionId !== event.excludeSessionId);
          if (explicitlyRevoked) {
            socket.disconnect(true);
            return Promise.resolve(false);
          }
          if (event.sessionIds || event.excludeSessionId) {
            return Promise.resolve(true);
          }
          return this.revalidateSocket(socket);
        }),
      );
      return;
    }

    if (event.type === 'space.membership-changed') {
      for (const spaceId of event.spaceIds) {
        const activeUserIds =
          await this.spaceMemberRepo.getUserIdsWithSpaceAccess(
            event.userIds,
            spaceId,
          );
        for (const userId of event.userIds) {
          const userSockets = this.server.in(getUserRoomName(userId));
          const spaceRoom = getSpaceRoomName(spaceId);
          if (activeUserIds.has(userId)) {
            userSockets.socketsJoin(spaceRoom);
          } else {
            userSockets.socketsLeave(spaceRoom);
          }
        }
      }
      return;
    }

    if (event.type === 'page.permission-changed') {
      await this.invalidateSpaceRestrictionCache(event.spaceId);
    }
  }
}
