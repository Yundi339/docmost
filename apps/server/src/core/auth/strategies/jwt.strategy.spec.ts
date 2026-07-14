import { UnauthorizedException } from '@nestjs/common';
import { JwtType } from '../dto/jwt-payload';
import { JwtStrategy } from './jwt.strategy';

describe('JwtStrategy token boundaries', () => {
  it('never accepts a public-share capability as a user credential', async () => {
    const userRepo = { findById: jest.fn() };
    const workspaceRepo = { findById: jest.fn() };
    const sessionRepo = { findActiveById: jest.fn() };
    const sessionActivity = { trackActivity: jest.fn() };
    const environment = { getAppSecret: () => 'test-secret' };
    const moduleRef = { get: jest.fn() };
    const strategy = new JwtStrategy(
      userRepo as any,
      workspaceRepo as any,
      sessionRepo as any,
      sessionActivity as any,
      environment as any,
      moduleRef as any,
    );
    const request = { raw: {} };

    await expect(
      strategy.validate(request, {
        type: JwtType.SHARE_ACCESS,
        sub: 'share-id',
        workspaceId: 'workspace-id',
      } as any),
    ).rejects.toBeInstanceOf(UnauthorizedException);

    expect(userRepo.findById).not.toHaveBeenCalled();
    expect(workspaceRepo.findById).not.toHaveBeenCalled();
    expect(sessionRepo.findActiveById).not.toHaveBeenCalled();
  });
});
