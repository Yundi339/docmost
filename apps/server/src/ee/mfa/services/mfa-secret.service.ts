import { Injectable } from '@nestjs/common';
import {
  createCipheriv,
  createDecipheriv,
  createHash,
  createHmac,
  randomBytes,
  timingSafeEqual,
} from 'crypto';
import { EnvironmentService } from '../../../integrations/environment/environment.service';

const TOTP_PREFIX = 'enc:mfa:v1';
const TOTP_CONTEXT = 'docmost:mfa-totp-secret:v1';
const BACKUP_CODE_PREFIX = 'hmac:mfa-backup:v1';
const BACKUP_CODE_CONTEXT = 'docmost:mfa-backup-code:v1';

@Injectable()
export class MfaSecretService {
  private readonly encryptionKey: Buffer;
  private readonly backupCodeKey: Buffer;

  constructor(environmentService: EnvironmentService) {
    const appSecret = environmentService.getAppSecret();
    this.encryptionKey = this.deriveKey(TOTP_CONTEXT, appSecret);
    this.backupCodeKey = this.deriveKey(BACKUP_CODE_CONTEXT, appSecret);
  }

  encryptTotpSecret(secret: string): string {
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', this.encryptionKey, iv);
    cipher.setAAD(Buffer.from(TOTP_CONTEXT));
    const ciphertext = Buffer.concat([
      cipher.update(secret, 'utf8'),
      cipher.final(),
    ]);

    return [
      TOTP_PREFIX,
      iv.toString('base64url'),
      ciphertext.toString('base64url'),
      cipher.getAuthTag().toString('base64url'),
    ].join(':');
  }

  encryptStoredTotpSecret(secret: string): string {
    return this.isEncryptedTotpSecret(secret)
      ? secret
      : this.encryptTotpSecret(secret);
  }

  decryptStoredTotpSecret(secret: string): string {
    if (!this.isEncryptedTotpSecret(secret)) {
      return secret;
    }

    const parts = secret.split(':');
    if (parts.length !== 6) {
      throw new Error('Invalid encrypted MFA secret');
    }
    const [, , , ivValue, ciphertextValue, tagValue] = parts;
    const decipher = createDecipheriv(
      'aes-256-gcm',
      this.encryptionKey,
      Buffer.from(ivValue, 'base64url'),
    );
    decipher.setAAD(Buffer.from(TOTP_CONTEXT));
    decipher.setAuthTag(Buffer.from(tagValue, 'base64url'));

    return Buffer.concat([
      decipher.update(Buffer.from(ciphertextValue, 'base64url')),
      decipher.final(),
    ]).toString('utf8');
  }

  isEncryptedTotpSecret(secret: string): boolean {
    return secret.startsWith(`${TOTP_PREFIX}:`);
  }

  hashBackupCode(code: string): string {
    const digest = createHmac('sha256', this.backupCodeKey)
      .update(this.normalizeBackupCode(code))
      .digest('base64url');
    return `${BACKUP_CODE_PREFIX}:${digest}`;
  }

  hashStoredBackupCodes(codes: string[]): string[] {
    return codes.map((code) =>
      this.isHashedBackupCode(code) ? code : this.hashBackupCode(code),
    );
  }

  verifyBackupCode(candidate: string, stored: string): boolean {
    const expected = this.isHashedBackupCode(stored)
      ? stored
      : this.hashBackupCode(stored);
    const actual = this.hashBackupCode(candidate);
    const expectedDigest = Buffer.from(
      expected.slice(`${BACKUP_CODE_PREFIX}:`.length),
      'base64url',
    );
    const actualDigest = Buffer.from(
      actual.slice(`${BACKUP_CODE_PREFIX}:`.length),
      'base64url',
    );
    return (
      expectedDigest.length === actualDigest.length &&
      timingSafeEqual(actualDigest, expectedDigest)
    );
  }

  isHashedBackupCode(code: string): boolean {
    return code.startsWith(`${BACKUP_CODE_PREFIX}:`);
  }

  normalizeBackupCode(code: string): string {
    return code.replace(/[\s-]/g, '').toLowerCase();
  }

  private deriveKey(context: string, appSecret: string): Buffer {
    return createHash('sha256')
      .update(context)
      .update('\0')
      .update(appSecret)
      .digest();
  }
}
