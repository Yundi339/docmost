import { Injectable, UnauthorizedException } from '@nestjs/common';
import { RedisService } from '@nestjs-labs/nestjs-ioredis';
import type { Redis } from 'ioredis';

const MFA_TOKEN_KEY_PREFIX = 'auth:mfa-token-used:';
const MAX_MFA_TOKEN_TTL_SECONDS = 5 * 60;

@Injectable()
export class MfaTokenConsumptionService {
  private readonly redis: Redis;

  constructor(private readonly redisService: RedisService) {
    this.redis = redisService.getOrThrow();
  }

  async consume(tokenId: string, expiresAt: number): Promise<void> {
    if (!tokenId || tokenId.length > 128 || !Number.isSafeInteger(expiresAt)) {
      throw new UnauthorizedException('Invalid MFA token');
    }

    const remainingSeconds = expiresAt - Math.floor(Date.now() / 1000);
    if (remainingSeconds <= 0) {
      throw new UnauthorizedException('MFA token expired');
    }

    const result = await this.redis.set(
      MFA_TOKEN_KEY_PREFIX + tokenId,
      '1',
      'EX',
      Math.min(remainingSeconds, MAX_MFA_TOKEN_TTL_SECONDS),
      'NX',
    );
    if (result !== 'OK') {
      throw new UnauthorizedException('MFA token has already been used');
    }
  }
}
