import { Test, TestingModule } from '@nestjs/testing';
import { SearchController } from './search.controller';
import {
  THROTTLER_LIMIT,
  THROTTLER_TTL,
} from '@nestjs/throttler/dist/throttler.constants';
import { DIRECTORY_THROTTLER } from '../../integrations/throttle/throttler-names';
import { GUARDS_METADATA } from '@nestjs/common/constants';
import { DirectoryThrottlerGuard } from '../../integrations/throttle/directory-throttler.guard';

describe('SearchController', () => {
  let controller: SearchController;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [SearchController],
    })
      .useMocker(() => ({}))
      .compile();

    controller = module.get<SearchController>(SearchController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  it('applies the dedicated directory enumeration limit', () => {
    expect(
      Reflect.getMetadata(GUARDS_METADATA, controller.searchSuggestions),
    ).toContain(DirectoryThrottlerGuard);
    expect(
      Reflect.getMetadata(
        THROTTLER_LIMIT + DIRECTORY_THROTTLER,
        controller.searchSuggestions,
      ),
    ).toBe(120);
    expect(
      Reflect.getMetadata(
        THROTTLER_TTL + DIRECTORY_THROTTLER,
        controller.searchSuggestions,
      ),
    ).toBe(60_000);
  });
});
