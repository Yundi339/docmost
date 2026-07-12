import {
  BadRequestException,
  HttpException,
  HttpStatus,
  Inject,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { Interval } from '@nestjs/schedule';
import { InjectKysely } from 'nestjs-kysely';
import {
  AuthenticationResponseJSON,
  AuthenticatorTransportFuture,
  generateAuthenticationOptions,
  generateRegistrationOptions,
  RegistrationResponseJSON,
  verifyAuthenticationResponse,
  verifyRegistrationResponse,
} from '@simplewebauthn/server';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { KyselyDB } from '@docmost/db/types/kysely.types';
import { executeTx } from '@docmost/db/utils';
import { PasskeyAccountRepo } from '@docmost/db/repos/passkey/passkey-account.repo';
import { UserPasskeyRepo } from '@docmost/db/repos/passkey/user-passkey.repo';
import { PasskeyChallengeRepo } from '@docmost/db/repos/passkey/passkey-challenge.repo';
import { UserSessionRepo } from '@docmost/db/repos/session/user-session.repo';
import { UserRepo } from '@docmost/db/repos/user/user.repo';
import { User, UserPasskey, Workspace } from '@docmost/db/types/entity.types';
import { comparePasswordHash } from '../../common/helpers';
import { LoginFlowService } from '../../core/auth/services/login-flow.service';
import { LoginAttemptService } from '../../core/auth/services/login-attempt.service';
import { PasskeyOriginService } from './passkey-origin.service';
import {
  DeletePasskeyDto,
  PasskeyAuthenticationVerifyDto,
  PasskeyRegistrationOptionsDto,
  PasskeyRegistrationVerifyDto,
  UpdatePasskeyDto,
} from './dto/passkey.dto';
import {
  AUDIT_SERVICE,
  IAuditService,
} from '../../integrations/audit/audit.service';
import { AuditEvent, AuditResource } from '../../common/events/audit-events';
import { PasskeySecurityNotificationService } from './passkey-security-notification.service';
import { SsoEnforcementService } from '../../core/auth/services/sso-enforcement.service';

const CHALLENGE_TTL_MS = 5 * 60 * 1000;
const CEREMONY_TIMEOUT_MS = 60 * 1000;
const MAX_PASSKEYS_PER_USER = 10;
const MAX_CREDENTIAL_RESPONSE_BYTES = 128 * 1024;
const ALLOWED_TRANSPORTS = new Set<AuthenticatorTransportFuture>([
  'ble',
  'cable',
  'hybrid',
  'internal',
  'nfc',
  'smart-card',
  'usb',
]);

@Injectable()
export class PasskeyService {
  constructor(
    @InjectKysely() private readonly db: KyselyDB,
    private readonly passkeyAccountRepo: PasskeyAccountRepo,
    private readonly userPasskeyRepo: UserPasskeyRepo,
    private readonly passkeyChallengeRepo: PasskeyChallengeRepo,
    private readonly userSessionRepo: UserSessionRepo,
    private readonly userRepo: UserRepo,
    private readonly originService: PasskeyOriginService,
    private readonly loginFlowService: LoginFlowService,
    private readonly loginAttemptService: LoginAttemptService,
    private readonly securityNotification: PasskeySecurityNotificationService,
    @Inject(AUDIT_SERVICE) private readonly auditService: IAuditService,
    private readonly ssoEnforcement: SsoEnforcementService,
  ) {}

  @Interval('passkey-challenge-cleanup', 15 * 60 * 1000)
  async cleanupExpiredChallenges(): Promise<void> {
    await this.passkeyChallengeRepo.deleteExpired();
  }

  getStatus(workspace: Workspace) {
    return this.originService.getStatus(workspace);
  }

  async createAuthenticationOptions(workspace: Workspace) {
    const origin = this.originService.getConfig(workspace);
    const options = await generateAuthenticationOptions({
      rpID: origin.rpId,
      timeout: CEREMONY_TIMEOUT_MS,
      userVerification: 'required',
    });
    const challengeId = this.randomToken();
    await this.passkeyChallengeRepo.insert({
      id: challengeId,
      workspaceId: workspace.id,
      userId: null,
      sessionId: null,
      type: 'authentication',
      challenge: options.challenge,
      expectedOrigin: origin.expectedOrigin,
      rpId: origin.rpId,
      expiresAt: new Date(Date.now() + CHALLENGE_TTL_MS),
    });
    return { challengeId, options };
  }

  async verifyAuthentication(
    dto: PasskeyAuthenticationVerifyDto,
    workspace: Workspace,
  ) {
    this.assertCredentialResponseSize(dto.credential);
    const credential = dto.credential as unknown as AuthenticationResponseJSON;
    this.assertCredentialEnvelope(credential);
    this.assertSameOriginCeremony(credential.response.clientDataJSON);

    const challenge = await this.passkeyChallengeRepo.consume({
      id: dto.challengeId,
      workspaceId: workspace.id,
      type: 'authentication',
    });
    if (!challenge) {
      throw this.authenticationFailed();
    }

    let passkeyId: string | undefined;
    let user: User | undefined;
    try {
      const verified = await executeTx(this.db, async (trx) => {
        const passkey = await this.userPasskeyRepo.findByCredentialId(
          credential.id,
          workspace.id,
          { trx, forUpdate: true },
        );
        if (!passkey) throw this.authenticationFailed();
        passkeyId = passkey.id;

        await this.loginAttemptService.assertAllowed(
          workspace.id,
          passkey.userId,
          'passkey',
        );

        const account = await this.passkeyAccountRepo.findByUser(
          passkey.userId,
          workspace.id,
          { trx },
        );
        user = await this.userRepo.findById(passkey.userId, workspace.id, {
          trx,
        });
        if (!account || !user) throw this.authenticationFailed();
        this.assertUserHandle(credential, account.userHandle);

        const result = await verifyAuthenticationResponse({
          response: credential,
          expectedChallenge: challenge.challenge,
          expectedOrigin: challenge.expectedOrigin,
          expectedRPID: challenge.rpId,
          credential: {
            id: passkey.credentialId,
            publicKey: new Uint8Array(passkey.publicKey),
            counter: Number(passkey.counter),
            transports: this.filterTransports(passkey.transports),
          },
          requireUserVerification: true,
        });
        if (!result.verified) throw this.authenticationFailed();
        await this.userPasskeyRepo.updateAuthenticationState(
          passkey.id,
          result.authenticationInfo.newCounter,
          trx,
        );
        return true;
      });
      if (!verified || !user || !passkeyId) throw this.authenticationFailed();
    } catch (error) {
      if (
        error instanceof HttpException &&
        error.getStatus() === HttpStatus.TOO_MANY_REQUESTS
      ) {
        throw error;
      }
      if (passkeyId && this.isCounterAnomaly(error)) {
        await this.userPasskeyRepo.disable(passkeyId, 'counter_anomaly');
        this.auditService.log({
          event: AuditEvent.USER_PASSKEY_COUNTER_ANOMALY,
          resourceType: AuditResource.PASSKEY,
          resourceId: passkeyId,
        });
      }
      if (user) {
        await this.loginAttemptService.recordFailure(
          workspace.id,
          user.id,
          'passkey',
        );
        this.auditService.setActorId(user.id);
      }
      if (user) {
        this.auditService.log({
          event: AuditEvent.USER_LOGIN_FAILED,
          resourceType: AuditResource.USER,
          resourceId: user.id,
          metadata: { source: 'passkey', reason: 'verification_failed' },
        });
      }
      throw this.authenticationFailed();
    }

    return this.loginFlowService.begin(user, workspace, {
      primaryAuth: 'passkey',
      passkeyId,
    });
  }

  async list(user: User, workspace: Workspace) {
    const passkeys = await this.userPasskeyRepo.listForUser(
      user.id,
      workspace.id,
    );
    return passkeys.map((passkey) => this.toPublicPasskey(passkey));
  }

  async createRegistrationOptions(
    dto: PasskeyRegistrationOptionsDto,
    user: User,
    workspace: Workspace,
    sessionId: string,
  ) {
    this.originService.getConfig(workspace);
    await this.assertCurrentPassword(dto.currentPassword, user, workspace);
    const existing = await this.userPasskeyRepo.listForUser(
      user.id,
      workspace.id,
    );
    if (existing.length >= MAX_PASSKEYS_PER_USER) {
      throw new BadRequestException('Passkey limit reached');
    }

    return executeTx(this.db, async (trx) => {
      let account = await this.passkeyAccountRepo.findByUser(
        user.id,
        workspace.id,
        { trx },
      );
      if (!account) {
        account = await this.passkeyAccountRepo.insert(
          {
            workspaceId: workspace.id,
            userId: user.id,
            userHandle: randomBytes(64),
          },
          trx,
        );
        account ??= await this.passkeyAccountRepo.findByUser(
          user.id,
          workspace.id,
          { trx },
        );
      }
      if (!account) throw new BadRequestException('Passkey setup failed');

      const origin = this.originService.getConfig(workspace);
      const options = await generateRegistrationOptions({
        rpName: workspace.name || 'Docmost',
        rpID: origin.rpId,
        userID: new Uint8Array(account.userHandle),
        userName: user.email,
        userDisplayName: user.name || user.email,
        timeout: CEREMONY_TIMEOUT_MS,
        attestationType: 'none',
        excludeCredentials: existing.map((passkey) => ({
          id: passkey.credentialId,
          transports: this.filterTransports(passkey.transports),
        })),
        authenticatorSelection: {
          residentKey: 'required',
          requireResidentKey: true,
          userVerification: 'required',
        },
        supportedAlgorithmIDs: [-7, -257],
      });

      await this.passkeyChallengeRepo.deleteForSessionType(
        sessionId,
        'registration',
        trx,
      );
      const challengeId = this.randomToken();
      await this.passkeyChallengeRepo.insert(
        {
          id: challengeId,
          workspaceId: workspace.id,
          userId: user.id,
          sessionId,
          type: 'registration',
          challenge: options.challenge,
          expectedOrigin: origin.expectedOrigin,
          rpId: origin.rpId,
          expiresAt: new Date(Date.now() + CHALLENGE_TTL_MS),
        },
        trx,
      );
      return { challengeId, options };
    });
  }

  async verifyRegistration(
    dto: PasskeyRegistrationVerifyDto,
    user: User,
    workspace: Workspace,
    sessionId: string,
  ) {
    this.assertCredentialResponseSize(dto.credential);
    const credential = dto.credential as unknown as RegistrationResponseJSON;
    this.assertCredentialEnvelope(credential);
    this.assertSameOriginCeremony(credential.response.clientDataJSON);
    const challenge = await this.passkeyChallengeRepo.consume({
      id: dto.challengeId,
      workspaceId: workspace.id,
      userId: user.id,
      sessionId,
      type: 'registration',
    });
    if (!challenge) throw new BadRequestException('Passkey request expired');

    const result = await verifyRegistrationResponse({
      response: credential,
      expectedChallenge: challenge.challenge,
      expectedOrigin: challenge.expectedOrigin,
      expectedRPID: challenge.rpId,
      requireUserPresence: true,
      requireUserVerification: true,
      supportedAlgorithmIDs: [-7, -257],
    });
    if (!result.verified || !result.registrationInfo) {
      throw new BadRequestException('Passkey registration failed');
    }

    const info = result.registrationInfo;
    let passkey: UserPasskey;
    try {
      passkey = await executeTx(this.db, async (trx) => {
        const account = await this.passkeyAccountRepo.findByUser(
          user.id,
          workspace.id,
          { trx, forUpdate: true },
        );
        if (!account) throw new BadRequestException('Passkey setup expired');
        if (
          (await this.userPasskeyRepo.countForUser(
            user.id,
            workspace.id,
            trx,
          )) >= MAX_PASSKEYS_PER_USER
        ) {
          throw new BadRequestException('Passkey limit reached');
        }
        return this.userPasskeyRepo.insert(
          {
            workspaceId: workspace.id,
            userId: user.id,
            credentialId: info.credential.id,
            publicKey: Buffer.from(info.credential.publicKey),
            counter: info.credential.counter,
            transports: this.filterTransports(info.credential.transports || []),
            deviceType: info.credentialDeviceType,
            backedUp: info.credentialBackedUp,
            name: dto.name,
          },
          trx,
        );
      });
    } catch (error) {
      if ((error as { code?: string })?.code === '23505') {
        throw new BadRequestException('Passkey is already registered');
      }
      throw error;
    }

    this.auditService.log({
      event: AuditEvent.USER_PASSKEY_CREATED,
      resourceType: AuditResource.PASSKEY,
      resourceId: passkey.id,
      metadata: { name: passkey.name, deviceType: passkey.deviceType },
    });
    await this.securityNotification.notify(user, 'added', passkey.name);
    return this.toPublicPasskey(passkey);
  }

  async rename(dto: UpdatePasskeyDto, user: User, workspace: Workspace) {
    const passkey = await this.userPasskeyRepo.rename(
      dto.passkeyId,
      user.id,
      workspace.id,
      dto.name,
    );
    if (!passkey) throw new NotFoundException('Passkey not found');
    this.auditService.log({
      event: AuditEvent.USER_PASSKEY_RENAMED,
      resourceType: AuditResource.PASSKEY,
      resourceId: passkey.id,
      metadata: { name: passkey.name },
    });
    return this.toPublicPasskey(passkey);
  }

  async delete(dto: DeletePasskeyDto, user: User, workspace: Workspace) {
    await this.assertCurrentPassword(dto.currentPassword, user, workspace);
    const current = await this.userPasskeyRepo.findByIdForUser(
      dto.passkeyId,
      user.id,
      workspace.id,
    );
    if (!current) throw new NotFoundException('Passkey not found');

    await executeTx(this.db, async (trx) => {
      const deleted = await this.userPasskeyRepo.deleteForUser(
        dto.passkeyId,
        user.id,
        workspace.id,
        trx,
      );
      if (!deleted) throw new NotFoundException('Passkey not found');
      await this.userSessionRepo.revokeByPasskeyId(
        dto.passkeyId,
        user.id,
        workspace.id,
        trx,
      );
    });

    this.auditService.log({
      event: AuditEvent.USER_PASSKEY_DELETED,
      resourceType: AuditResource.PASSKEY,
      resourceId: dto.passkeyId,
      metadata: { name: current.name },
    });
    await this.securityNotification.notify(user, 'removed', current.name);
  }

  private async assertCurrentPassword(
    password: string,
    user: User,
    workspace: Workspace,
  ): Promise<void> {
    await this.ssoEnforcement.assertLocalAuthAllowed(workspace);
    const account = await this.userRepo.findById(user.id, workspace.id, {
      includePassword: true,
    });
    if (!account?.password) {
      throw new BadRequestException(
        'A local password is required to manage passkeys.',
      );
    }
    await this.loginAttemptService.assertAllowed(
      workspace.id,
      user.id,
      'password',
    );
    if (!(await comparePasswordHash(password, account.password))) {
      await this.loginAttemptService.recordFailure(
        workspace.id,
        user.id,
        'password',
      );
      this.auditService.log({
        event: AuditEvent.USER_LOGIN_FAILED,
        resourceType: AuditResource.USER,
        resourceId: user.id,
        metadata: { source: 'password', reason: 'step_up_failed' },
      });
      throw new UnauthorizedException('Current password is incorrect');
    }
  }

  private assertCredentialEnvelope(
    credential: AuthenticationResponseJSON | RegistrationResponseJSON,
  ): void {
    if (
      !credential ||
      typeof credential.id !== 'string' ||
      credential.id.length < 1 ||
      credential.id.length > 2048 ||
      !credential.response ||
      typeof credential.response.clientDataJSON !== 'string'
    ) {
      throw new BadRequestException('Invalid Passkey response');
    }
  }

  private assertCredentialResponseSize(credential: unknown): void {
    if (
      Buffer.byteLength(JSON.stringify(credential), 'utf8') >
      MAX_CREDENTIAL_RESPONSE_BYTES
    ) {
      throw new BadRequestException('Passkey response is too large');
    }
  }

  private assertSameOriginCeremony(clientDataJSON: string): void {
    try {
      const clientData = JSON.parse(
        Buffer.from(clientDataJSON, 'base64url').toString('utf8'),
      );
      if (clientData?.crossOrigin === true || clientData?.topOrigin != null) {
        throw new Error('cross-origin ceremony');
      }
    } catch {
      throw new BadRequestException(
        'Cross-origin Passkey requests are not allowed',
      );
    }
  }

  private assertUserHandle(
    credential: AuthenticationResponseJSON,
    expected: Buffer,
  ): void {
    const encoded = credential.response.userHandle;
    if (!encoded) throw this.authenticationFailed();
    const received = Buffer.from(encoded, 'base64url');
    if (
      received.length !== expected.length ||
      !timingSafeEqual(received, expected)
    ) {
      throw this.authenticationFailed();
    }
  }

  private filterTransports(
    transports: readonly string[] | undefined,
  ): AuthenticatorTransportFuture[] {
    return (transports || []).filter((transport) =>
      ALLOWED_TRANSPORTS.has(transport as AuthenticatorTransportFuture),
    ) as AuthenticatorTransportFuture[];
  }

  private toPublicPasskey(passkey: {
    id: string;
    name: string;
    deviceType: string;
    backedUp: boolean;
    disabledAt: Date | null;
    createdAt: Date;
    lastUsedAt: Date | null;
  }) {
    return {
      id: passkey.id,
      name: passkey.name,
      deviceType: passkey.deviceType,
      backedUp: passkey.backedUp,
      disabled: Boolean(passkey.disabledAt),
      createdAt: passkey.createdAt,
      lastUsedAt: passkey.lastUsedAt,
    };
  }

  private randomToken(): string {
    return randomBytes(32).toString('base64url');
  }

  private isCounterAnomaly(error: unknown): boolean {
    return (
      error instanceof Error &&
      error.message.startsWith('Response counter value ')
    );
  }

  private authenticationFailed(): UnauthorizedException {
    return new UnauthorizedException('Passkey authentication failed');
  }
}
