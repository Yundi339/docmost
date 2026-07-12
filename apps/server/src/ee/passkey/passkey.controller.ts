import {
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Post,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import { FastifyReply, FastifyRequest } from 'fastify';
import { SkipThrottle, Throttle, ThrottlerGuard } from '@nestjs/throttler';
import { AuthUser } from '../../common/decorators/auth-user.decorator';
import { AuthWorkspace } from '../../common/decorators/auth-workspace.decorator';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { SessionAuthGuard } from '../../common/guards/session-auth.guard';
import { User, Workspace } from '@docmost/db/types/entity.types';
import { AuthCookieService } from '../../core/auth/services/auth-cookie.service';
import {
  AI_CHAT_THROTTLER,
  AUTH_THROTTLER,
  FORGOT_PASSWORD_THROTTLER,
  OAUTH_REGISTRATION_THROTTLER,
  OAUTH_TOKEN_THROTTLER,
} from '../../integrations/throttle/throttler-names';
import { PasskeyService } from './passkey.service';
import {
  DeletePasskeyDto,
  PasskeyAuthenticationVerifyDto,
  PasskeyRegistrationOptionsDto,
  PasskeyRegistrationVerifyDto,
  UpdatePasskeyDto,
} from './dto/passkey.dto';

@SkipThrottle({
  [AI_CHAT_THROTTLER]: true,
  [FORGOT_PASSWORD_THROTTLER]: true,
  [OAUTH_REGISTRATION_THROTTLER]: true,
  [OAUTH_TOKEN_THROTTLER]: true,
})
@UseGuards(ThrottlerGuard)
@Controller()
export class PasskeyController {
  constructor(
    private readonly passkeyService: PasskeyService,
    private readonly authCookieService: AuthCookieService,
  ) {}

  @HttpCode(HttpStatus.OK)
  @Throttle({ [AUTH_THROTTLER]: { ttl: 60_000, limit: 20 } })
  @Post('auth/passkeys/status')
  status(@AuthWorkspace() workspace: Workspace) {
    return this.passkeyService.getStatus(workspace);
  }

  @HttpCode(HttpStatus.OK)
  @Throttle({ [AUTH_THROTTLER]: { ttl: 60_000, limit: 10 } })
  @Post('auth/passkeys/authentication/options')
  async authenticationOptions(@AuthWorkspace() workspace: Workspace) {
    return this.passkeyService.createAuthenticationOptions(workspace);
  }

  @HttpCode(HttpStatus.OK)
  @Throttle({ [AUTH_THROTTLER]: { ttl: 60_000, limit: 10 } })
  @Post('auth/passkeys/authentication/verify')
  async authenticationVerify(
    @Body() dto: PasskeyAuthenticationVerifyDto,
    @AuthWorkspace() workspace: Workspace,
    @Res({ passthrough: true }) reply: FastifyReply,
  ) {
    const result = await this.passkeyService.verifyAuthentication(
      dto,
      workspace,
    );
    reply.header('Cache-Control', 'no-store');
    if (result.mfaToken) {
      this.authCookieService.setMfaCookie(reply, result.mfaToken);
      return {
        userHasMfa: result.userHasMfa,
        requiresMfaSetup: result.requiresMfaSetup,
        isMfaEnforced: result.isMfaEnforced,
      };
    }
    this.authCookieService.setAuthCookie(reply, result.authToken);
  }

  @UseGuards(JwtAuthGuard, SessionAuthGuard)
  @HttpCode(HttpStatus.OK)
  @Post('passkeys/list')
  list(@AuthUser() user: User, @AuthWorkspace() workspace: Workspace) {
    return this.passkeyService.list(user, workspace);
  }

  @UseGuards(JwtAuthGuard, SessionAuthGuard)
  @HttpCode(HttpStatus.OK)
  @Post('passkeys/registration/options')
  registrationOptions(
    @Body() dto: PasskeyRegistrationOptionsDto,
    @AuthUser() user: User,
    @AuthWorkspace() workspace: Workspace,
    @Req() request: FastifyRequest,
  ) {
    return this.passkeyService.createRegistrationOptions(
      dto,
      user,
      workspace,
      (request.raw as any).sessionId,
    );
  }

  @UseGuards(JwtAuthGuard, SessionAuthGuard)
  @HttpCode(HttpStatus.OK)
  @Post('passkeys/registration/verify')
  registrationVerify(
    @Body() dto: PasskeyRegistrationVerifyDto,
    @AuthUser() user: User,
    @AuthWorkspace() workspace: Workspace,
    @Req() request: FastifyRequest,
  ) {
    return this.passkeyService.verifyRegistration(
      dto,
      user,
      workspace,
      (request.raw as any).sessionId,
    );
  }

  @UseGuards(JwtAuthGuard, SessionAuthGuard)
  @HttpCode(HttpStatus.OK)
  @Post('passkeys/update')
  update(
    @Body() dto: UpdatePasskeyDto,
    @AuthUser() user: User,
    @AuthWorkspace() workspace: Workspace,
  ) {
    return this.passkeyService.rename(dto, user, workspace);
  }

  @UseGuards(JwtAuthGuard, SessionAuthGuard)
  @HttpCode(HttpStatus.NO_CONTENT)
  @Post('passkeys/delete')
  delete(
    @Body() dto: DeletePasskeyDto,
    @AuthUser() user: User,
    @AuthWorkspace() workspace: Workspace,
  ) {
    return this.passkeyService.delete(dto, user, workspace);
  }
}
