import { BadRequestException } from '@nestjs/common';
import { SsoLoginCapabilityService } from './sso-login-capability.service';

describe('SsoLoginCapabilityService', () => {
  let service: SsoLoginCapabilityService;

  beforeEach(() => {
    service = new SsoLoginCapabilityService();
  });

  it('has no available provider types until a login module registers one', () => {
    expect(service.getAvailableProviderTypes()).toEqual([]);
    expect(service.isLoginAvailable('oidc')).toBe(false);
    expect(() => service.assertLoginAvailable('oidc')).toThrow(
      BadRequestException,
    );
  });

  it('registers a handler idempotently and rejects conflicting handlers', () => {
    service.register({ providerType: 'OIDC', handler: 'OidcLoginController' });
    service.register({ providerType: 'oidc', handler: 'OidcLoginController' });

    expect(service.isLoginAvailable('oidc')).toBe(true);
    expect(service.getAvailableProviderTypes()).toEqual(['oidc']);
    expect(() =>
      service.register({ providerType: 'oidc', handler: 'OtherController' }),
    ).toThrow('already registered');
  });
});
