import { NotFoundException } from '@nestjs/common';
import { ShareController } from './share.controller';

describe('ShareController password management', () => {
  const shareRepo = { findById: jest.fn() };
  const pageRepo = { findById: jest.fn() };
  const pageAccessService = { validateCanEdit: jest.fn() };
  const sharePasswordService = {
    setPassword: jest.fn(),
    removePassword: jest.fn(),
  };
  const auditService = { log: jest.fn() };
  const controller = new ShareController(
    {} as any,
    shareRepo as any,
    pageRepo as any,
    {} as any,
    pageAccessService as any,
    {} as any,
    sharePasswordService as any,
    auditService as any,
  );

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('rejects a share from another workspace before checking page access', async () => {
    shareRepo.findById.mockResolvedValue({
      id: 'share-id',
      workspaceId: 'other-workspace',
    });

    await expect(
      controller.setPassword(
        { shareId: 'share-id', password: 'password-value' },
        { id: 'user-id' } as any,
        { id: 'workspace-id' } as any,
      ),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(pageAccessService.validateCanEdit).not.toHaveBeenCalled();
    expect(sharePasswordService.setPassword).not.toHaveBeenCalled();
  });

  it('checks page edit access before setting a password and audits no secret', async () => {
    const share = {
      id: 'share-id',
      pageId: 'page-id',
      spaceId: 'space-id',
      workspaceId: 'workspace-id',
    };
    shareRepo.findById.mockResolvedValue(share);
    pageRepo.findById.mockResolvedValue({
      id: 'page-id',
      workspaceId: 'workspace-id',
    });
    sharePasswordService.setPassword.mockResolvedValue({
      share: { ...share, passwordProtected: true },
      wasProtected: false,
    });

    await controller.setPassword(
      { shareId: 'share-id', password: 'password-value' },
      { id: 'user-id' } as any,
      { id: 'workspace-id' } as any,
    );

    expect(pageAccessService.validateCanEdit).toHaveBeenCalled();
    expect(sharePasswordService.setPassword).toHaveBeenCalledWith(
      'share-id',
      'password-value',
    );
    expect(JSON.stringify(auditService.log.mock.calls)).not.toContain(
      'password-value',
    );
    expect(auditService.log).toHaveBeenCalledWith(
      expect.objectContaining({ event: 'share.password_set' }),
    );
  });
});
