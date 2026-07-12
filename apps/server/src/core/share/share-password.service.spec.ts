import { BadRequestException } from '@nestjs/common';
import { SharePasswordService } from './share-password.service';
import { ShareRepo } from '@docmost/db/repos/share/share.repo';
import { hashPassword } from '../../common/helpers';

jest.mock('../../common/helpers', () => ({
  hashPassword: jest.fn(),
}));

describe('SharePasswordService', () => {
  const shareRepo = {
    findPasswordStateById: jest.fn(),
    setPassword: jest.fn(),
    removePassword: jest.fn(),
  } as unknown as jest.Mocked<ShareRepo>;
  const service = new SharePasswordService(shareRepo);

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('hashes a new password and reports that protection was newly enabled', async () => {
    shareRepo.findPasswordStateById.mockResolvedValue({
      id: 'share-id',
      passwordHash: null,
    } as any);
    (hashPassword as jest.Mock).mockResolvedValue('hashed-password');
    shareRepo.setPassword.mockResolvedValue({
      id: 'share-id',
      passwordProtected: true,
    } as any);

    await expect(
      service.setPassword('share-id', 'secret-value'),
    ).resolves.toEqual({
      share: { id: 'share-id', passwordProtected: true },
      wasProtected: false,
    });
    expect(hashPassword).toHaveBeenCalledWith('secret-value');
    expect(shareRepo.setPassword).toHaveBeenCalledWith(
      'share-id',
      'hashed-password',
    );
  });

  it('reports password rotation without exposing the hash', async () => {
    shareRepo.findPasswordStateById.mockResolvedValue({
      id: 'share-id',
      passwordHash: 'old-hash',
    } as any);
    (hashPassword as jest.Mock).mockResolvedValue('new-hash');
    shareRepo.setPassword.mockResolvedValue({
      id: 'share-id',
      passwordProtected: true,
    } as any);

    const result = await service.setPassword('share-id', 'new-password');
    expect(result.wasProtected).toBe(true);
    expect(result.share).not.toHaveProperty('passwordHash');
  });

  it('rejects removing a password when protection is not enabled', async () => {
    shareRepo.findPasswordStateById.mockResolvedValue({
      id: 'share-id',
      passwordHash: null,
    } as any);

    await expect(service.removePassword('share-id')).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(shareRepo.removePassword).not.toHaveBeenCalled();
  });
});
