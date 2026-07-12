import { Module } from '@nestjs/common';
import { AuthModule } from '../../core/auth/auth.module';
import { PasskeyController } from './passkey.controller';
import { PasskeyOriginService } from './passkey-origin.service';
import { PasskeyService } from './passkey.service';
import { PasskeySecurityNotificationService } from './passkey-security-notification.service';

@Module({
  imports: [AuthModule],
  controllers: [PasskeyController],
  providers: [
    PasskeyOriginService,
    PasskeyService,
    PasskeySecurityNotificationService,
  ],
  exports: [PasskeyOriginService],
})
export class PasskeyModule {}
