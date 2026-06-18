import { Injectable, Logger } from '@nestjs/common';
import { Interval } from '@nestjs/schedule';
import { InjectKysely } from 'nestjs-kysely';
import { KyselyDB } from '@docmost/db/types/kysely.types';
import { NotificationRepo } from '@docmost/db/repos/notification/notification.repo';
import { InsertableNotification } from '@docmost/db/types/entity.types';
import { PaginationOptions } from '@docmost/db/pagination/pagination-options';
import { WsGateway } from '../../ws/ws.gateway';
import { MailService } from '../../integrations/mail/mail.service';
import {
  NotificationTab,
  NotificationType,
  NotificationTypeToSettingKey,
} from './notification.constants';
import { PagePermissionRepo } from '@docmost/db/repos/page/page-permission.repo';

const NOTIFICATION_CLEANUP_INTERVAL_MS = 24 * 60 * 60 * 1000;
const PAGE_UPDATE_READ_RETENTION_DAYS = 30;
const PAGE_UPDATE_UNREAD_RETENTION_DAYS = 90;

@Injectable()
export class NotificationService {
  private readonly logger = new Logger(NotificationService.name);

  constructor(
    private readonly notificationRepo: NotificationRepo,
    private readonly pagePermissionRepo: PagePermissionRepo,
    private readonly wsGateway: WsGateway,
    private readonly mailService: MailService,
    @InjectKysely() private readonly db: KyselyDB,
  ) {}

  async create(data: InsertableNotification) {
    const user = await this.db
      .selectFrom('users')
      .select(['id'])
      .where('id', '=', data.userId)
      .where('deletedAt', 'is', null)
      .where('deactivatedAt', 'is', null)
      .executeTakeFirst();

    if (!user) return null;

    const notification = await this.notificationRepo.insert(data);

    this.wsGateway.server
      .to(`user-${data.userId}`)
      .emit('notification', { id: notification.id, type: notification.type });

    return notification;
  }

  async findByUserId(
    userId: string,
    pagination: PaginationOptions,
    type: NotificationTab = 'all',
  ) {
    const result = await this.notificationRepo.findByUserId(
      userId,
      pagination,
      type,
    );

    const pageIds = result.items.map((n: any) => n.pageId).filter(Boolean);

    if (pageIds.length > 0) {
      const accessiblePageIds =
        await this.pagePermissionRepo.filterAccessiblePageIds({
          pageIds,
          userId,
        });
      const accessibleSet = new Set(accessiblePageIds);

      result.items = result.items.filter(
        (n: any) => !n.pageId || accessibleSet.has(n.pageId),
      );
    }

    return result;
  }

  async getUnreadCount(userId: string) {
    return this.notificationRepo.getUnreadCount(userId);
  }

  async markAsRead(notificationId: string, userId: string) {
    return this.notificationRepo.markAsRead(notificationId, userId);
  }

  async markMultipleAsRead(notificationIds: string[], userId: string) {
    return this.notificationRepo.markMultipleAsRead(notificationIds, userId);
  }

  async markAllAsRead(userId: string) {
    return this.notificationRepo.markAllAsRead(userId);
  }

  @Interval('notification-cleanup', NOTIFICATION_CLEANUP_INTERVAL_MS)
  async cleanupNotifications() {
    try {
      const removed =
        await this.notificationRepo.deleteStalePageUpdateNotifications({
          readBefore: this.daysAgo(PAGE_UPDATE_READ_RETENTION_DAYS),
          unreadBefore: this.daysAgo(PAGE_UPDATE_UNREAD_RETENTION_DAYS),
        });

      this.logger.debug(
        removed > 0
          ? `Notification cleanup completed: ${removed} page update notifications removed`
          : 'No stale page update notifications to clean up',
      );
    } catch (err) {
      this.logger.error(
        'Notification cleanup failed',
        err instanceof Error ? err.stack : undefined,
      );
    }
  }

  async queueEmail(
    userId: string,
    notificationId: string,
    subject: string,
    template: any,
    type?: NotificationType,
  ) {
    try {
      const user = await this.db
        .selectFrom('users')
        .select(['email', 'settings'])
        .where('id', '=', userId)
        .where('deletedAt', 'is', null)
        .where('deactivatedAt', 'is', null)
        .executeTakeFirst();

      if (!user?.email) return;

      if (type) {
        const settingKey = NotificationTypeToSettingKey[type];
        if (settingKey) {
          const settings = user.settings as any;
          if (settings?.notifications?.[settingKey] === false) return;
        }
      }

      await this.mailService.sendToQueue({
        to: user.email,
        subject,
        template,
        notificationId,
      });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Unknown error';
      this.logger.error(
        `Failed to queue email for notification ${notificationId}: ${message}`,
      );
    }
  }

  private daysAgo(days: number): Date {
    return new Date(Date.now() - days * 24 * 60 * 60 * 1000);
  }
}
