import { Module } from '@nestjs/common';
import { AuthController } from './auth.controller';
import { AuthService } from './services/auth.service';
import { JwtStrategy } from './strategies/jwt.strategy';
import { WorkspaceModule } from '../workspace/workspace.module';
import { SignupService } from './services/signup.service';
import { TokenModule } from './token.module';
import { LoginFlowService } from './services/login-flow.service';
import { LoginAttemptService } from './services/login-attempt.service';
import { AuthCookieService } from './services/auth-cookie.service';

@Module({
  imports: [TokenModule, WorkspaceModule],
  controllers: [AuthController],
  providers: [
    AuthService,
    SignupService,
    JwtStrategy,
    LoginFlowService,
    LoginAttemptService,
    AuthCookieService,
  ],
  exports: [
    SignupService,
    AuthService,
    LoginFlowService,
    LoginAttemptService,
    AuthCookieService,
  ],
})
export class AuthModule {}
