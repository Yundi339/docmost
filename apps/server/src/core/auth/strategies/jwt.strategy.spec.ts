import { UnauthorizedException } from '@nestjs/common';
import { JwtType } from '../dto/jwt-payload';
import { JwtStrategy } from './jwt.strategy';

describe('JwtStrategy token boundaries', () => {
  it('never accepts a public-share capability as a user credential', async () => {
    const userRepo = { findById: jest.fn() };
    const workspaceRepo = { findActiveById: jest.fn() };
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
    expect(workspaceRepo.findActiveById).not.toHaveBeenCalled();
    expect(sessionRepo.findActiveById).not.toHaveBeenCalled();
  });

  it('rejects ordinary access tokens when the workspace is not active', async () => {
    const userRepo = { findById: jest.fn() };
    const workspaceRepo = { findActiveById: jest.fn().mockResolvedValue(null) };
    const strategy = new JwtStrategy(
      userRepo as any,
      workspaceRepo as any,
      { findActiveById: jest.fn() } as any,
      { trackActivity: jest.fn() } as any,
      { getAppSecret: () => 'test-secret' } as any,
      { get: jest.fn() } as any,
    );

    await expect(
      strategy.validate(
        { raw: {} },
        {
          type: JwtType.ACCESS,
          sub: 'user-1',
          email: 'user@example.test',
          workspaceId: 'workspace-1',
          sessionId: 'session-1',
        },
      ),
    ).rejects.toBeInstanceOf(UnauthorizedException);

    expect(workspaceRepo.findActiveById).toHaveBeenCalledWith('workspace-1');
    expect(userRepo.findById).not.toHaveBeenCalled();
  });

  it('rejects legacy access tokens without a session id', async () => {
    const userRepo = { findById: jest.fn() };
    const workspaceRepo = { findActiveById: jest.fn() };
    const sessionRepo = { findActiveById: jest.fn() };
    const strategy = new JwtStrategy(
      userRepo as any,
      workspaceRepo as any,
      sessionRepo as any,
      { trackActivity: jest.fn() } as any,
      { getAppSecret: () => 'test-secret' } as any,
      { get: jest.fn() } as any,
    );

    await expect(
      strategy.validate(
        { raw: {} },
        {
          type: JwtType.ACCESS,
          sub: 'user-1',
          email: 'user@example.test',
          workspaceId: 'workspace-1',
        } as any,
      ),
    ).rejects.toThrow('Active session is required');

    expect(workspaceRepo.findActiveById).not.toHaveBeenCalled();
    expect(userRepo.findById).not.toHaveBeenCalled();
    expect(sessionRepo.findActiveById).not.toHaveBeenCalled();
  });
});
