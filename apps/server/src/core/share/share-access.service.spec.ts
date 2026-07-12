import { UnauthorizedException } from '@nestjs/common';
import { ShareAccessService } from './share-access.service';
import { comparePasswordHash } from '../../common/helpers';
import { JwtType } from '../auth/dto/jwt-payload';

jest.mock('../../common/helpers', () => ({
  comparePasswordHash: jest.fn(),
}));

describe('ShareAccessService', () => {
  const state = {
    id: 'share-id',
    pageId: 'root-page-id',
    spaceId: 'space-id',
    workspaceId: 'workspace-id',
    passwordHash: 'password-hash',
    passwordVersion: 3,
    passwordUpdatedAt: new Date(),
  };
  const shareRepo = {
    findById: jest.fn(),
    findPasswordStateById: jest.fn(),
  };
  const shareService = {
    getShareForPage: jest.fn(),
    isSharingAllowed: jest.fn(),
  };
  const tokenService = {
    verifyJwt: jest.fn(),
    generateShareAccessToken: jest.fn(),
  };
  const environmentService = { isHttps: jest.fn().mockReturnValue(true) };
  const pageRepo = { findById: jest.fn() };
  const pagePermissionRepo = { hasRestrictedAncestor: jest.fn() };
  const auditService = { logWithContext: jest.fn() };
  let service: ShareAccessService;

  beforeEach(() => {
    jest.clearAllMocks();
    shareRepo.findById.mockResolvedValue({ id: state.id });
    shareRepo.findPasswordStateById.mockResolvedValue(state);
    shareService.isSharingAllowed.mockResolvedValue(true);
    pageRepo.findById.mockResolvedValue({
      id: state.pageId,
      workspaceId: state.workspaceId,
      spaceId: state.spaceId,
      deletedAt: null,
    });
    pagePermissionRepo.hasRestrictedAncestor.mockResolvedValue(false);
    service = new ShareAccessService(
      shareRepo as any,
      shareService as any,
      tokenService as any,
      environmentService as any,
      pageRepo as any,
      pagePermissionRepo as any,
      auditService as any,
    );
  });

  it('requires a capability cookie for a protected share', async () => {
    const error = await service
      .assertRequestAccess(request(), { shareId: state.id })
      .catch((value) => value);

    expect(error).toBeInstanceOf(UnauthorizedException);
    expect(error.getResponse()).toMatchObject({
      code: 'SHARE_PASSWORD_REQUIRED',
    });
  });

  it('accepts only a capability bound to the same share and password version', async () => {
    tokenService.verifyJwt.mockResolvedValue({
      type: JwtType.SHARE_ACCESS,
      shareId: state.id,
      workspaceId: state.workspaceId,
      passwordVersion: state.passwordVersion,
    });

    await expect(
      service.assertRequestAccess(
        request({ 'share_access_share-id': 'token' }),
        {
          shareId: state.id,
        },
      ),
    ).resolves.toEqual(state);
    expect(tokenService.verifyJwt).toHaveBeenCalledWith(
      'token',
      JwtType.SHARE_ACCESS,
    );

    tokenService.verifyJwt.mockResolvedValue({
      type: JwtType.SHARE_ACCESS,
      shareId: 'different-share',
      workspaceId: state.workspaceId,
      passwordVersion: state.passwordVersion,
    });
    await expect(
      service.assertRequestAccess(
        request({ 'share_access_share-id': 'token' }),
        {
          shareId: state.id,
        },
      ),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('sets a secure HttpOnly cookie after a successful unlock', async () => {
    (comparePasswordHash as jest.Mock).mockResolvedValue(true);
    tokenService.generateShareAccessToken.mockResolvedValue('capability');
    const reply = { setCookie: jest.fn() };

    await expect(
      service.unlock(request(), reply as any, {
        shareId: state.id,
        password: 'correct-password',
      }),
    ).resolves.toEqual({ passwordProtected: true });

    expect(reply.setCookie).toHaveBeenCalledWith(
      'share_access_share-id',
      'capability',
      expect.objectContaining({
        httpOnly: true,
        secure: true,
        sameSite: 'lax',
        maxAge: 43_200,
      }),
    );
  });

  it('samples repeated failed unlock audits by share and IP', async () => {
    (comparePasswordHash as jest.Mock).mockResolvedValue(false);
    const req = request();

    await expect(
      service.unlock(req, {} as any, {
        shareId: state.id,
        password: 'wrong-password',
      }),
    ).rejects.toBeInstanceOf(UnauthorizedException);
    await expect(
      service.unlock(req, {} as any, {
        shareId: state.id,
        password: 'wrong-password',
      }),
    ).rejects.toBeInstanceOf(UnauthorizedException);

    expect(auditService.logWithContext).toHaveBeenCalledTimes(1);
    expect(auditService.logWithContext).toHaveBeenCalledWith(
      expect.objectContaining({
        event: 'share.password_unlock_failed',
        resourceId: state.id,
      }),
      expect.objectContaining({ actorType: 'system', ipAddress: '127.0.0.1' }),
    );
  });

  it('rejects stale, cross-share, and legacy unbound attachment tokens', async () => {
    await expect(
      service.validateAttachmentCapability({
        shareId: state.id,
        sharePasswordVersion: state.passwordVersion,
        workspaceId: state.workspaceId,
      } as any),
    ).resolves.toBe(true);
    await expect(
      service.validateAttachmentCapability({
        shareId: state.id,
        sharePasswordVersion: state.passwordVersion - 1,
        workspaceId: state.workspaceId,
      } as any),
    ).resolves.toBe(false);
    await expect(
      service.validateAttachmentCapability({
        workspaceId: state.workspaceId,
      } as any),
    ).resolves.toBe(false);
  });

  it('does not reveal password protection when public sharing is disabled', async () => {
    shareService.isSharingAllowed.mockResolvedValue(false);

    await expect(
      service.assertRequestAccess(request(), { shareId: state.id }),
    ).rejects.toMatchObject({ status: 404 });
  });

  function request(cookies: Record<string, string> = {}) {
    return {
      raw: { workspace: { id: state.workspaceId } },
      cookies,
      ip: '127.0.0.1',
      socket: {},
      headers: { 'user-agent': 'jest' },
    } as any;
  }
});
