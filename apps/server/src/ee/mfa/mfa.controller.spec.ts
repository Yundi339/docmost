import { UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { MfaController } from './mfa.controller';

describe('MfaController pending setup flow', () => {
  const jwtService = new JwtService({ secret: 'test-secret' });
  let mfaService: any;
  let authCookieService: any;
  let controller: MfaController;

  beforeEach(() => {
    mfaService = {
      assertPendingSetupAllowed: jest.fn(),
      setupMfa: jest.fn().mockResolvedValue({ method: 'totp' }),
      enableMfa: jest.fn().mockResolvedValue({
        success: true,
        backupCodes: ['backup-code'],
      }),
      validateMfaAccess: jest.fn().mockResolvedValue({
        valid: true,
        isTransferToken: true,
        requiresMfaSetup: true,
      }),
      verifyMfa: jest.fn().mockResolvedValue('auth-token'),
    };
    authCookieService = {
      clearMfaCookie: jest.fn(),
      setAuthCookie: jest.fn(),
    };
    controller = new MfaController(mfaService, jwtService, authCookieService);
  });

  it('allows only the pending user/workspace encoded in a short-lived MFA token', async () => {
    const request = mfaRequest();

    await expect(
      controller.setupPending(request, { method: 'totp' }),
    ).resolves.toEqual({ method: 'totp' });
    expect(mfaService.assertPendingSetupAllowed).toHaveBeenCalledWith(
      'user-id',
      'workspace-id',
    );
    expect(mfaService.setupMfa).toHaveBeenCalledWith(
      'user-id',
      'workspace-id',
      'totp',
    );
  });

  it('does not accept a normal access token on pending endpoints', async () => {
    const token = jwtService.sign({
      sub: 'user-id',
      workspaceId: 'workspace-id',
      type: 'access',
    });

    await expect(
      controller.setupPending({ cookies: { mfaToken: token } } as any, {
        method: 'totp',
      }),
    ).rejects.toBeInstanceOf(UnauthorizedException);
    expect(mfaService.setupMfa).not.toHaveBeenCalled();
  });

  it('clears the pending cookie after MFA is enabled without creating a session', async () => {
    const reply = {} as any;

    await expect(
      controller.enablePending(mfaRequest(), reply, {
        secret: 'JBSWY3DPEHPK3PXP',
        verificationCode: '123456',
      }),
    ).resolves.toMatchObject({ success: true });
    expect(authCookieService.clearMfaCookie).toHaveBeenCalledWith(reply);
  });

  it('reports an MFA token as a transfer token to the route guard', async () => {
    await expect(
      controller.validateAccess(mfaRequest()),
    ).resolves.toMatchObject({
      valid: true,
      isTransferToken: true,
      requiresMfaSetup: true,
    });
  });

  it('passes one-time token claims into MFA verification', async () => {
    const reply = {} as any;

    await controller.verify({ code: '123456' }, mfaRequest(), reply);

    expect(mfaService.verifyMfa).toHaveBeenCalledWith(
      'user-id',
      'workspace-id',
      '123456',
      expect.objectContaining({
        primaryAuth: 'passkey',
        tokenId: '12345678-1234-4234-8234-123456789abc',
        tokenExpiresAt: expect.any(Number),
      }),
    );
  });

  it('rejects legacy MFA tokens without a one-time identifier', async () => {
    const token = jwtService.sign(
      {
        sub: 'user-id',
        workspaceId: 'workspace-id',
        type: 'mfa_token',
        primaryAuth: 'passkey',
        authTime: new Date().toISOString(),
      },
      { expiresIn: '5m' },
    );

    await expect(
      controller.verify(
        { code: '123456' },
        { cookies: { mfaToken: token } } as any,
        {} as any,
      ),
    ).rejects.toBeInstanceOf(UnauthorizedException);
    expect(mfaService.verifyMfa).not.toHaveBeenCalled();
  });

  it('returns valid false for missing or expired pending tokens', async () => {
    await expect(
      controller.validateAccess({ cookies: {} } as any),
    ).resolves.toEqual({ valid: false });
  });

  function mfaRequest() {
    const mfaToken = jwtService.sign(
      {
        sub: 'user-id',
        workspaceId: 'workspace-id',
        type: 'mfa_token',
        jti: '12345678-1234-4234-8234-123456789abc',
        primaryAuth: 'passkey',
        authTime: new Date().toISOString(),
      },
      { expiresIn: '5m' },
    );
    return { cookies: { mfaToken } } as any;
  }
});
