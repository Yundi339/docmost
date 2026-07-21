import {
  beforeHandleMessagePayload,
  Connection,
  connectedPayload,
  Extension,
  onAuthenticatePayload,
  onDisconnectPayload,
} from '@hocuspocus/server';
import {
  Injectable,
  Logger,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { TokenService } from '../../core/auth/services/token.service';
import { UserRepo } from '@docmost/db/repos/user/user.repo';
import { PageRepo } from '@docmost/db/repos/page/page.repo';
import { SpaceMemberRepo } from '@docmost/db/repos/space/space-member.repo';
import { PagePermissionRepo } from '@docmost/db/repos/page/page-permission.repo';
import { findHighestUserSpaceRole } from '@docmost/db/repos/space/utils';
import { SpaceRole } from '../../common/helpers/types/permission';
import { isUserDisabled } from '../../common/helpers';
import { getPageId } from '../collaboration.util';
import { JwtCollabPayload, JwtType } from '../../core/auth/dto/jwt-payload';
import { UserSessionRepo } from '@docmost/db/repos/session/user-session.repo';
import { WorkspaceRepo } from '@docmost/db/repos/workspace/workspace.repo';
import { Interval } from '@nestjs/schedule';
import {
  SecurityEvent,
  SecurityEventService,
} from '../../common/events/security-event.service';

type CollabContext = {
  authenticatedCollab: true;
  user: any;
  userId: string;
  workspaceId: string;
  sessionId: string;
  pageId: string;
  spaceId: string;
};

type TrackedConnection = {
  connection: Connection;
  context: CollabContext;
  documentName: string;
  socketId: string;
  lastValidatedAt: number;
};

const CONNECTION_REVALIDATION_WINDOW_MS = 3_000;

@Injectable()
export class AuthenticationExtension implements Extension {
  private readonly logger = new Logger(AuthenticationExtension.name);
  private readonly connections = new Map<string, TrackedConnection>();
  private readonly unsubscribeSecurityEvents: () => void;
  private revalidationInProgress = false;

  constructor(
    private tokenService: TokenService,
    private userRepo: UserRepo,
    private pageRepo: PageRepo,
    private readonly spaceMemberRepo: SpaceMemberRepo,
    private readonly pagePermissionRepo: PagePermissionRepo,
    private readonly userSessionRepo: UserSessionRepo,
    private readonly workspaceRepo: WorkspaceRepo,
    private readonly securityEvents: SecurityEventService,
  ) {
    this.unsubscribeSecurityEvents = this.securityEvents.subscribe((event) =>
      this.handleSecurityEvent(event),
    );
  }

  async onAuthenticate(data: onAuthenticatePayload) {
    const { documentName, token } = data;
    const pageId = getPageId(documentName);

    let jwtPayload: JwtCollabPayload;

    try {
      jwtPayload = await this.tokenService.verifyJwt(token, JwtType.COLLAB);
    } catch (error) {
      throw new UnauthorizedException('Invalid collab token');
    }

    const userId = jwtPayload.sub;
    const workspaceId = jwtPayload.workspaceId;
    const sessionId = jwtPayload.sessionId;

    if (!sessionId) {
      throw new UnauthorizedException('Collab session is required');
    }

    const [workspace, user, session] = await Promise.all([
      this.workspaceRepo.findActiveById(workspaceId),
      this.userRepo.findById(userId, workspaceId),
      this.userSessionRepo.findActiveById(sessionId),
    ]);

    if (!workspace || !user) {
      throw new UnauthorizedException();
    }

    if (isUserDisabled(user)) {
      throw new UnauthorizedException();
    }

    if (
      !session ||
      session.userId !== userId ||
      session.workspaceId !== workspaceId
    ) {
      throw new UnauthorizedException();
    }

    const page = await this.pageRepo.findById(pageId);
    if (!page || page.workspaceId !== workspaceId) {
      this.logger.debug(`Page not found: ${pageId}`);
      throw new NotFoundException('Page not found');
    }

    const userSpaceRoles = await this.spaceMemberRepo.getUserSpaceRoles(
      user.id,
      page.spaceId,
    );

    const userSpaceRole = findHighestUserSpaceRole(userSpaceRoles);

    if (!userSpaceRole) {
      this.logger.warn(`User not authorized to access page: ${pageId}`);
      throw new UnauthorizedException();
    }

    // Check page-level permissions
    const { hasAnyRestriction, canAccess, canEdit } =
      await this.pagePermissionRepo.canUserEditPage(user.id, page.id);

    const spaceCanEdit = userSpaceRole !== SpaceRole.READER;

    if (hasAnyRestriction) {
      if (!canAccess) {
        this.logger.warn(
          `User ${user.id} denied page-level access to page: ${pageId}`,
        );
        throw new UnauthorizedException();
      }

      if (!spaceCanEdit || !canEdit) {
        data.connectionConfig.readOnly = true;
        this.logger.debug(
          `User ${user.id} granted readonly access to restricted page: ${pageId}`,
        );
      }
    } else {
      // No restrictions - use space-level permissions
      if (userSpaceRole === SpaceRole.READER) {
        data.connectionConfig.readOnly = true;
        this.logger.debug(`User granted readonly access to page: ${pageId}`);
      }
    }

    if (page.deletedAt) {
      data.connectionConfig.readOnly = true;
    }

    this.logger.debug(`Authenticated user ${user.id} on page ${pageId}`);

    return {
      authenticatedCollab: true,
      user,
      userId,
      workspaceId,
      sessionId,
      pageId: page.id,
      spaceId: page.spaceId,
    };
  }

  async connected(data: connectedPayload): Promise<void> {
    const context = data.context as CollabContext;
    if (!context?.authenticatedCollab) return;
    this.connections.set(this.connectionKey(data.socketId, data.documentName), {
      connection: data.connection as Connection,
      context,
      documentName: data.documentName,
      socketId: data.socketId,
      lastValidatedAt: Date.now(),
    });
  }

  async onDisconnect(data: onDisconnectPayload): Promise<void> {
    this.connections.delete(
      this.connectionKey(data.socketId, data.documentName),
    );
  }

  async beforeHandleMessage(data: beforeHandleMessagePayload): Promise<void> {
    const context = data.context as CollabContext;
    if (!context?.authenticatedCollab) return;

    const record = this.connections.get(
      this.connectionKey(data.socketId, data.documentName),
    );
    if (
      record &&
      Date.now() - record.lastValidatedAt < CONNECTION_REVALIDATION_WINDOW_MS
    ) {
      return;
    }

    try {
      const { readOnly } = await this.validateContext(
        data.documentName,
        context,
      );
      if (readOnly && !data.connection.readOnly) {
        throw new UnauthorizedException('Collab edit permission revoked');
      }
      if (record) record.lastValidatedAt = Date.now();
    } catch (error) {
      this.closeTrackedConnection(data.socketId, data.documentName);
      throw error;
    }
  }

  async validateStoreContext(
    documentName: string,
    context: any,
    socketId?: string,
  ): Promise<void> {
    if (!context?.authenticatedCollab) return;

    try {
      const { readOnly } = await this.validateContext(documentName, context);
      if (readOnly) {
        throw new UnauthorizedException('Collab edit permission revoked');
      }
    } catch (error) {
      if (socketId) this.closeTrackedConnection(socketId, documentName);
      throw error;
    }
  }

  onDestroy(): Promise<void> {
    this.unsubscribeSecurityEvents();
    this.connections.clear();
    return Promise.resolve();
  }

  @Interval('collaboration-security-revalidation', 30_000)
  async revalidateConnections(): Promise<void> {
    if (this.revalidationInProgress || this.connections.size === 0) return;
    this.revalidationInProgress = true;
    try {
      await Promise.allSettled(
        [...this.connections.values()].map((record) =>
          this.revalidateConnection(record),
        ),
      );
    } finally {
      this.revalidationInProgress = false;
    }
  }

  private async validateContext(
    documentName: string,
    context: CollabContext,
  ): Promise<{ readOnly: boolean }> {
    const pageId = getPageId(documentName);
    if (pageId !== context.pageId) throw new UnauthorizedException();

    const [workspace, user, session, page] = await Promise.all([
      this.workspaceRepo.findActiveById(context.workspaceId),
      this.userRepo.findById(context.userId, context.workspaceId),
      this.userSessionRepo.findActiveById(context.sessionId),
      this.pageRepo.findById(pageId),
    ]);

    if (
      !workspace ||
      !user ||
      isUserDisabled(user) ||
      !session ||
      session.userId !== context.userId ||
      session.workspaceId !== context.workspaceId ||
      !page ||
      page.workspaceId !== context.workspaceId ||
      page.spaceId !== context.spaceId
    ) {
      throw new UnauthorizedException();
    }

    const roles = await this.spaceMemberRepo.getUserSpaceRoles(
      context.userId,
      page.spaceId,
    );
    const role = findHighestUserSpaceRole(roles);
    if (!role) throw new UnauthorizedException();

    const permission = await this.pagePermissionRepo.canUserEditPage(
      context.userId,
      page.id,
    );
    if (permission.hasAnyRestriction && !permission.canAccess) {
      throw new UnauthorizedException();
    }

    return {
      readOnly:
        Boolean(page.deletedAt) ||
        role === SpaceRole.READER ||
        (permission.hasAnyRestriction && !permission.canEdit),
    };
  }

  private async handleSecurityEvent(event: SecurityEvent): Promise<void> {
    const records = [...this.connections.values()];
    const revalidations: Promise<void>[] = [];

    for (const record of records) {
      const { context } = record;
      if (
        event.type === 'user.access-revoked' &&
        event.userId === context.userId &&
        event.workspaceId === context.workspaceId
      ) {
        this.closeConnection(record);
      } else if (
        event.type === 'session.access-changed' &&
        event.userId === context.userId &&
        event.workspaceId === context.workspaceId
      ) {
        const explicitlyRevoked =
          (event.sessionIds?.includes(context.sessionId) ?? false) ||
          (event.excludeSessionId !== undefined &&
            context.sessionId !== event.excludeSessionId);
        if (explicitlyRevoked) {
          this.closeConnection(record);
        } else if (!event.sessionIds && !event.excludeSessionId) {
          revalidations.push(this.revalidateConnection(record));
        }
      } else if (
        event.type === 'space.membership-changed' &&
        event.userIds.includes(context.userId) &&
        event.spaceIds.includes(context.spaceId)
      ) {
        revalidations.push(this.revalidateConnection(record));
      } else if (
        event.type === 'page.permission-changed' &&
        event.spaceId === context.spaceId
      ) {
        revalidations.push(this.revalidateConnection(record));
      } else if (
        event.type === 'user.permissions-changed' &&
        event.userIds.includes(context.userId) &&
        event.workspaceId === context.workspaceId
      ) {
        revalidations.push(this.revalidateConnection(record));
      }
    }

    await Promise.allSettled(revalidations);
  }

  private async revalidateConnection(record: TrackedConnection): Promise<void> {
    try {
      const { readOnly } = await this.validateContext(
        record.documentName,
        record.context,
      );
      if (readOnly !== Boolean(record.connection.readOnly)) {
        this.closeConnection(record);
        return;
      }
      record.lastValidatedAt = Date.now();
    } catch {
      this.closeConnection(record);
    }
  }

  private closeTrackedConnection(socketId: string, documentName: string): void {
    const record = this.connections.get(
      this.connectionKey(socketId, documentName),
    );
    if (record) this.closeConnection(record);
  }

  private closeConnection(record: TrackedConnection): void {
    this.connections.delete(
      this.connectionKey(record.socketId, record.documentName),
    );
    record.connection.close({ code: 4403, reason: 'Permission revoked' });
  }

  private connectionKey(socketId: string, documentName: string): string {
    return `${socketId}:${documentName}`;
  }
}
