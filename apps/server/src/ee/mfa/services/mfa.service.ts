import {
  BadRequestException,
  Inject,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { InjectKysely } from 'nestjs-kysely';
import { KyselyDB } from '@docmost/db/types/kysely.types';
import { UserRepo } from '@docmost/db/repos/user/user.repo';
import { User, Workspace } from '@docmost/db/types/entity.types';
import { LoginAttemptService } from '../../../core/auth/services/login-attempt.service';
import { LoginFlowService } from '../../../core/auth/services/login-flow.service';
import { MfaSecretService } from './mfa-secret.service';
import { comparePasswordHash, isUserDisabled } from '../../../common/helpers';
import { executeTx } from '@docmost/db/utils';
import {
  AUDIT_SERVICE,
  IAuditService,
} from '../../../integrations/audit/audit.service';
import { AuditEvent, AuditResource } from '../../../common/events/audit-events';
import { MfaTokenConsumptionService } from './mfa-token-consumption.service';
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
    private loginFlowService: LoginFlowService,
    private loginAttemptService: LoginAttemptService,
    private userRepo: UserRepo,
    private mfaSecretService: MfaSecretService,
    private mfaTokenConsumptionService: MfaTokenConsumptionService,
    @Inject(AUDIT_SERVICE) private readonly auditService: IAuditService,
  ) {}

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
  ): Promise<{
    method: string;
    qrCode: string;
    secret: string;
    manualKey: string;
  }> {
    const user = await this.userRepo.findById(userId, workspaceId);
    if (!user || isUserDisabled(user)) {
      throw new BadRequestException('User not found');
    }

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
        .set({
          secret: this.mfaSecretService.encryptTotpSecret(secretBase32),
          method,
          updatedAt: new Date(),
        })
        .where('id', '=', existing.id)
        .execute();
    } else {
      await this.db
        .insertInto('userMfa')
        .values({
          userId,
          workspaceId,
          secret: this.mfaSecretService.encryptTotpSecret(secretBase32),
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
    const mfaRecord = await this.db
      .selectFrom('userMfa')
      .select(['id', 'secret'])
      .where('userId', '=', userId)
      .where('workspaceId', '=', workspaceId)
      .executeTakeFirst();
    if (!mfaRecord?.secret) {
      throw new BadRequestException('MFA setup has expired');
    }

    const storedSecret = this.mfaSecretService.decryptStoredTotpSecret(
      mfaRecord.secret,
    );
    if (storedSecret !== secret) {
      throw new BadRequestException('Invalid verification code');
    }

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
        secret: this.mfaSecretService.encryptStoredTotpSecret(storedSecret),
        backupCodes: this.mfaSecretService.hashStoredBackupCodes(backupCodes),
        updatedAt: new Date(),
      })
      .where('userId', '=', userId)
      .where('workspaceId', '=', workspaceId)
      .execute();

    this.auditService.log({
      event: AuditEvent.USER_MFA_ENABLED,
      resourceType: AuditResource.USER,
      resourceId: userId,
    });

    return { success: true, backupCodes };
  }

  async disableMfa(
    userId: string,
    workspaceId: string,
    confirmPassword?: string,
  ): Promise<{ success: boolean }> {
    await this.assertCurrentPassword(userId, workspaceId, confirmPassword);
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

    this.auditService.log({
      event: AuditEvent.USER_MFA_DISABLED,
      resourceType: AuditResource.USER,
      resourceId: userId,
    });

    return { success: true };
  }

  async regenerateBackupCodes(
    userId: string,
    workspaceId: string,
    confirmPassword?: string,
  ): Promise<{ backupCodes: string[] }> {
    await this.assertCurrentPassword(userId, workspaceId, confirmPassword);
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
      .set({
        backupCodes: this.mfaSecretService.hashStoredBackupCodes(backupCodes),
        updatedAt: new Date(),
      })
      .where('id', '=', mfaRecord.id)
      .execute();

    this.auditService.log({
      event: AuditEvent.USER_MFA_BACKUP_CODE_GENERATED,
      resourceType: AuditResource.USER,
      resourceId: userId,
    });

    return { backupCodes };
  }

  async verifyMfa(
    userId: string,
    workspaceId: string,
    code: string,
    context: {
      primaryAuth: 'password' | 'passkey' | 'sso';
      passkeyId?: string;
      authTime: string;
      tokenId: string;
      tokenExpiresAt: number;
    },
  ): Promise<string> {
    await this.loginAttemptService.assertAllowed(workspaceId, userId, 'mfa');
    const verified = await executeTx(this.db, async (trx) => {
      const mfaRecord = await trx
        .selectFrom('userMfa')
        .selectAll()
        .where('userId', '=', userId)
        .where('workspaceId', '=', workspaceId)
        .forUpdate()
        .executeTakeFirst();

      if (!mfaRecord?.isEnabled || !mfaRecord.secret) {
        throw new BadRequestException('MFA is not enabled');
      }

      const plainSecret = this.mfaSecretService.decryptStoredTotpSecret(
        mfaRecord.secret,
      );
      const otpauth = await getOTPAuth();
      const totp = new otpauth.TOTP({
        algorithm: 'SHA1',
        digits: 6,
        period: 30,
        secret: otpauth.Secret.fromBase32(plainSecret),
      });

      if (totp.validate({ token: code, window: 1 }) !== null) {
        if (!this.mfaSecretService.isEncryptedTotpSecret(mfaRecord.secret)) {
          await trx
            .updateTable('userMfa')
            .set({
              secret: this.mfaSecretService.encryptTotpSecret(plainSecret),
              updatedAt: new Date(),
            })
            .where('id', '=', mfaRecord.id)
            .execute();
        }
        return true;
      }

      const backupCodes = mfaRecord.backupCodes ?? [];
      const matchedIndex = backupCodes.findIndex((storedCode) =>
        this.mfaSecretService.verifyBackupCode(code, storedCode),
      );
      if (matchedIndex < 0) {
        return false;
      }

      await trx
        .updateTable('userMfa')
        .set({
          backupCodes: this.mfaSecretService.hashStoredBackupCodes(
            backupCodes.filter((_, index) => index !== matchedIndex),
          ),
          secret: this.mfaSecretService.encryptStoredTotpSecret(plainSecret),
          updatedAt: new Date(),
        })
        .where('id', '=', mfaRecord.id)
        .execute();
      return true;
    });

    if (!verified) {
      await this.loginAttemptService.recordFailure(workspaceId, userId, 'mfa');
      this.auditService.setActorId(userId);
      this.auditService.log({
        event: AuditEvent.USER_LOGIN_FAILED,
        resourceType: AuditResource.USER,
        resourceId: userId,
        metadata: { source: 'mfa', reason: 'verification_failed' },
      });
      throw new UnauthorizedException('Invalid MFA code');
    }

    await this.mfaTokenConsumptionService.consume(
      context.tokenId,
      context.tokenExpiresAt,
    );

    const user = await this.userRepo.findById(userId, workspaceId);
    const workspace = (await this.db
      .selectFrom('workspaces')
      .selectAll()
      .where('id', '=', workspaceId)
      .executeTakeFirstOrThrow()) as Workspace;
    return this.loginFlowService.complete(user, workspace, {
      ...context,
      mfaVerifiedAt: new Date().toISOString(),
    });
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
      isTransferToken: true,
      requiresMfaSetup: workspace?.enforceMfa === true && !mfaRecord?.isEnabled,
      userHasMfa: mfaRecord?.isEnabled === true,
      isMfaEnforced: workspace?.enforceMfa === true,
    };
  }

  async assertPendingSetupAllowed(
    userId: string,
    workspaceId: string,
  ): Promise<void> {
    const user = await this.userRepo.findById(userId, workspaceId);
    if (!user || isUserDisabled(user)) {
      throw new UnauthorizedException('Authentication failed');
    }

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

    if (!workspace?.enforceMfa || mfaRecord?.isEnabled) {
      throw new BadRequestException('MFA setup is not pending');
    }
  }

  private generateBackupCodes(count = 10): string[] {
    return Array.from({ length: count }, () => {
      const value = crypto.randomBytes(16).toString('hex');
      return value.match(/.{1,4}/g)?.join('-') ?? value;
    });
  }

  private async assertCurrentPassword(
    userId: string,
    workspaceId: string,
    confirmPassword?: string,
  ): Promise<void> {
    const user = await this.userRepo.findById(userId, workspaceId, {
      includePassword: true,
    });
    if (!user) {
      throw new UnauthorizedException('Authentication failed');
    }
    if (user.hasGeneratedPassword) {
      return;
    }
    await this.loginAttemptService.assertAllowed(
      workspaceId,
      userId,
      'password',
    );
    if (
      !confirmPassword ||
      !user.password ||
      !(await comparePasswordHash(confirmPassword, user.password))
    ) {
      await this.loginAttemptService.recordFailure(
        workspaceId,
        userId,
        'password',
      );
      this.auditService.setActorId(userId);
      this.auditService.log({
        event: AuditEvent.USER_LOGIN_FAILED,
        resourceType: AuditResource.USER,
        resourceId: userId,
        metadata: { source: 'password', reason: 'step_up_failed' },
      });
      throw new UnauthorizedException('Current password is incorrect');
    }
  }
}
