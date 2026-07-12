import { GUARDS_METADATA } from '@nestjs/common/constants';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { SessionAuthGuard } from '../../common/guards/session-auth.guard';
import { PasskeyController } from './passkey.controller';

describe('PasskeyController authorization', () => {
  for (const method of [
    'list',
    'registrationOptions',
    'registrationVerify',
    'update',
    'delete',
  ] as const) {
    it(`${method} requires both JWT and user-session guards`, () => {
      const guards = Reflect.getMetadata(
        GUARDS_METADATA,
        PasskeyController.prototype[method],
      );
      expect(guards).toEqual(
        expect.arrayContaining([JwtAuthGuard, SessionAuthGuard]),
      );
    });
  }
});
