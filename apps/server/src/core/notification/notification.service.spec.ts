import { Logger } from '@nestjs/common';
import { NotificationService } from './notification.service';

function createService() {
  const notificationRepo = {
    deleteStalePageUpdateNotifications: jest.fn(),
  };

  const service = new NotificationService(
    notificationRepo as any,
    {} as any,
    {} as any,
    {} as any,
    {} as any,
  );

  return { notificationRepo, service };
}

describe('NotificationService.cleanupNotifications', () => {
  let loggerDebugSpy: jest.SpyInstance;
  let loggerErrorSpy: jest.SpyInstance;

  beforeEach(() => {
    jest.useFakeTimers().setSystemTime(new Date('2026-06-19T12:00:00.000Z'));
    loggerDebugSpy = jest
      .spyOn(Logger.prototype, 'debug')
      .mockImplementation(() => undefined);
    loggerErrorSpy = jest
      .spyOn(Logger.prototype, 'error')
      .mockImplementation(() => undefined);
  });

  afterEach(() => {
    loggerDebugSpy.mockRestore();
    loggerErrorSpy.mockRestore();
    jest.useRealTimers();
  });

  it('cleans stale page update notifications with separate read and unread retention windows', async () => {
    const { notificationRepo, service } = createService();
    notificationRepo.deleteStalePageUpdateNotifications.mockResolvedValue(3);

    await service.cleanupNotifications();

    expect(
      notificationRepo.deleteStalePageUpdateNotifications,
    ).toHaveBeenCalledWith({
      readBefore: new Date('2026-05-20T12:00:00.000Z'),
      unreadBefore: new Date('2026-03-21T12:00:00.000Z'),
    });
  });

  it('does not throw if cleanup fails', async () => {
    const { notificationRepo, service } = createService();
    notificationRepo.deleteStalePageUpdateNotifications.mockRejectedValue(
      new Error('cleanup failed'),
    );

    await expect(service.cleanupNotifications()).resolves.toBeUndefined();
  });
});
