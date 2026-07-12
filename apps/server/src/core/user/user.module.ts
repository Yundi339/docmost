import { Module } from '@nestjs/common';
import { UserService } from './user.service';
import { UserController } from './user.controller';
import { UserRepo } from '@docmost/db/repos/user/user.repo';
import { EmailChangeService } from './email-change.service';

@Module({
  controllers: [UserController],
  providers: [UserService, UserRepo, EmailChangeService],
  exports: [UserService, UserRepo],
})
export class UserModule {}
