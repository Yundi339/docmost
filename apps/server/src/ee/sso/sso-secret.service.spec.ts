import { SsoSecretService } from './sso-secret.service';

describe('SsoSecretService', () => {
  const service = new SsoSecretService({
    getAppSecret: () => 'test-app-secret',
  } as any);

  it('encrypts and decrypts a secret with authenticated encryption', () => {
    const encrypted = service.encrypt('client-secret');

    expect(encrypted).toMatch(/^enc:v1:/);
    expect(encrypted).not.toContain('client-secret');
    expect(service.decryptStored(encrypted)).toBe('client-secret');
  });

  it('supports plaintext values during the lazy migration window', () => {
    expect(service.decryptStored('legacy-secret')).toBe('legacy-secret');
    expect(service.encryptStored('legacy-secret')).toMatch(/^enc:v1:/);
  });

  it('rejects modified ciphertext', () => {
    const encrypted = service.encrypt('client-secret');
    const modified = `${encrypted.slice(0, -1)}x`;

    expect(() => service.decryptStored(modified)).toThrow();
  });
});
