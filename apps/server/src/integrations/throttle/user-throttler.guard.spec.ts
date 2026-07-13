import { Reflector } from '@nestjs/core';

import { UserThrottlerGuard } from './user-throttler.guard';

class TestUserThrottlerGuard extends UserThrottlerGuard {
  tracker(request: Record<string, any>) {
    return this.getTracker(request);
  }
}

describe('UserThrottlerGuard', () => {
  const guard = new TestUserThrottlerGuard([], {} as any, new Reflector());

  it('uses the authenticated user id instead of the request IP', async () => {
    await expect(
      guard.tracker({ user: { id: 'user-id' }, ip: '192.0.2.10' }),
    ).resolves.toBe('user:user-id');
    await expect(
      guard.tracker({ user: { id: 'user-id' }, ip: '192.0.2.11' }),
    ).resolves.toBe('user:user-id');
    await expect(
      guard.tracker({ user: { id: 'other-user-id' }, ip: '192.0.2.10' }),
    ).resolves.toBe('user:other-user-id');
  });

  it('falls back to the request IP without an authenticated user', async () => {
    await expect(guard.tracker({ ip: '192.0.2.20' })).resolves.toBe(
      '192.0.2.20',
    );
  });
});
