import { Injectable, Logger } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import { Interval } from '@nestjs/schedule';
import { InjectKysely } from 'nestjs-kysely';
import { Queue } from 'bullmq';
import { sql } from 'kysely';
import { KyselyDB, KyselyTransaction } from '@docmost/db/types/kysely.types';
import { QueueJob, QueueName } from './constants';

const DISPATCH_BATCH_SIZE = 50;
const DISPATCH_INTERVAL_MS = 5_000;
const DISPATCHED_RETENTION_MS = 7 * 24 * 60 * 60 * 1000;

@Injectable()
export class QueueOutboxService {
  private readonly logger = new Logger(QueueOutboxService.name);
  private dispatchInProgress = false;

  constructor(
    @InjectKysely() private readonly db: KyselyDB,
    @InjectQueue(QueueName.ATTACHMENT_QUEUE)
    private readonly attachmentQueue: Queue,
  ) {}

  async schedulePageAttachmentCleanup(
    pageIds: readonly string[],
    trx: KyselyTransaction,
  ): Promise<void> {
    const uniquePageIds = [...new Set(pageIds)];
    if (uniquePageIds.length === 0) return;

    await trx
      .insertInto('queueOutbox')
      .values(
        uniquePageIds.map((pageId) => ({
          queueName: QueueName.ATTACHMENT_QUEUE,
          jobName: QueueJob.DELETE_PAGE_ATTACHMENTS,
          jobId: `delete-page-attachments-${pageId}`,
          payload: { pageId },
        })),
      )
      .onConflict((conflict) =>
        conflict.columns(['queueName', 'jobId']).doNothing(),
      )
      .execute();
  }

  async dispatchPending(): Promise<number> {
    if (this.dispatchInProgress) return 0;
    this.dispatchInProgress = true;

    try {
      return await this.db.transaction().execute(async (trx) => {
        const rows = await trx
          .selectFrom('queueOutbox')
          .selectAll()
          .where('dispatchedAt', 'is', null)
          .where('availableAt', '<=', new Date())
          .orderBy('createdAt', 'asc')
          .limit(DISPATCH_BATCH_SIZE)
          .forUpdate()
          .skipLocked()
          .execute();

        let dispatched = 0;
        for (const row of rows) {
          try {
            await this.getQueue(row.queueName).add(
              row.jobName,
              row.payload as Record<string, unknown>,
              {
                jobId: row.jobId,
                attempts: 3,
                backoff: { type: 'exponential', delay: 5_000 },
              },
            );
            await trx
              .updateTable('queueOutbox')
              .set({
                dispatchedAt: new Date(),
                lastError: null,
                updatedAt: new Date(),
              })
              .where('id', '=', row.id)
              .execute();
            dispatched += 1;
          } catch (error) {
            const attempts = row.attempts + 1;
            await trx
              .updateTable('queueOutbox')
              .set({
                attempts: sql`attempts + 1`,
                availableAt: new Date(
                  Date.now() + Math.min(2 ** attempts * 1_000, 300_000),
                ),
                lastError: this.errorMessage(error),
                updatedAt: new Date(),
              })
              .where('id', '=', row.id)
              .execute();
          }
        }

        return dispatched;
      });
    } finally {
      this.dispatchInProgress = false;
    }
  }

  @Interval('queue-outbox-dispatch', DISPATCH_INTERVAL_MS)
  async dispatchScheduled(): Promise<void> {
    try {
      await this.dispatchPending();
    } catch (error) {
      this.logger.error('Failed to dispatch queue outbox', error);
    }
  }

  @Interval('queue-outbox-cleanup', 24 * 60 * 60 * 1000)
  async cleanupDispatched(): Promise<void> {
    try {
      await this.db
        .deleteFrom('queueOutbox')
        .where(
          'dispatchedAt',
          '<',
          new Date(Date.now() - DISPATCHED_RETENTION_MS),
        )
        .execute();
    } catch (error) {
      this.logger.error('Failed to clean dispatched queue outbox rows', error);
    }
  }

  private getQueue(queueName: string): Queue {
    if (queueName === QueueName.ATTACHMENT_QUEUE) return this.attachmentQueue;
    throw new Error(`Unsupported outbox queue: ${queueName}`);
  }

  private errorMessage(error: unknown): string {
    const message = error instanceof Error ? error.message : String(error);
    return message.slice(0, 1_000);
  }
}
