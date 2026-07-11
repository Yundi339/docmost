import { Injectable } from '@nestjs/common';
import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
} from 'crypto';
import { EnvironmentService } from '../../integrations/environment/environment.service';

const ENCRYPTION_PREFIX = 'enc:v1';
const ENCRYPTION_CONTEXT = 'docmost:sso-secret:v1';

@Injectable()
export class SsoSecretService {
  private readonly key: Buffer;

  constructor(environmentService: EnvironmentService) {
    this.key = createHash('sha256')
      .update(ENCRYPTION_CONTEXT)
      .update('\0')
      .update(environmentService.getAppSecret())
      .digest();
  }

  encrypt(secret: string): string {
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', this.key, iv);
    cipher.setAAD(Buffer.from(ENCRYPTION_CONTEXT));

    const ciphertext = Buffer.concat([
      cipher.update(secret, 'utf8'),
      cipher.final(),
    ]);
    const tag = cipher.getAuthTag();

    return [
      ENCRYPTION_PREFIX,
      iv.toString('base64url'),
      ciphertext.toString('base64url'),
      tag.toString('base64url'),
    ].join(':');
  }

  encryptStored(secret: string): string {
    return this.isEncrypted(secret) ? secret : this.encrypt(secret);
  }

  decryptStored(secret: string): string {
    if (!this.isEncrypted(secret)) {
      return secret;
    }

    const [, , ivValue, ciphertextValue, tagValue] = secret.split(':');
    const decipher = createDecipheriv(
      'aes-256-gcm',
      this.key,
      Buffer.from(ivValue, 'base64url'),
    );
    decipher.setAAD(Buffer.from(ENCRYPTION_CONTEXT));
    decipher.setAuthTag(Buffer.from(tagValue, 'base64url'));

    return Buffer.concat([
      decipher.update(Buffer.from(ciphertextValue, 'base64url')),
      decipher.final(),
    ]).toString('utf8');
  }

  isEncrypted(secret: string): boolean {
    return secret.startsWith(`${ENCRYPTION_PREFIX}:`);
  }
}
