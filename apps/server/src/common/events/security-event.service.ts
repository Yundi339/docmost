import {
  Global,
  Injectable,
  Logger,
  Module,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { RedisService } from '@nestjs-labs/nestjs-ioredis';
import type { Redis } from 'ioredis';
import { randomUUID } from 'node:crypto';

const SECURITY_EVENT_CHANNEL = 'docmost:security-events:v1';
const SEEN_EVENT_TTL_MS = 60_000;

export type SecurityEventPayload =
  | {
      type: 'user.access-revoked';
      userId: string;
      workspaceId: string;
    }
  | {
      type: 'session.access-changed';
      userId: string;
      workspaceId: string;
      sessionIds?: string[];
      excludeSessionId?: string;
    }
  | {
      type: 'space.membership-changed';
      userIds: string[];
      spaceIds: string[];
    }
  | {
      type: 'page.permission-changed';
      pageId: string;
      spaceId: string;
    }
  | {
      type: 'user.permissions-changed';
      userIds: string[];
      workspaceId: string;
    };

export type SecurityEvent = SecurityEventPayload & {
  eventId: string;
  occurredAt: string;
};

export type SecurityEventListener = (event: SecurityEvent) => Promise<void>;

@Injectable()
export class SecurityEventService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(SecurityEventService.name);
  private readonly listeners = new Set<SecurityEventListener>();
  private readonly seenEvents = new Map<string, number>();
  private readonly redis: Redis;
  private subscriber: Redis;

  constructor(redisService: RedisService) {
    this.redis = redisService.getOrThrow();
  }

  async onModuleInit(): Promise<void> {
    this.subscriber = this.redis.duplicate();
    this.subscriber.on('message', this.handleRedisMessage);
    this.subscriber.on('error', () => {
      this.logger.error('Security event subscriber error');
    });
    await this.subscriber.subscribe(SECURITY_EVENT_CHANNEL);
  }

  async onModuleDestroy(): Promise<void> {
    if (!this.subscriber) return;
    this.subscriber.off('message', this.handleRedisMessage);
    await this.subscriber.unsubscribe(SECURITY_EVENT_CHANNEL).catch(() => {});
    this.subscriber.disconnect(false);
  }

  subscribe(listener: SecurityEventListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  async publish(payload: SecurityEventPayload): Promise<void> {
    const event: SecurityEvent = {
      ...payload,
      eventId: randomUUID(),
      occurredAt: new Date().toISOString(),
    };

    await this.dispatch(event);

    try {
      await this.redis.publish(SECURITY_EVENT_CHANNEL, JSON.stringify(event));
    } catch {
      this.logger.error('Failed to publish security event');
    }
  }

  private readonly handleRedisMessage = async (
    channel: string,
    message: string,
  ): Promise<void> => {
    if (channel !== SECURITY_EVENT_CHANNEL) return;

    try {
      const event = JSON.parse(message) as SecurityEvent;
      if (!event?.eventId || !event?.type) return;
      await this.dispatch(event);
    } catch {
      this.logger.warn('Ignored malformed security event');
    }
  };

  private async dispatch(event: SecurityEvent): Promise<void> {
    const now = Date.now();
    if (this.seenEvents.has(event.eventId)) return;
    this.seenEvents.set(event.eventId, now);

    for (const [eventId, seenAt] of this.seenEvents) {
      if (now - seenAt > SEEN_EVENT_TTL_MS) this.seenEvents.delete(eventId);
    }

    const results = await Promise.allSettled(
      [...this.listeners].map((listener) => listener(event)),
    );
    if (results.some((result) => result.status === 'rejected')) {
      this.logger.error('Security event listener failed');
    }
  }
}

@Global()
@Module({
  providers: [SecurityEventService],
  exports: [SecurityEventService],
})
export class SecurityEventModule {}
