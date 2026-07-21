import { ForbiddenException, Injectable, Logger } from '@nestjs/common';
import { Interval } from '@nestjs/schedule';
import { TokenService } from '../auth/services/token.service';
import { UserSessionRepo } from '@docmost/db/repos/session/user-session.repo';
import { EnvironmentService } from '../../integrations/environment/environment.service';
import { User } from '@docmost/db/types/entity.types';
import { ClsService } from 'nestjs-cls';
import {
  AuditContext,
  AUDIT_CONTEXT_KEY,
} from '../../common/middlewares/audit-context.middleware';
import * as Bowser from 'bowser';
import { InjectKysely } from 'nestjs-kysely';
import { KyselyDB } from '@docmost/db/types/kysely.types';
import { executeTx } from '@docmost/db/utils';
import { isUserDisabled } from '../../common/helpers';
import { SecurityEventService } from '../../common/events/security-event.service';

const MAX_SESSIONS_PER_USER = 25;
const RETENTION_DAYS = 7;

@Injectable()
export class SessionService {
  private readonly logger = new Logger(SessionService.name);

  constructor(
    private readonly tokenService: TokenService,
    private readonly userSessionRepo: UserSessionRepo,
    private readonly environmentService: EnvironmentService,
    private readonly cls: ClsService,
    @InjectKysely() private readonly db: KyselyDB,
    private readonly securityEvents: SecurityEventService,
  ) {}

  @Interval('session-cleanup', 24 * 60 * 60 * 1000)
  async cleanupSessions() {
    try {
      await this.userSessionRepo.deleteStale(RETENTION_DAYS);
      await this.userSessionRepo.trimExcessSessions(MAX_SESSIONS_PER_USER);
      this.logger.debug('Session cleanup completed');
    } catch (err) {
      this.logger.error('Session cleanup failed', err);
    }
  }

  async createSessionAndToken(
    user: User,
    metadata?: Record<string, string>,
  ): Promise<string> {
    const auditContext = this.cls.get<AuditContext>(AUDIT_CONTEXT_KEY);
    const ipAddress = auditContext?.ipAddress ?? null;
    const userAgent = auditContext?.userAgent ?? null;

    const deviceName = this.parseDeviceName(userAgent);
    const expiresAt = this.environmentService.getCookieExpiresIn();

    return executeTx(this.db, async (trx) => {
      const lockedUser = await trx
        .selectFrom('users')
        .selectAll()
        .where('id', '=', user.id)
        .where('workspaceId', '=', user.workspaceId)
        .forUpdate()
        .executeTakeFirst();

      if (!lockedUser || isUserDisabled(lockedUser as User)) {
        throw new ForbiddenException();
      }

      const session = await this.userSessionRepo.insertSession(
        {
          userId: lockedUser.id,
          workspaceId: lockedUser.workspaceId,
          deviceName,
          userAgent,
          ipAddress,
          expiresAt,
          metadata: metadata ?? null,
        },
        trx,
      );

      return this.tokenService.generateAccessToken(
        lockedUser as User,
        session.id,
      );
    });
  }

  async getActiveSessions(
    userId: string,
    workspaceId: string,
    currentSessionId: string | null,
  ) {
    const sessions = await this.userSessionRepo.findActiveByUser(
      userId,
      workspaceId,
    );

    const mapped = sessions.map((s) => ({
      id: s.id,
      deviceName: s.deviceName,
      geoLocation: s.geoLocation,
      lastActiveAt: s.lastActiveAt,
      createdAt: s.createdAt,
      isCurrentDevice: s.id === currentSessionId,
    }));

    return mapped.sort((a, b) => {
      if (a.isCurrentDevice) return -1;
      if (b.isCurrentDevice) return 1;
      return 0;
    });
  }

  async revokeSession(
    sessionId: string,
    userId: string,
    workspaceId: string,
  ): Promise<void> {
    await this.userSessionRepo.revokeById(sessionId, userId, workspaceId);
    await this.securityEvents.publish({
      type: 'session.access-changed',
      userId,
      workspaceId,
      sessionIds: [sessionId],
    });
  }

  async revokeAllOtherSessions(
    currentSessionId: string,
    userId: string,
    workspaceId: string,
  ): Promise<void> {
    await this.userSessionRepo.revokeAllExceptCurrent(
      currentSessionId,
      userId,
      workspaceId,
    );
    await this.securityEvents.publish({
      type: 'session.access-changed',
      userId,
      workspaceId,
      excludeSessionId: currentSessionId,
    });
  }

  private parseDeviceName(userAgent: string | null): string | null {
    if (!userAgent) return null;

    try {
      const parsed = Bowser.parse(userAgent);

      const os = parsed.os?.name;
      const browser = parsed.browser?.name;
      const platformType = parsed.platform?.type;

      if (platformType === 'mobile' || platformType === 'tablet') {
        return parsed.platform?.model || os || 'Mobile Device';
      }

      if (os) {
        return browser ? `${browser} on ${os}` : os;
      }

      return browser || null;
    } catch {
      return null;
    }
  }
}
