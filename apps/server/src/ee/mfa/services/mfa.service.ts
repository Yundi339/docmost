import {
  BadRequestException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { InjectKysely } from 'nestjs-kysely';
import { KyselyDB } from '@docmost/db/types/kysely.types';
import { TokenService } from '../../../core/auth/services/token.service';
import { AuthService } from '../../../core/auth/services/auth.service';
import { SessionService } from '../../../core/session/session.service';
import { UserRepo } from '@docmost/db/repos/user/user.repo';
import { EnvironmentService } from '../../../integrations/environment/environment.service';
import { User, Workspace } from '@docmost/db/types/entity.types';
import { LoginDto } from '../../../core/auth/dto/login.dto';
import { comparePasswordHash, isUserDisabled } from '../../../common/helpers';
import { FastifyReply } from 'fastify';
import * as crypto from 'crypto';
import * as QRCode from 'qrcode';

// Use dynamic import for otpauth ESM module
let OTPAuth: any;

async function getOTPAuth() {
  if (!OTPAuth) {
    OTPAuth = await import('otpauth');
  }
  return OTPAuth;
}

@Injectable()
export class MfaService {
  constructor(
    @InjectKysely() private readonly db: KyselyDB,
    private tokenService: TokenService,
    private authService: AuthService,
    private sessionService: SessionService,
    private userRepo: UserRepo,
    private environmentService: EnvironmentService,
  ) {}

  async checkMfaRequirements(
    loginDto: LoginDto,
    workspace: Workspace,
    res: FastifyReply,
  ): Promise<any> {
    const user = await this.userRepo.findByEmail(
      loginDto.email,
      workspace.id,
      { includePassword: true },
    );

    if (!user || isUserDisabled(user)) {
      throw new UnauthorizedException('Email or password does not match');
    }

    const isPasswordMatch = await comparePasswordHash(
      loginDto.password,
      user.password,
    );

    if (!isPasswordMatch) {
      throw new UnauthorizedException('Email or password does not match');
    }

    const mfaRecord = await this.db
      .selectFrom('userMfa')
      .selectAll()
      .where('userId', '=', user.id)
      .where('workspaceId', '=', workspace.id)
      .executeTakeFirst();

    const userHasMfa = mfaRecord?.isEnabled === true;
    const isMfaEnforced = workspace.enforceMfa === true;

    if (userHasMfa || isMfaEnforced) {
      const mfaToken = await this.tokenService.generateMfaToken(
        user,
        workspace.id,
      );

      res.setCookie('mfaToken', mfaToken, {
        httpOnly: true,
        sameSite: 'lax',
        path: '/',
        maxAge: 300,
      });

      return {
        userHasMfa,
        requiresMfaSetup: isMfaEnforced && !userHasMfa,
        isMfaEnforced,
      };
    }

    // No MFA required — proceed with normal login
    const authToken = await this.authService.login(loginDto, workspace.id);
    return { authToken };
  }

  async getMfaStatus(
    userId: string,
    workspaceId: string,
  ): Promise<{
    isEnabled: boolean;
    method: string | null;
    backupCodesCount: number;
  }> {
    const mfaRecord = await this.db
      .selectFrom('userMfa')
      .selectAll()
      .where('userId', '=', userId)
      .where('workspaceId', '=', workspaceId)
      .executeTakeFirst();

    return {
      isEnabled: mfaRecord?.isEnabled === true,
      method: mfaRecord?.method ?? null,
      backupCodesCount: mfaRecord?.backupCodes?.length ?? 0,
    };
  }

  async setupMfa(
    userId: string,
    workspaceId: string,
    method: string,
  ): Promise<{ method: string; qrCode: string; secret: string; manualKey: string }> {
    const user = await this.userRepo.findById(userId, workspaceId);
    if (!user) throw new BadRequestException('User not found');

    const otpauth = await getOTPAuth();
    const secret = new otpauth.Secret({ size: 20 });

    const totp = new otpauth.TOTP({
      issuer: 'Docmost',
      label: user.email,
      algorithm: 'SHA1',
      digits: 6,
      period: 30,
      secret,
    });

    const uri = totp.toString();
    const secretBase32 = secret.base32;

    // Store secret (not yet enabled)
    const existing = await this.db
      .selectFrom('userMfa')
      .select('id')
      .where('userId', '=', userId)
      .where('workspaceId', '=', workspaceId)
      .executeTakeFirst();

    if (existing) {
      await this.db
        .updateTable('userMfa')
        .set({ secret: secretBase32, method, updatedAt: new Date() })
        .where('id', '=', existing.id)
        .execute();
    } else {
      await this.db
        .insertInto('userMfa')
        .values({
          userId,
          workspaceId,
          secret: secretBase32,
          method,
          isEnabled: false,
        })
        .execute();
    }

    const qrCodeDataUrl = await QRCode.toDataURL(uri);

    return {
      method,
      qrCode: qrCodeDataUrl,
      secret: secretBase32,
      manualKey: secretBase32,
    };
  }

  async enableMfa(
    userId: string,
    workspaceId: string,
    secret: string,
    verificationCode: string,
  ): Promise<{ success: boolean; backupCodes: string[] }> {
    const otpauth = await getOTPAuth();

    const totp = new otpauth.TOTP({
      algorithm: 'SHA1',
      digits: 6,
      period: 30,
      secret: otpauth.Secret.fromBase32(secret),
    });

    const delta = totp.validate({ token: verificationCode, window: 1 });
    if (delta === null) {
      throw new BadRequestException('Invalid verification code');
    }

    const backupCodes = this.generateBackupCodes();

    await this.db
      .updateTable('userMfa')
      .set({
        isEnabled: true,
        secret,
        backupCodes,
        updatedAt: new Date(),
      })
      .where('userId', '=', userId)
      .where('workspaceId', '=', workspaceId)
      .execute();

    return { success: true, backupCodes };
  }

  async disableMfa(
    userId: string,
    workspaceId: string,
  ): Promise<{ success: boolean }> {
    await this.db
      .updateTable('userMfa')
      .set({
        isEnabled: false,
        secret: null,
        backupCodes: null,
        updatedAt: new Date(),
      })
      .where('userId', '=', userId)
      .where('workspaceId', '=', workspaceId)
      .execute();

    return { success: true };
  }

  async regenerateBackupCodes(
    userId: string,
    workspaceId: string,
  ): Promise<{ backupCodes: string[] }> {
    const mfaRecord = await this.db
      .selectFrom('userMfa')
      .selectAll()
      .where('userId', '=', userId)
      .where('workspaceId', '=', workspaceId)
      .executeTakeFirst();

    if (!mfaRecord?.isEnabled) {
      throw new BadRequestException('MFA is not enabled');
    }

    const backupCodes = this.generateBackupCodes();

    await this.db
      .updateTable('userMfa')
      .set({ backupCodes, updatedAt: new Date() })
      .where('id', '=', mfaRecord.id)
      .execute();

    return { backupCodes };
  }

  async verifyMfa(
    userId: string,
    workspaceId: string,
    code: string,
  ): Promise<string> {
    const mfaRecord = await this.db
      .selectFrom('userMfa')
      .selectAll()
      .where('userId', '=', userId)
      .where('workspaceId', '=', workspaceId)
      .executeTakeFirst();

    if (!mfaRecord?.isEnabled || !mfaRecord.secret) {
      throw new BadRequestException('MFA is not enabled');
    }

    // Try TOTP first
    const otpauth = await getOTPAuth();
    const totp = new otpauth.TOTP({
      algorithm: 'SHA1',
      digits: 6,
      period: 30,
      secret: otpauth.Secret.fromBase32(mfaRecord.secret),
    });

    const delta = totp.validate({ token: code, window: 1 });
    if (delta !== null) {
      // TOTP valid — generate auth token
      const user = await this.userRepo.findById(userId, workspaceId);
      return this.sessionService.createSessionAndToken(user);
    }

    // Try backup code
    if (mfaRecord.backupCodes?.includes(code)) {
      const updatedCodes = mfaRecord.backupCodes.filter((c) => c !== code);
      await this.db
        .updateTable('userMfa')
        .set({ backupCodes: updatedCodes, updatedAt: new Date() })
        .where('id', '=', mfaRecord.id)
        .execute();

      const user = await this.userRepo.findById(userId, workspaceId);
      return this.sessionService.createSessionAndToken(user);
    }

    throw new UnauthorizedException('Invalid MFA code');
  }

  async validateMfaAccess(
    userId: string,
    workspaceId: string,
  ): Promise<{
    valid: boolean;
    isTransferToken: boolean;
    requiresMfaSetup: boolean;
    userHasMfa: boolean;
    isMfaEnforced: boolean;
  }> {
    const workspace = await this.db
      .selectFrom('workspaces')
      .select(['enforceMfa'])
      .where('id', '=', workspaceId)
      .executeTakeFirst();

    const mfaRecord = await this.db
      .selectFrom('userMfa')
      .select(['isEnabled'])
      .where('userId', '=', userId)
      .where('workspaceId', '=', workspaceId)
      .executeTakeFirst();

    return {
      valid: true,
      isTransferToken: false,
      requiresMfaSetup: workspace?.enforceMfa === true && !mfaRecord?.isEnabled,
      userHasMfa: mfaRecord?.isEnabled === true,
      isMfaEnforced: workspace?.enforceMfa === true,
    };
  }

  private generateBackupCodes(count = 10): string[] {
    return Array.from({ length: count }, () =>
      crypto.randomBytes(4).toString('hex'),
    );
  }
}
