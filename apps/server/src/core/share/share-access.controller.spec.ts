import { BadRequestException } from '@nestjs/common';
import { THROTTLER_LIMIT, THROTTLER_TTL } from '@nestjs/throttler/dist/throttler.constants';
import { ShareAccessController } from './share-access.controller';
import { SHARE_UNLOCK_THROTTLER } from '../../integrations/throttle/throttler-names';

describe('ShareAccessController', () => {
  const shareAccessService = { unlock: jest.fn() };
  const controller = new ShareAccessController(shareAccessService as any);

  beforeEach(() => jest.clearAllMocks());

  it('applies the dedicated brute-force limit', () => {
    expect(
      Reflect.getMetadata(
        THROTTLER_LIMIT + SHARE_UNLOCK_THROTTLER,
        controller.unlock,
      ),
    ).toBe(10);
    expect(
      Reflect.getMetadata(
        THROTTLER_TTL + SHARE_UNLOCK_THROTTLER,
        controller.unlock,
      ),
    ).toBe(60_000);
  });

  it('requires exactly one share locator', async () => {
    await expect(
      controller.unlock(
        { password: 'password', shareId: 'share', pageId: 'page' },
        {} as any,
        {} as any,
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(shareAccessService.unlock).not.toHaveBeenCalled();
  });
});
