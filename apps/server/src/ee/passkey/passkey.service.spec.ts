import { BadRequestException } from '@nestjs/common';
import {
  verifyAuthenticationResponse,
  verifyRegistrationResponse,
} from '@simplewebauthn/server';
import { AuditEvent } from '../../common/events/audit-events';
import { PasskeyService } from './passkey.service';

jest.mock('@simplewebauthn/server', () => ({
  generateAuthenticationOptions: jest.fn(),
  generateRegistrationOptions: jest.fn(),
  verifyAuthenticationResponse: jest.fn(),
  verifyRegistrationResponse: jest.fn(),
}));

describe('PasskeyService security helpers', () => {
  const service = new PasskeyService(
    {} as any,
    {} as any,
    {} as any,
    {} as any,
    {} as any,
    {} as any,
    {} as any,
    {} as any,
    {} as any,
    {} as any,
    {} as any,
  );

  it('never exposes credential material in management responses', () => {
    const result = (service as any).toPublicPasskey({
      id: 'passkey-id',
      name: 'Laptop',
      deviceType: 'multiDevice',
      backedUp: true,
      disabledAt: null,
      createdAt: new Date('2026-07-12T00:00:00Z'),
      lastUsedAt: null,
      credentialId: 'credential-secret',
      publicKey: Buffer.from('public-key-secret'),
      counter: 42,
      transports: ['internal'],
    });

    expect(result).toEqual({
      id: 'passkey-id',
      name: 'Laptop',
      deviceType: 'multiDevice',
      backedUp: true,
      disabled: false,
      createdAt: new Date('2026-07-12T00:00:00Z'),
      lastUsedAt: null,
    });
    expect(JSON.stringify(result)).not.toContain('credential-secret');
    expect(JSON.stringify(result)).not.toContain('public-key-secret');
  });

  it('rejects ceremonies initiated from a cross-origin frame', () => {
    const clientData = Buffer.from(
      JSON.stringify({
        type: 'webauthn.get',
        challenge: 'challenge',
        origin: 'https://docmost.example.com',
        crossOrigin: true,
      }),
    ).toString('base64url');

    expect(() => (service as any).assertSameOriginCeremony(clientData)).toThrow(
      BadRequestException,
    );
  });

  it('rejects oversized credential responses before cryptographic parsing', () => {
    expect(() =>
      (service as any).assertCredentialResponseSize({
        response: 'x'.repeat(128 * 1024 + 1),
      }),
    ).toThrow(BadRequestException);
  });
});

describe('PasskeyService authentication flow', () => {
  const workspace = { id: 'workspace-id' } as any;
  const user = {
    id: 'user-id',
    workspaceId: workspace.id,
    email: 'user@example.com',
  } as any;
  const userHandle = Buffer.alloc(64, 7);
  const passkey = {
    id: 'passkey-id',
    workspaceId: workspace.id,
    userId: user.id,
    credentialId: 'credential-id',
    publicKey: Buffer.from([1, 2, 3]),
    counter: 1,
    transports: ['internal'],
  } as any;
  const challenge = {
    challenge: 'server-challenge',
    expectedOrigin: 'https://docmost.example.com',
    rpId: 'docmost.example.com',
  } as any;

  let accountRepo: any;
  let passkeyRepo: any;
  let challengeRepo: any;
  let userRepo: any;
  let loginFlow: any;
  let loginAttempt: any;
  let securityNotification: any;
  let auditService: any;
  let service: PasskeyService;

  beforeEach(() => {
    jest.clearAllMocks();
    const db = {
      transaction: () => ({ execute: (callback: any) => callback({}) }),
    };
    accountRepo = { findByUser: jest.fn().mockResolvedValue({ userHandle }) };
    passkeyRepo = {
      findByCredentialId: jest.fn().mockResolvedValue(passkey),
      updateAuthenticationState: jest.fn(),
      disable: jest.fn(),
      countForUser: jest.fn().mockResolvedValue(0),
      insert: jest.fn(),
    };
    challengeRepo = { consume: jest.fn().mockResolvedValue(challenge) };
    userRepo = { findById: jest.fn().mockResolvedValue(user) };
    loginFlow = {
      begin: jest.fn().mockResolvedValue({ authToken: 'auth-token' }),
    };
    loginAttempt = {
      assertAllowed: jest.fn(),
      recordFailure: jest.fn(),
    };
    securityNotification = { notify: jest.fn() };
    auditService = { log: jest.fn(), setActorId: jest.fn() };
    service = new PasskeyService(
      db as any,
      accountRepo,
      passkeyRepo,
      challengeRepo,
      {} as any,
      userRepo,
      {} as any,
      loginFlow,
      loginAttempt,
      securityNotification,
      auditService,
    );
  });

  it('updates the credential counter and enters the shared login flow', async () => {
    jest.mocked(verifyAuthenticationResponse).mockResolvedValue({
      verified: true,
      authenticationInfo: { newCounter: 2 },
    } as any);

    await expect(
      service.verifyAuthentication(authenticationDto(), workspace),
    ).resolves.toEqual({ authToken: 'auth-token' });

    expect(challengeRepo.consume).toHaveBeenCalledWith({
      id: 'challenge-id',
      workspaceId: workspace.id,
      type: 'authentication',
    });
    expect(loginAttempt.assertAllowed).toHaveBeenCalledWith(
      workspace.id,
      user.id,
      'passkey',
    );
    expect(verifyAuthenticationResponse).toHaveBeenCalledWith(
      expect.objectContaining({
        expectedChallenge: challenge.challenge,
        expectedOrigin: challenge.expectedOrigin,
        expectedRPID: challenge.rpId,
        requireUserVerification: true,
      }),
    );
    expect(passkeyRepo.updateAuthenticationState).toHaveBeenCalledWith(
      passkey.id,
      2,
      expect.anything(),
    );
    expect(loginFlow.begin).toHaveBeenCalledWith(user, workspace, {
      primaryAuth: 'passkey',
      passkeyId: passkey.id,
    });
  });

  it('does not persist an audit row or arbitrary account counter for an unknown credential', async () => {
    passkeyRepo.findByCredentialId.mockResolvedValue(undefined);

    await expect(
      service.verifyAuthentication(authenticationDto(), workspace),
    ).rejects.toMatchObject({ status: 401 });

    expect(loginAttempt.recordFailure).not.toHaveBeenCalled();
    expect(auditService.log).not.toHaveBeenCalled();
  });

  it('counts and audits a known-user verification failure without sensitive response data', async () => {
    jest
      .mocked(verifyAuthenticationResponse)
      .mockRejectedValue(new Error('signature invalid'));

    await expect(
      service.verifyAuthentication(authenticationDto(), workspace),
    ).rejects.toMatchObject({ status: 401 });

    expect(loginAttempt.recordFailure).toHaveBeenCalledWith(
      workspace.id,
      user.id,
      'passkey',
    );
    expect(auditService.log).toHaveBeenCalledWith({
      event: AuditEvent.USER_LOGIN_FAILED,
      resourceType: 'user',
      resourceId: user.id,
      metadata: { source: 'passkey', reason: 'verification_failed' },
    });
    expect(JSON.stringify(auditService.log.mock.calls)).not.toContain(
      'credential-id',
    );
    expect(JSON.stringify(auditService.log.mock.calls)).not.toContain(
      'signature invalid',
    );
  });

  it('disables only the affected credential when its signature counter regresses', async () => {
    jest
      .mocked(verifyAuthenticationResponse)
      .mockRejectedValue(
        new Error('Response counter value 1 was lower than expected'),
      );

    await expect(
      service.verifyAuthentication(authenticationDto(), workspace),
    ).rejects.toMatchObject({ status: 401 });

    expect(passkeyRepo.disable).toHaveBeenCalledWith(
      passkey.id,
      'counter_anomaly',
    );
    expect(auditService.log).toHaveBeenCalledWith({
      event: AuditEvent.USER_PASSKEY_COUNTER_ANOMALY,
      resourceType: 'passkey',
      resourceId: passkey.id,
    });
  });

  it('consumes a challenge before lookup so replay cannot retry verification', async () => {
    challengeRepo.consume
      .mockResolvedValueOnce(challenge)
      .mockResolvedValueOnce(undefined);
    passkeyRepo.findByCredentialId.mockResolvedValue(undefined);

    await expect(
      service.verifyAuthentication(authenticationDto(), workspace),
    ).rejects.toMatchObject({ status: 401 });
    await expect(
      service.verifyAuthentication(authenticationDto(), workspace),
    ).rejects.toMatchObject({ status: 401 });

    expect(passkeyRepo.findByCredentialId).toHaveBeenCalledTimes(1);
  });

  it('maps duplicate credential registration to a stable 400 without side effects', async () => {
    jest.mocked(verifyRegistrationResponse).mockResolvedValue({
      verified: true,
      registrationInfo: {
        credential: {
          id: 'duplicate-credential',
          publicKey: new Uint8Array([1, 2, 3]),
          counter: 0,
          transports: ['internal'],
        },
        credentialDeviceType: 'multiDevice',
        credentialBackedUp: true,
      },
    } as any);
    passkeyRepo.insert.mockRejectedValue(
      Object.assign(new Error('unique violation'), { code: '23505' }),
    );

    await expect(
      service.verifyRegistration(
        registrationDto(),
        user,
        workspace,
        'session-id',
      ),
    ).rejects.toMatchObject({ status: 400 });

    expect(auditService.log).not.toHaveBeenCalled();
    expect(securityNotification.notify).not.toHaveBeenCalled();
  });

  function authenticationDto() {
    return {
      challengeId: 'challenge-id',
      credential: {
        id: passkey.credentialId,
        rawId: passkey.credentialId,
        type: 'public-key',
        response: {
          clientDataJSON: Buffer.from(
            JSON.stringify({
              type: 'webauthn.get',
              challenge: challenge.challenge,
              origin: challenge.expectedOrigin,
              crossOrigin: false,
            }),
          ).toString('base64url'),
          authenticatorData: 'AA',
          signature: 'AA',
          userHandle: userHandle.toString('base64url'),
        },
        clientExtensionResults: {},
      },
    } as any;
  }

  function registrationDto() {
    return {
      challengeId: 'challenge-id',
      name: 'Laptop',
      credential: {
        id: 'duplicate-credential',
        rawId: 'duplicate-credential',
        type: 'public-key',
        response: {
          clientDataJSON: Buffer.from(
            JSON.stringify({
              type: 'webauthn.create',
              challenge: challenge.challenge,
              origin: challenge.expectedOrigin,
              crossOrigin: false,
            }),
          ).toString('base64url'),
          attestationObject: 'AA',
        },
        clientExtensionResults: {},
      },
    } as any;
  }
});
