import { UnauthorizedException } from '@nestjs/common';
import { MfaTokenConsumptionService } from './mfa-token-consumption.service';

describe('MfaTokenConsumptionService', () => {
  const redis = { set: jest.fn() };
  const service = new MfaTokenConsumptionService({
    getOrThrow: () => redis,
  } as any);

  beforeEach(() => {
    redis.set.mockReset();
  });

  it('atomically consumes a token identifier until its JWT expires', async () => {
    redis.set.mockResolvedValue('OK');
    const expiresAt = Math.floor(Date.now() / 1000) + 120;

    await expect(
      service.consume('token-id', expiresAt),
    ).resolves.toBeUndefined();

    expect(redis.set).toHaveBeenCalledWith(
      'auth:mfa-token-used:token-id',
      '1',
      'EX',
      expect.any(Number),
      'NX',
    );
    expect(redis.set.mock.calls[0][3]).toBeGreaterThan(0);
    expect(redis.set.mock.calls[0][3]).toBeLessThanOrEqual(120);
  });

  it('rejects a token that another request already consumed', async () => {
    redis.set.mockResolvedValue(null);

    await expect(
      service.consume('token-id', Math.floor(Date.now() / 1000) + 120),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('rejects invalid or expired token claims without touching Redis', async () => {
    await expect(service.consume('', 0)).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
    await expect(
      service.consume('token-id', Math.floor(Date.now() / 1000) - 1),
    ).rejects.toBeInstanceOf(UnauthorizedException);
    expect(redis.set).not.toHaveBeenCalled();
  });
});
