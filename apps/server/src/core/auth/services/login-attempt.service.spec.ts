import { HttpStatus } from '@nestjs/common';
import { LoginAttemptService } from './login-attempt.service';

describe('LoginAttemptService', () => {
  const repo = {
    find: jest.fn(),
    recordFailure: jest.fn(),
    clearForUser: jest.fn(),
  };
  const service = new LoginAttemptService(repo as any);

  beforeEach(() => jest.clearAllMocks());

  it('rejects an account method while its cooldown is active', async () => {
    repo.find.mockResolvedValue({
      lockedUntil: new Date(Date.now() + 60_000),
    });

    await expect(
      service.assertAllowed('workspace-id', 'user-id', 'passkey'),
    ).rejects.toMatchObject({
      status: HttpStatus.TOO_MANY_REQUESTS,
    });
  });

  it('does not apply one authentication method cooldown to another', async () => {
    repo.find.mockResolvedValue(undefined);

    await expect(
      service.assertAllowed('workspace-id', 'user-id', 'password'),
    ).resolves.toBeUndefined();
    expect(repo.find).toHaveBeenCalledWith(
      'workspace-id',
      'user-id',
      'password',
    );
  });

  it('clears all method counters only after successful login completion', async () => {
    await service.clearForUser('workspace-id', 'user-id');
    expect(repo.clearForUser).toHaveBeenCalledWith('workspace-id', 'user-id');
  });
});
