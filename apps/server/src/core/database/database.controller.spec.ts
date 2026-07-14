import { GUARDS_METADATA } from '@nestjs/common/constants';
import { IS_PUBLIC_KEY } from '../../common/decorators/public.decorator';
import { API_KEY_SCOPES_KEY } from '../../common/decorators/api-key-scope.decorator';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { ApiKeyScope } from '../api-key/api-key-scopes';
import { DatabaseController } from './database.controller';

describe('DatabaseController authorization', () => {
  it('requires JWT authentication for every database endpoint', () => {
    expect(Reflect.getMetadata(GUARDS_METADATA, DatabaseController)).toContain(
      JwtAuthGuard,
    );
    expect(Reflect.getMetadata(IS_PUBLIC_KEY, DatabaseController)).not.toBe(
      true,
    );
  });

  it.each(['info', 'listRecords', 'embedUrl'] as const)(
    'does not expose %s as a public-share endpoint',
    (method) => {
      const handler = DatabaseController.prototype[method];
      expect(Reflect.getMetadata(IS_PUBLIC_KEY, handler)).not.toBe(true);
      expect(Reflect.getMetadata(API_KEY_SCOPES_KEY, handler)).toEqual([
        ApiKeyScope.REST_READ,
      ]);
    },
  );
});
