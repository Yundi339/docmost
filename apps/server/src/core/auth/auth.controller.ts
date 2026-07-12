import {
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Inject,
  Post,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import { SkipThrottle, Throttle, ThrottlerGuard } from '@nestjs/throttler';
import {
  AI_CHAT_THROTTLER,
  AUTH_THROTTLER,
  FORGOT_PASSWORD_THROTTLER,
  OAUTH_REGISTRATION_THROTTLER,
  OAUTH_TOKEN_THROTTLER,
  SHARE_UNLOCK_THROTTLER,
} from '../../integrations/throttle/throttler-names';
import { LoginDto } from './dto/login.dto';
import { AuthService } from './services/auth.service';
import { SessionService } from '../session/session.service';
import { SetupGuard } from './guards/setup.guard';
import { EnvironmentService } from '../../integrations/environment/environment.service';
import { CreateAdminUserDto } from './dto/create-admin-user.dto';
import { ChangePasswordDto } from './dto/change-password.dto';
import { AuthUser } from '../../common/decorators/auth-user.decorator';
import { User, Workspace } from '@docmost/db/types/entity.types';
import { AuthWorkspace } from '../../common/decorators/auth-workspace.decorator';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { ForgotPasswordDto } from './dto/forgot-password.dto';
import { PasswordResetDto } from './dto/password-reset.dto';
import { VerifyUserTokenDto } from './dto/verify-user-token.dto';
import { FastifyReply, FastifyRequest } from 'fastify';
import { AuditEvent, AuditResource } from '../../common/events/audit-events';
import {
  AUDIT_SERVICE,
  IAuditService,
} from '../../integrations/audit/audit.service';
import { LoginFlowService } from './services/login-flow.service';
import { AuthCookieService } from './services/auth-cookie.service';
import { SsoEnforcementService } from './services/sso-enforcement.service';

@SkipThrottle({
  [AI_CHAT_THROTTLER]: true,
  [FORGOT_PASSWORD_THROTTLER]: true,
  [OAUTH_REGISTRATION_THROTTLER]: true,
  [OAUTH_TOKEN_THROTTLER]: true,
  [SHARE_UNLOCK_THROTTLER]: true,
})
@UseGuards(ThrottlerGuard)
@Controller('auth')
export class AuthController {
  constructor(
    private authService: AuthService,
    private sessionService: SessionService,
    private environmentService: EnvironmentService,
    private readonly loginFlowService: LoginFlowService,
    private readonly authCookieService: AuthCookieService,
    private readonly ssoEnforcement: SsoEnforcementService,
    @Inject(AUDIT_SERVICE) private readonly auditService: IAuditService,
  ) {}

  @HttpCode(HttpStatus.OK)
  @Post('login')
  async login(
    @AuthWorkspace() workspace: Workspace,
    @Res({ passthrough: true }) res: FastifyReply,
    @Body() loginInput: LoginDto,
  ) {
    const user = await this.authService.authenticatePassword(
      loginInput,
      workspace.id,
    );
    const result = await this.loginFlowService.begin(user, workspace, {
      primaryAuth: 'password',
      ownerRecovery: loginInput.ownerRecovery === true,
    });
    if (result.mfaToken) {
      this.authCookieService.setMfaCookie(res, result.mfaToken);
      return {
        userHasMfa: result.userHasMfa,
        requiresMfaSetup: result.requiresMfaSetup,
        isMfaEnforced: result.isMfaEnforced,
      };
    }
    this.authCookieService.setAuthCookie(res, result.authToken);
  }

  @UseGuards(SetupGuard)
  @HttpCode(HttpStatus.OK)
  @Post('setup')
  async setupWorkspace(
    @Res({ passthrough: true }) res: FastifyReply,
    @Body() createAdminUserDto: CreateAdminUserDto,
  ) {
    const { workspace, authToken } =
      await this.authService.setup(createAdminUserDto);

    this.setAuthCookie(res, authToken);
    return workspace;
  }

  @SkipThrottle({ [AUTH_THROTTLER]: true })
  @UseGuards(JwtAuthGuard)
  @HttpCode(HttpStatus.OK)
  @Post('change-password')
  async changePassword(
    @Body() dto: ChangePasswordDto,
    @AuthUser() user: User,
    @AuthWorkspace() workspace: Workspace,
    @Req() req: FastifyRequest,
  ) {
    const currentSessionId = (req.raw as any).sessionId;
    return this.authService.changePassword(
      dto,
      user.id,
      workspace.id,
      currentSessionId,
    );
  }

  @HttpCode(HttpStatus.OK)
  @Throttle({ [FORGOT_PASSWORD_THROTTLER]: { ttl: 300_000, limit: 3 } })
  @Post('forgot-password')
  async forgotPassword(
    @Body() forgotPasswordDto: ForgotPasswordDto,
    @AuthWorkspace() workspace: Workspace,
  ) {
    await this.ssoEnforcement.assertLocalAuthAllowed(workspace);
    return this.authService.forgotPassword(forgotPasswordDto, workspace);
  }

  @HttpCode(HttpStatus.OK)
  @Post('password-reset')
  async passwordReset(
    @Res({ passthrough: true }) res: FastifyReply,
    @Body() passwordResetDto: PasswordResetDto,
    @AuthWorkspace() workspace: Workspace,
  ) {
    await this.ssoEnforcement.assertLocalAuthAllowed(workspace);
    const result = await this.authService.passwordReset(
      passwordResetDto,
      workspace,
    );

    if (result.requiresLogin) {
      return {
        requiresLogin: true,
      };
    }

    // Set auth cookie if no MFA is required
    this.setAuthCookie(res, result.authToken);
    return {
      requiresLogin: false,
    };
  }

  @HttpCode(HttpStatus.OK)
  @Post('verify-token')
  async verifyResetToken(
    @Body() verifyUserTokenDto: VerifyUserTokenDto,
    @AuthWorkspace() workspace: Workspace,
  ) {
    return this.authService.verifyUserToken(verifyUserTokenDto, workspace.id);
  }

  @SkipThrottle({ [AUTH_THROTTLER]: true, [FORGOT_PASSWORD_THROTTLER]: true })
  @UseGuards(JwtAuthGuard)
  @HttpCode(HttpStatus.OK)
  @Post('collab-token')
  async collabToken(
    @AuthUser() user: User,
    @AuthWorkspace() workspace: Workspace,
  ) {
    return this.authService.getCollabToken(user, workspace.id);
  }

  @SkipThrottle({ [AUTH_THROTTLER]: true })
  @UseGuards(JwtAuthGuard)
  @HttpCode(HttpStatus.OK)
  @Post('logout')
  async logout(
    @AuthUser() user: User,
    @Req() req: FastifyRequest,
    @Res({ passthrough: true }) res: FastifyReply,
  ) {
    const sessionId = (req.raw as any).sessionId;
    if (sessionId) {
      await this.sessionService.revokeSession(
        sessionId,
        user.id,
        user.workspaceId,
      );
    }

    res.clearCookie('authToken');
    this.authCookieService.clearMfaCookie(res);

    this.auditService.log({
      event: AuditEvent.USER_LOGOUT,
      resourceType: AuditResource.USER,
      resourceId: user.id,
    });
  }

  setAuthCookie(res: FastifyReply, token: string) {
    this.authCookieService.setAuthCookie(res, token);
  }
}
