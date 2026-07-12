import { PasskeySecurityNotificationService } from './passkey-security-notification.service';

describe('PasskeySecurityNotificationService', () => {
  const user = {
    email: 'user@example.com',
    name: 'Test User',
  } as any;

  it('queues a non-actionable security notice with request context', async () => {
    const mailService = { sendToQueue: jest.fn() };
    const cls = {
      get: jest.fn().mockReturnValue({
        ipAddress: '203.0.113.10',
        userAgent: 'Mozilla/5.0 (Windows NT 10.0) AppleWebKit Chrome/126.0',
      }),
    };
    const service = new PasskeySecurityNotificationService(
      mailService as any,
      cls as any,
    );

    await service.notify(user, 'added', 'Work laptop');

    const message = mailService.sendToQueue.mock.calls[0][0];
    expect(message).toMatchObject({
      to: user.email,
      subject: 'Passkey added on your Docmost account',
    });
    const text = JSON.stringify(message.template);
    expect(text).toContain('Work laptop');
    expect(text).toContain('203.0.113.10');
    expect(text).toContain('Chrome on Windows');
    expect(text).not.toMatch(/credential|challenge|signature|public key/i);
    expect(text).not.toContain('http://');
    expect(text).not.toContain('https://');
  });

  it('does not fail a completed credential change when mail queueing fails', async () => {
    const mailService = {
      sendToQueue: jest.fn().mockRejectedValue(new Error('queue unavailable')),
    };
    const service = new PasskeySecurityNotificationService(
      mailService as any,
      { get: jest.fn() } as any,
    );

    await expect(
      service.notify(user, 'removed', 'Security key'),
    ).resolves.toBeUndefined();
  });
});
