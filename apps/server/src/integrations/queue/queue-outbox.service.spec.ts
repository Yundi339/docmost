import { QueueJob, QueueName } from './constants';
import { QueueOutboxService } from './queue-outbox.service';

function outboxRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'outbox-id',
    queueName: QueueName.ATTACHMENT_QUEUE,
    jobName: QueueJob.DELETE_PAGE_ATTACHMENTS,
    jobId: 'delete-page-attachments-page-id',
    payload: { pageId: 'page-id' },
    attempts: 0,
    availableAt: new Date(),
    dispatchedAt: null,
    lastError: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

function createDispatchService(rows: any[], queueAdd: jest.Mock) {
  const updates: Array<Record<string, unknown>> = [];
  const selectBuilder: any = {
    selectAll: jest.fn(() => selectBuilder),
    where: jest.fn(() => selectBuilder),
    orderBy: jest.fn(() => selectBuilder),
    limit: jest.fn(() => selectBuilder),
    forUpdate: jest.fn(() => selectBuilder),
    skipLocked: jest.fn(() => selectBuilder),
    execute: jest.fn().mockResolvedValue(rows),
  };
  const trx = {
    selectFrom: jest.fn(() => selectBuilder),
    updateTable: jest.fn(() => {
      const updateBuilder: any = {
        set: jest.fn((value) => {
          updates.push(value);
          return updateBuilder;
        }),
        where: jest.fn(() => updateBuilder),
        execute: jest.fn().mockResolvedValue(undefined),
      };
      return updateBuilder;
    }),
  };
  const db = {
    transaction: jest.fn(() => ({
      execute: (callback: (transaction: any) => Promise<unknown>) =>
        callback(trx),
    })),
  };
  const service = new QueueOutboxService(db as any, {
    add: queueAdd,
  } as any);

  return { service, trx, updates };
}

describe('QueueOutboxService', () => {
  it('stores page attachment cleanup intents in the caller transaction', async () => {
    const insertBuilder: any = {
      values: jest.fn(() => insertBuilder),
      onConflict: jest.fn(() => insertBuilder),
      execute: jest.fn().mockResolvedValue(undefined),
    };
    const trx = { insertInto: jest.fn(() => insertBuilder) };
    const service = new QueueOutboxService({} as any, {} as any);

    await service.schedulePageAttachmentCleanup(
      ['page-1', 'page-1', 'page-2'],
      trx as any,
    );

    expect(trx.insertInto).toHaveBeenCalledWith('queueOutbox');
    expect(insertBuilder.values).toHaveBeenCalledWith([
      {
        queueName: QueueName.ATTACHMENT_QUEUE,
        jobName: QueueJob.DELETE_PAGE_ATTACHMENTS,
        jobId: 'delete-page-attachments-page-1',
        payload: { pageId: 'page-1' },
      },
      {
        queueName: QueueName.ATTACHMENT_QUEUE,
        jobName: QueueJob.DELETE_PAGE_ATTACHMENTS,
        jobId: 'delete-page-attachments-page-2',
        payload: { pageId: 'page-2' },
      },
    ]);
    expect(insertBuilder.execute).toHaveBeenCalledTimes(1);
  });

  it('marks an outbox row dispatched only after BullMQ accepts it', async () => {
    const queueAdd = jest.fn().mockResolvedValue({ id: 'job-id' });
    const { service, updates } = createDispatchService(
      [outboxRow()],
      queueAdd,
    );

    await expect(service.dispatchPending()).resolves.toBe(1);

    expect(queueAdd).toHaveBeenCalledWith(
      QueueJob.DELETE_PAGE_ATTACHMENTS,
      { pageId: 'page-id' },
      expect.objectContaining({
        jobId: 'delete-page-attachments-page-id',
      }),
    );
    expect(updates[0]).toEqual(
      expect.objectContaining({
        dispatchedAt: expect.any(Date),
        lastError: null,
      }),
    );
  });

  it('keeps failed rows pending with bounded retry metadata', async () => {
    const queueAdd = jest.fn().mockRejectedValue(new Error('redis unavailable'));
    const { service, updates } = createDispatchService(
      [outboxRow({ attempts: 2 })],
      queueAdd,
    );

    await expect(service.dispatchPending()).resolves.toBe(0);

    expect(updates[0]).toEqual(
      expect.objectContaining({
        availableAt: expect.any(Date),
        lastError: 'redis unavailable',
      }),
    );
    expect(updates[0].dispatchedAt).toBeUndefined();
  });
});
