import {
  BadRequestException,
  Inject,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { InjectKysely } from 'nestjs-kysely';
import { KyselyDB } from '@docmost/db/types/kysely.types';
import { User, Workspace } from '@docmost/db/types/entity.types';
import { isUserDisabled } from '../../../common/helpers';
import { throwIfEmailNotVerified } from '../auth.util';
import { EnvironmentService } from '../../../integrations/environment/environment.service';
import { TokenService } from './token.service';
import { SessionService } from '../../session/session.service';
import { UserRepo } from '@docmost/db/repos/user/user.repo';
import { LoginAttemptService } from './login-attempt.service';
import {
  AUDIT_SERVICE,
  IAuditService,
} from '../../../integrations/audit/audit.service';
import { AuditEvent, AuditResource } from '../../../common/events/audit-events';

export type PrimaryAuthMethod = 'password' | 'passkey' | 'sso';

export type LoginFlowContext = {
  primaryAuth: PrimaryAuthMethod;
  passkeyId?: string;
  authTime?: string;
  mfaVerifiedAt?: string;
};

export type LoginFlowResult = {
  authToken?: string;
  mfaToken?: string;
  userHasMfa?: boolean;
  requiresMfaSetup?: boolean;
  isMfaEnforced?: boolean;
};

@Injectable()
export class LoginFlowService {
  constructor(
    @InjectKysely() private readonly db: KyselyDB,
    private readonly tokenService: TokenService,
    private readonly sessionService: SessionService,
    private readonly userRepo: UserRepo,
    private readonly environmentService: EnvironmentService,
    private readonly loginAttemptService: LoginAttemptService,
    @Inject(AUDIT_SERVICE) private readonly auditService: IAuditService,
  ) {}

  async begin(
    user: User,
    workspace: Workspace,
    context: LoginFlowContext,
  ): Promise<LoginFlowResult> {
    this.assertUserCanLogin(user, workspace, context.primaryAuth);

    const mfaRecord = await this.db
      .selectFrom('userMfa')
      .select(['isEnabled'])
      .where('userId', '=', user.id)
      .where('workspaceId', '=', workspace.id)
      .executeTakeFirst();

    const userHasMfa = mfaRecord?.isEnabled === true;
    const isMfaEnforced = workspace.enforceMfa === true;
    const authContext = {
      ...context,
      authTime: context.authTime ?? new Date().toISOString(),
    };

    if (userHasMfa || isMfaEnforced) {
      const mfaToken = await this.tokenService.generateMfaToken(
        user,
        workspace.id,
        authContext,
      );
      return {
        mfaToken,
        userHasMfa,
        requiresMfaSetup: isMfaEnforced && !userHasMfa,
        isMfaEnforced,
      };
    }

    return {
      authToken: await this.complete(user, workspace, authContext),
    };
  }

  async complete(
    user: User,
    workspace: Workspace,
    context: LoginFlowContext,
  ): Promise<string> {
    this.assertUserCanLogin(user, workspace, context.primaryAuth);
    await this.userRepo.updateLastLogin(user.id, workspace.id);
    await this.loginAttemptService.clearForUser(workspace.id, user.id);

    this.auditService.setActorId(user.id);
    this.auditService.log({
      event: AuditEvent.USER_LOGIN,
      resourceType: AuditResource.USER,
      resourceId: user.id,
      metadata: {
        source: context.primaryAuth,
        ...(context.passkeyId ? { passkeyId: context.passkeyId } : {}),
        ...(context.mfaVerifiedAt ? { mfaVerified: true } : {}),
      },
    });

    return this.sessionService.createSessionAndToken(user, {
      primaryAuth: context.primaryAuth,
      ...(context.passkeyId ? { passkeyId: context.passkeyId } : {}),
      authTime: context.authTime ?? new Date().toISOString(),
      ...(context.mfaVerifiedAt
        ? { mfaVerifiedAt: context.mfaVerifiedAt }
        : {}),
    });
  }

  private assertUserCanLogin(
    user: User,
    workspace: Workspace,
    primaryAuth: PrimaryAuthMethod,
  ): void {
    if (!user || isUserDisabled(user)) {
      throw new UnauthorizedException('Authentication failed');
    }
    if (workspace.enforceSso && primaryAuth !== 'sso') {
      throw new BadRequestException('This workspace has enforced SSO login.');
    }
    throwIfEmailNotVerified({
      isCloud: this.environmentService.isCloud(),
      emailVerifiedAt: user.emailVerifiedAt,
      email: user.email,
      workspaceId: workspace.id,
      appSecret: this.environmentService.getAppSecret(),
    });
  }
}
