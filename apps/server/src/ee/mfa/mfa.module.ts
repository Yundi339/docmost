import { Module } from '@nestjs/common';
import { MfaService } from './services/mfa.service';
import { MfaController } from './mfa.controller';
import { JwtModule } from '@nestjs/jwt';
import { EnvironmentService } from '../../integrations/environment/environment.service';
import { TokenModule } from '../../core/auth/token.module';
import { AuthModule } from '../../core/auth/auth.module';
import { SessionModule } from '../../core/session/session.module';
import { UserModule } from '../../core/user/user.module';

@Module({
  imports: [
    JwtModule.registerAsync({
      inject: [EnvironmentService],
      useFactory: (environmentService: EnvironmentService) => ({
        secret: environmentService.getAppSecret(),
      }),
    }),
    TokenModule,
    AuthModule,
    SessionModule,
    UserModule,
  ],
  controllers: [MfaController],
  providers: [MfaService],
  exports: [MfaService],
})
export class MfaModule {}
