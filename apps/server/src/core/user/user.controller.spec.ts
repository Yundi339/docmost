import { Test, TestingModule } from '@nestjs/testing';
import { UserController } from './user.controller';
import { UserService } from './user.service';
import { GUARDS_METADATA } from '@nestjs/common/constants';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { SessionAuthGuard } from '../../common/guards/session-auth.guard';
import { ThrottlerGuard } from '@nestjs/throttler';

describe('UserController', () => {
  let controller: UserController;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [UserController],
      providers: [UserService],
    })
      .useMocker(() => ({}))
      .compile();

    controller = module.get<UserController>(UserController);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  it.each(['requestEmailChange', 'confirmEmailChange'] as const)(
    '%s requires JWT authentication and a user session',
    (method) => {
      const controllerGuards = Reflect.getMetadata(
        GUARDS_METADATA,
        UserController,
      );
      const methodGuards = Reflect.getMetadata(
        GUARDS_METADATA,
        UserController.prototype[method],
      );

      expect(controllerGuards).toContain(JwtAuthGuard);
      expect(methodGuards).toEqual(
        expect.arrayContaining([SessionAuthGuard, ThrottlerGuard]),
      );
    },
  );
});
