import { ServiceUnavailableException } from '@nestjs/common';
import { PasskeyOriginService } from './passkey-origin.service';

describe('PasskeyOriginService', () => {
  const workspace = { hostname: null } as any;

  const serviceFor = (url: string) =>
    new PasskeyOriginService({ getUrl: () => url } as any);

  it('uses the configured public URL and excludes proxy/internal ports', () => {
    expect(
      serviceFor('https://mydoc.procriva.com:23000').getConfig(workspace),
    ).toEqual({
      expectedOrigin: 'https://mydoc.procriva.com:23000',
      rpId: 'mydoc.procriva.com',
    });
  });

  it('allows HTTP only for localhost development', () => {
    expect(serviceFor('http://localhost:3100').getConfig(workspace)).toEqual({
      expectedOrigin: 'http://localhost:3100',
      rpId: 'localhost',
    });
    expect(() =>
      serviceFor('http://docmost.example.com').getConfig(workspace),
    ).toThrow(ServiceUnavailableException);
  });

  it('returns an unavailable status without exposing configuration errors', () => {
    expect(serviceFor('not-a-url').getStatus(workspace)).toEqual({
      available: false,
      expectedOrigin: null,
      rpId: null,
    });
  });
});
