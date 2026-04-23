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
import { MfaService } from './services/mfa.service';
import { AuthUser } from '../../common/decorators/auth-user.decorator';
import { AuthWorkspace } from '../../common/decorators/auth-workspace.decorator';
import { User, Workspace } from '@docmost/db/types/entity.types';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { TokenService } from '../../core/auth/services/token.service';
import { JwtService } from '@nestjs/jwt';
import { JwtMfaTokenPayload, JwtType } from '../../core/auth/dto/jwt-payload';
import { FastifyReply, FastifyRequest } from 'fastify';
import { EnvironmentService } from '../../integrations/environment/environment.service';

@Controller('mfa')
export class MfaController {
  constructor(
    private mfaService: MfaService,
    private tokenService: TokenService,
    private jwtService: JwtService,
    private environmentService: EnvironmentService,
  ) {}

  @UseGuards(JwtAuthGuard)
  @HttpCode(HttpStatus.OK)
  @Post('status')
  async getStatus(
    @AuthUser() user: User,
    @AuthWorkspace() workspace: Workspace,
  ) {
    return this.mfaService.getMfaStatus(user.id, workspace.id);
  }

  @UseGuards(JwtAuthGuard)
  @HttpCode(HttpStatus.OK)
  @Post('setup')
  async setup(
    @AuthUser() user: User,
    @AuthWorkspace() workspace: Workspace,
    @Body() body: { method: string },
  ) {
    return this.mfaService.setupMfa(user.id, workspace.id, body.method || 'totp');
  }

  @UseGuards(JwtAuthGuard)
  @HttpCode(HttpStatus.OK)
  @Post('enable')
  async enable(
    @AuthUser() user: User,
    @AuthWorkspace() workspace: Workspace,
    @Body() body: { secret: string; verificationCode: string },
  ) {
    return this.mfaService.enableMfa(
      user.id,
      workspace.id,
      body.secret,
      body.verificationCode,
    );
  }

  @UseGuards(JwtAuthGuard)
  @HttpCode(HttpStatus.OK)
  @Post('disable')
  async disable(
    @AuthUser() user: User,
    @AuthWorkspace() workspace: Workspace,
  ) {
    return this.mfaService.disableMfa(user.id, workspace.id);
  }

  @UseGuards(JwtAuthGuard)
  @HttpCode(HttpStatus.OK)
  @Post('generate-backup-codes')
  async generateBackupCodes(
    @AuthUser() user: User,
    @AuthWorkspace() workspace: Workspace,
  ) {
    return this.mfaService.regenerateBackupCodes(user.id, workspace.id);
  }

  @HttpCode(HttpStatus.OK)
  @Post('verify')
  async verify(
    @Body() body: { code: string },
    @Req() req: FastifyRequest,
    @Res({ passthrough: true }) res: FastifyReply,
  ) {
    // Read MFA token from cookie
    const mfaToken = (req.cookies as any)?.mfaToken;
    if (!mfaToken) {
      return { error: 'MFA token missing' };
    }

    let payload: JwtMfaTokenPayload;
    try {
      payload = this.jwtService.verify<JwtMfaTokenPayload>(mfaToken);
      if (payload.type !== JwtType.MFA_TOKEN) {
        return { error: 'Invalid MFA token' };
      }
    } catch {
      return { error: 'MFA token expired' };
    }

    const authToken = await this.mfaService.verifyMfa(
      payload.sub,
      payload.workspaceId,
      body.code,
    );

    // Clear MFA cookie and set auth cookie
    res.clearCookie('mfaToken');
    res.setCookie('authToken', authToken, {
      httpOnly: true,
      sameSite: 'lax',
      path: '/',
      expires: this.environmentService.getCookieExpiresIn(),
      secure: this.environmentService.isHttps(),
    });
  }

  @HttpCode(HttpStatus.OK)
  @Post('validate-access')
  async validateAccess(
    @Req() req: FastifyRequest,
  ) {
    const mfaToken = (req.cookies as any)?.mfaToken;
    if (!mfaToken) {
      return { valid: false };
    }

    let payload: JwtMfaTokenPayload;
    try {
      payload = this.jwtService.verify<JwtMfaTokenPayload>(mfaToken);
      if (payload.type !== JwtType.MFA_TOKEN) {
        return { valid: false };
      }
    } catch {
      return { valid: false };
    }

    return this.mfaService.validateMfaAccess(payload.sub, payload.workspaceId);
  }
}
