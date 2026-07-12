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

    service = new TokenService(jwtService);
  });

  it('sets an expiry for API tokens', async () => {
    const token = await service.generateApiToken({
      apiKeyId: 'api-key-id',
      user,
      workspaceId: 'workspace-id',
      scopes: ['mcp:read'],
      expiresIn: 60,
    });

    const payload = jwtService.decode(token) as Record<string, any>;
    expect(payload).toMatchObject({
      sub: 'user-id',
      apiKeyId: 'api-key-id',
      workspaceId: 'workspace-id',
      scopes: ['mcp:read'],
      type: JwtType.API_KEY,
      iss: 'Docmost',
    });
    expect(payload.exp - payload.iat).toBe(60);
  });

  it('binds share access and attachment tokens to the share password version', async () => {
    const accessToken = await service.generateShareAccessToken({
      shareId: 'share-id',
      workspaceId: 'workspace-id',
      passwordVersion: 4,
    });
    expect(jwtService.decode(accessToken)).toMatchObject({
      shareId: 'share-id',
      workspaceId: 'workspace-id',
      passwordVersion: 4,
      type: JwtType.SHARE_ACCESS,
    });

    const attachmentToken = await service.generateAttachmentToken({
      attachmentId: 'attachment-id',
      pageId: 'page-id',
      workspaceId: 'workspace-id',
      shareId: 'share-id',
      sharePasswordVersion: 4,
    });
    expect(jwtService.decode(attachmentToken)).toMatchObject({
      attachmentId: 'attachment-id',
      shareId: 'share-id',
      sharePasswordVersion: 4,
      type: JwtType.ATTACHMENT,
    });
  });
});
