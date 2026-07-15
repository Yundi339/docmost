import { Reflector } from '@nestjs/core';
import type { ThrottlerModuleOptions } from '@nestjs/throttler';
import { DirectoryThrottlerGuard } from './directory-throttler.guard';
import {
  AUTH_THROTTLER,
  DIRECTORY_THROTTLER,
  FORGOT_PASSWORD_THROTTLER,
} from './throttler-names';

class TestDirectoryThrottlerGuard extends DirectoryThrottlerGuard {
  names() {
    return this.throttlers.map((throttler) => throttler.name);
  }
}

function createGuard(throttlers: ThrottlerModuleOptions) {
  return new TestDirectoryThrottlerGuard(
    throttlers,
    {} as never,
    new Reflector(),
  );
}

describe('DirectoryThrottlerGuard', () => {
  it('runs only the directory limiter', async () => {
    const guard = createGuard([
      { name: AUTH_THROTTLER, ttl: 60_000, limit: 10 },
      { name: FORGOT_PASSWORD_THROTTLER, ttl: 300_000, limit: 3 },
      { name: DIRECTORY_THROTTLER, ttl: 60_000, limit: 120 },
    ]);

    await guard.onModuleInit();

    expect(guard.names()).toEqual([DIRECTORY_THROTTLER]);
  });

  it('fails closed when the directory limiter is missing', async () => {
    const guard = createGuard([
      { name: AUTH_THROTTLER, ttl: 60_000, limit: 10 },
    ]);

    await expect(guard.onModuleInit()).rejects.toThrow(
      'Directory throttler is not configured',
    );
  });
});
