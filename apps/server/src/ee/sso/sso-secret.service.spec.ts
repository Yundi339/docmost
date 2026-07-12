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
    const parts = encrypted.split(':');
    parts[3] = `${parts[3][0] === 'a' ? 'b' : 'a'}${parts[3].slice(1)}`;
    const modified = parts.join(':');

    expect(() => service.decryptStored(modified)).toThrow();
  });
});
