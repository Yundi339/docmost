import { JwtService } from '@nestjs/jwt';
import { TokenService } from './token.service';
import { JwtType } from '../dto/jwt-payload';

describe('TokenService', () => {
  let service: TokenService;
  let jwtService: JwtService;

  const user = {
    id: 'user-id',
    email: 'user@example.com',
    workspaceId: 'workspace-id',
    deactivatedAt: null,
    deletedAt: null,
  } as any;

  beforeEach(() => {
    jwtService = new JwtService({
      secret: 'test-secret',
      signOptions: {
        expiresIn: '365d',
        issuer: 'Docmost',
      },
    });

    service = new TokenService(jwtService, {
      getAppSecret: () => 'test-secret',
    } as any);
  });

  it('does not set an expiry for non-expiring API tokens', async () => {
    const token = await service.generateApiToken({
      apiKeyId: 'api-key-id',
      user,
      workspaceId: 'workspace-id',
    });

    const payload = jwtService.decode(token) as Record<string, any>;
    expect(payload).toMatchObject({
      sub: 'user-id',
      apiKeyId: 'api-key-id',
      workspaceId: 'workspace-id',
      type: JwtType.API_KEY,
      iss: 'Docmost',
    });
    expect(payload.exp).toBeUndefined();
  });

  it('sets an expiry for expiring API tokens', async () => {
    const token = await service.generateApiToken({
      apiKeyId: 'api-key-id',
      user,
      workspaceId: 'workspace-id',
      expiresIn: 60,
    });

    const payload = jwtService.decode(token) as Record<string, any>;
    expect(payload.exp - payload.iat).toBe(60);
  });
});
