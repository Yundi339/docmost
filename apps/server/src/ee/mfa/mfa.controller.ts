import {
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Post,
  Req,
  Res,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';
import { MfaService } from './services/mfa.service';
import { AuthUser } from '../../common/decorators/auth-user.decorator';
import { AuthWorkspace } from '../../common/decorators/auth-workspace.decorator';
import { User, Workspace } from '@docmost/db/types/entity.types';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { JwtService } from '@nestjs/jwt';
import { JwtMfaTokenPayload, JwtType } from '../../core/auth/dto/jwt-payload';
import { FastifyReply, FastifyRequest } from 'fastify';
import { SessionAuthGuard } from '../../common/guards/session-auth.guard';
import { AuthCookieService } from '../../core/auth/services/auth-cookie.service';
import { SkipThrottle, Throttle, ThrottlerGuard } from '@nestjs/throttler';
import {
  AI_CHAT_THROTTLER,
  AUTH_THROTTLER,
  FORGOT_PASSWORD_THROTTLER,
  OAUTH_REGISTRATION_THROTTLER,
  OAUTH_TOKEN_THROTTLER,
  SHARE_UNLOCK_THROTTLER,
} from '../../integrations/throttle/throttler-names';
import {
  EnableMfaDto,
  MfaPasswordStepUpDto,
  SetupMfaDto,
  VerifyMfaDto,
} from './dto/mfa.dto';

@SkipThrottle({
  [AI_CHAT_THROTTLER]: true,
  [FORGOT_PASSWORD_THROTTLER]: true,
  [OAUTH_REGISTRATION_THROTTLER]: true,
  [OAUTH_TOKEN_THROTTLER]: true,
  [SHARE_UNLOCK_THROTTLER]: true,
})
@UseGuards(ThrottlerGuard)
@Controller('mfa')
export class MfaController {
  constructor(
    private mfaService: MfaService,
    private jwtService: JwtService,
    private authCookieService: AuthCookieService,
  ) {}

  @UseGuards(JwtAuthGuard, SessionAuthGuard)
  @HttpCode(HttpStatus.OK)
  @Post('status')
  async getStatus(
    @AuthUser() user: User,
    @AuthWorkspace() workspace: Workspace,
  ) {
    return this.mfaService.getMfaStatus(user.id, workspace.id);
  }

  @UseGuards(JwtAuthGuard, SessionAuthGuard)
  @HttpCode(HttpStatus.OK)
  @Post('setup')
  async setup(
    @AuthUser() user: User,
    @AuthWorkspace() workspace: Workspace,
    @Body() body: SetupMfaDto,
  ) {
    return this.mfaService.setupMfa(
      user.id,
      workspace.id,
      body.method || 'totp',
    );
  }

  @UseGuards(JwtAuthGuard, SessionAuthGuard)
  @HttpCode(HttpStatus.OK)
  @Post('enable')
  async enable(
    @AuthUser() user: User,
    @AuthWorkspace() workspace: Workspace,
    @Body() body: EnableMfaDto,
  ) {
    return this.mfaService.enableMfa(
      user.id,
      workspace.id,
      body.secret,
      body.verificationCode,
    );
  }

  @UseGuards(JwtAuthGuard, SessionAuthGuard)
  @HttpCode(HttpStatus.OK)
  @Post('disable')
  async disable(
    @AuthUser() user: User,
    @AuthWorkspace() workspace: Workspace,
    @Body() body: MfaPasswordStepUpDto,
  ) {
    return this.mfaService.disableMfa(
      user.id,
      workspace.id,
      body.confirmPassword,
    );
  }

  @UseGuards(JwtAuthGuard, SessionAuthGuard)
  @HttpCode(HttpStatus.OK)
  @Post('generate-backup-codes')
  async generateBackupCodes(
    @AuthUser() user: User,
    @AuthWorkspace() workspace: Workspace,
    @Body() body: MfaPasswordStepUpDto,
  ) {
    return this.mfaService.regenerateBackupCodes(
      user.id,
      workspace.id,
      body.confirmPassword,
    );
  }

  @HttpCode(HttpStatus.OK)
  @Throttle({ [AUTH_THROTTLER]: { ttl: 60_000, limit: 10 } })
  @Post('pending/setup')
  async setupPending(@Req() req: FastifyRequest, @Body() body: SetupMfaDto) {
    const payload = this.getMfaPayload(req);
    await this.mfaService.assertPendingSetupAllowed(
      payload.sub,
      payload.workspaceId,
    );
    return this.mfaService.setupMfa(
      payload.sub,
      payload.workspaceId,
      body.method || 'totp',
    );
  }

  @HttpCode(HttpStatus.OK)
  @Throttle({ [AUTH_THROTTLER]: { ttl: 60_000, limit: 10 } })
  @Post('pending/enable')
  async enablePending(
    @Req() req: FastifyRequest,
    @Res({ passthrough: true }) res: FastifyReply,
    @Body() body: EnableMfaDto,
  ) {
    const payload = this.getMfaPayload(req);
    await this.mfaService.assertPendingSetupAllowed(
      payload.sub,
      payload.workspaceId,
    );
    const result = await this.mfaService.enableMfa(
      payload.sub,
      payload.workspaceId,
      body.secret,
      body.verificationCode,
    );
    this.authCookieService.clearMfaCookie(res);
    return result;
  }

  @HttpCode(HttpStatus.OK)
  @Throttle({ [AUTH_THROTTLER]: { ttl: 60_000, limit: 10 } })
  @Post('verify')
  async verify(
    @Body() body: VerifyMfaDto,
    @Req() req: FastifyRequest,
    @Res({ passthrough: true }) res: FastifyReply,
  ) {
    const payload = this.getMfaPayload(req);

    const authToken = await this.mfaService.verifyMfa(
      payload.sub,
      payload.workspaceId,
      body.code,
      {
        primaryAuth: payload.primaryAuth,
        passkeyId: payload.passkeyId,
        authTime: payload.authTime,
        tokenId: payload.jti,
        tokenExpiresAt: payload.exp,
      },
    );

    this.authCookieService.clearMfaCookie(res);
    this.authCookieService.setAuthCookie(res, authToken);
  }

  @HttpCode(HttpStatus.OK)
  @Post('validate-access')
  async validateAccess(@Req() req: FastifyRequest) {
    try {
      const payload = this.getMfaPayload(req);
      return this.mfaService.validateMfaAccess(
        payload.sub,
        payload.workspaceId,
      );
    } catch {
      return { valid: false };
    }
  }

  private getMfaPayload(req: FastifyRequest): JwtMfaTokenPayload {
    const token = (req.cookies as any)?.mfaToken;
    if (!token) {
      throw new UnauthorizedException('MFA token missing');
    }
    try {
      const payload = this.jwtService.verify<JwtMfaTokenPayload>(token);
      if (payload.type !== JwtType.MFA_TOKEN) {
        throw new UnauthorizedException('Invalid MFA token');
      }
      if (
        typeof payload.jti !== 'string' ||
        payload.jti.length < 16 ||
        payload.jti.length > 128 ||
        typeof payload.exp !== 'number' ||
        !Number.isSafeInteger(payload.exp)
      ) {
        throw new UnauthorizedException('Invalid MFA token');
      }
      return payload;
    } catch (error) {
      if (error instanceof UnauthorizedException) throw error;
      throw new UnauthorizedException('MFA token expired');
    }
  }
}
