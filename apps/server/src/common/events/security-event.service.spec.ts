import { SecurityEventService } from './security-event.service';

describe('SecurityEventService', () => {
  it('dispatches locally and ignores the Redis echo for the same event', async () => {
    let redisMessageHandler: (
      channel: string,
      message: string,
    ) => Promise<void>;
    const subscriber = {
      on: jest.fn((event, handler) => {
        if (event === 'message') redisMessageHandler = handler;
      }),
      off: jest.fn(),
      subscribe: jest.fn().mockResolvedValue(undefined),
      unsubscribe: jest.fn().mockResolvedValue(undefined),
      disconnect: jest.fn(),
    };
    const redis = {
      duplicate: jest.fn(() => subscriber),
      publish: jest.fn(async (channel, message) => {
        await redisMessageHandler(channel, message);
      }),
    };
    const service = new SecurityEventService({
      getOrThrow: () => redis,
    } as any);
    const listener = jest.fn().mockResolvedValue(undefined);

    await service.onModuleInit();
    service.subscribe(listener);
    await service.publish({
      type: 'session.access-changed',
      userId: 'user-1',
      workspaceId: 'workspace-1',
    });

    expect(listener).toHaveBeenCalledTimes(1);
    expect(listener).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'session.access-changed',
        userId: 'user-1',
        workspaceId: 'workspace-1',
      }),
    );
  });
});
