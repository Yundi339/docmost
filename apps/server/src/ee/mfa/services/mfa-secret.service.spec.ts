import { MfaSecretService } from './mfa-secret.service';

describe('MfaSecretService', () => {
  const service = new MfaSecretService({
    getAppSecret: () => 'test-app-secret',
  } as any);

  it('encrypts TOTP secrets with authenticated encryption', () => {
    const encrypted = service.encryptTotpSecret('JBSWY3DPEHPK3PXP');

    expect(encrypted).toMatch(/^enc:mfa:v1:/);
    expect(encrypted).not.toContain('JBSWY3DPEHPK3PXP');
    expect(service.decryptStoredTotpSecret(encrypted)).toBe('JBSWY3DPEHPK3PXP');
  });

  it('supports legacy plaintext TOTP secrets during lazy migration', () => {
    expect(service.decryptStoredTotpSecret('LEGACYSECRET')).toBe(
      'LEGACYSECRET',
    );
    expect(service.encryptStoredTotpSecret('LEGACYSECRET')).toMatch(
      /^enc:mfa:v1:/,
    );
  });

  it('rejects modified TOTP ciphertext', () => {
    const encrypted = service.encryptTotpSecret('JBSWY3DPEHPK3PXP');
    const parts = encrypted.split(':');
    parts[4] = `${parts[4][0] === 'a' ? 'b' : 'a'}${parts[4].slice(1)}`;
    const modified = parts.join(':');

    expect(() => service.decryptStoredTotpSecret(modified)).toThrow();
  });

  it('stores only keyed backup-code digests and normalizes separators', () => {
    const code = 'AbCd-Ef12-Gh34';
    const hash = service.hashBackupCode(code);

    expect(hash).toMatch(/^hmac:mfa-backup:v1:/);
    expect(hash).not.toContain('AbCd');
    expect(service.verifyBackupCode('AbCdEf12Gh34', hash)).toBe(true);
    expect(service.verifyBackupCode('abcd-ef12-gh34', hash)).toBe(true);
  });

  it('accepts legacy plaintext backup codes and upgrades stored values', () => {
    expect(service.verifyBackupCode('deadbeef', 'deadbeef')).toBe(true);
    const upgraded = service.hashStoredBackupCodes(['deadbeef']);
    expect(upgraded[0]).toMatch(/^hmac:mfa-backup:v1:/);
    expect(service.verifyBackupCode('deadbeef', upgraded[0])).toBe(true);
  });

  it('returns false for a malformed stored digest instead of throwing', () => {
    expect(
      service.verifyBackupCode('candidate', 'hmac:mfa-backup:v1:bad'),
    ).toBe(false);
  });
});
