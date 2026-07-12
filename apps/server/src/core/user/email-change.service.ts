import { createHash, randomBytes } from 'crypto';
import {
  BadRequestException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectKysely } from 'nestjs-kysely';
import { KyselyDB } from '@docmost/db/types/kysely.types';
import { User, Workspace } from '@docmost/db/types/entity.types';
import { executeTx } from '@docmost/db/utils';
import { sql } from 'kysely';
import { comparePasswordHash } from '../../common/helpers/utils';
import { SsoEnforcementService } from '../auth/services/sso-enforcement.service';
import { DomainService } from '../../integrations/environment/domain.service';
import { MailService } from '../../integrations/mail/mail.service';
import EmailChangeConfirmationEmail from '../../integrations/transactional/emails/email-change-confirmation-email';
import EmailChangedEmail from '../../integrations/transactional/emails/email-changed-email';
import {
  AUDIT_SERVICE,
  IAuditService,
} from '../../integrations/audit/audit.service';
import { AuditEvent, AuditResource } from '../../common/events/audit-events';
import {
  ConfirmEmailChangeDto,
  RequestEmailChangeDto,
} from './dto/email-change.dto';

const EMAIL_CHANGE_TTL_MS = 30 * 60 * 1000;

@Injectable()
export class EmailChangeService {
  private readonly logger = new Logger(EmailChangeService.name);

  constructor(
    @InjectKysely() private readonly db: KyselyDB,
    private readonly ssoEnforcement: SsoEnforcementService,
    private readonly domainService: DomainService,
    private readonly mailService: MailService,
    @Inject(AUDIT_SERVICE) private readonly auditService: IAuditService,
  ) {}

  async request(
    dto: RequestEmailChangeDto,
    authUser: User,
    workspace: Workspace,
  ): Promise<{ expiresAt: Date }> {
    await this.ssoEnforcement.assertLocalAuthAllowed(workspace);

    const user = await this.db
      .selectFrom('users')
      .select(['id', 'email', 'name', 'password', 'deactivatedAt', 'deletedAt'])
      .where('id', '=', authUser.id)
      .where('workspaceId', '=', workspace.id)
      .executeTakeFirst();

    if (!user || user.deactivatedAt || user.deletedAt) {
      throw new NotFoundException('User not found');
    }
    if (!user.password) {
      throw new BadRequestException(
        'A local password is required to change your email',
      );
    }
    if (user.email.toLowerCase() === dto.email) {
      throw new BadRequestException(
        'The new email must be different from your current email',
      );
    }
    if (!(await comparePasswordHash(dto.password, user.password))) {
      throw new BadRequestException('Your current password is incorrect');
    }
    if (await this.emailExists(dto.email, workspace.id)) {
      throw new BadRequestException('A user with this email already exists');
    }

    const token = randomBytes(32).toString('base64url');
    const tokenHash = hashEmailChangeToken(token);
    const expiresAt = new Date(Date.now() + EMAIL_CHANGE_TTL_MS);

    const request = await executeTx(this.db, async (trx) => {
      return trx
        .insertInto('userEmailChangeRequests')
        .values({
          userId: user.id,
          workspaceId: workspace.id,
          newEmail: dto.email,
          tokenHash,
          expiresAt,
        })
        .onConflict((conflict) =>
          conflict.columns(['userId', 'workspaceId']).doUpdateSet({
            newEmail: dto.email,
            tokenHash,
            expiresAt,
            usedAt: null,
            createdAt: new Date(),
          }),
        )
        .returning('id')
        .executeTakeFirstOrThrow();
    });

    const confirmationLink = `${this.domainService.getUrl(
      workspace.hostname,
    )}/settings/account/profile#emailChangeToken=${encodeURIComponent(token)}`;

    try {
      await this.mailService.sendToQueue({
        to: dto.email,
        subject: 'Confirm your email change',
        template: EmailChangeConfirmationEmail({
          username: user.name,
          confirmationLink,
        }),
      });
    } catch (error) {
      await this.db
        .deleteFrom('userEmailChangeRequests')
        .where('id', '=', request.id)
        .where('tokenHash', '=', tokenHash)
        .execute();
      throw error;
    }

    this.auditService.log({
      event: AuditEvent.USER_EMAIL_CHANGE_REQUESTED,
      resourceType: AuditResource.USER,
      resourceId: user.id,
      changes: { before: { email: user.email }, after: { email: dto.email } },
    });

    return { expiresAt };
  }

  async confirm(
    dto: ConfirmEmailChangeDto,
    authUser: User,
    workspace: Workspace,
  ): Promise<{ email: string }> {
    const tokenHash = hashEmailChangeToken(dto.token);

    const result = await executeTx(this.db, async (trx) => {
      await this.ssoEnforcement.lockWorkspace(workspace.id, trx);
      const currentWorkspace = await trx
        .selectFrom('workspaces')
        .select(['id', 'enforceSso'])
        .where('id', '=', workspace.id)
        .executeTakeFirstOrThrow();
      await this.ssoEnforcement.assertLocalAuthAllowed(currentWorkspace);

      const request = await trx
        .selectFrom('userEmailChangeRequests')
        .selectAll()
        .where('tokenHash', '=', tokenHash)
        .where('userId', '=', authUser.id)
        .where('workspaceId', '=', workspace.id)
        .forUpdate()
        .executeTakeFirst();

      if (!request || request.usedAt || request.expiresAt <= new Date()) {
        throw new BadRequestException('Invalid or expired email change link');
      }

      const user = await trx
        .selectFrom('users')
        .select(['id', 'email', 'name', 'deactivatedAt', 'deletedAt'])
        .where('id', '=', authUser.id)
        .where('workspaceId', '=', workspace.id)
        .forUpdate()
        .executeTakeFirst();

      if (!user || user.deactivatedAt || user.deletedAt) {
        throw new NotFoundException('User not found');
      }

      const existing = await trx
        .selectFrom('users')
        .select('id')
        .where('workspaceId', '=', workspace.id)
        .where('id', '!=', user.id)
        .where(sql<string>`LOWER(email)`, '=', request.newEmail.toLowerCase())
        .executeTakeFirst();
      if (existing) {
        throw new BadRequestException('A user with this email already exists');
      }

      try {
        await trx
          .updateTable('users')
          .set({
            email: request.newEmail,
            emailVerifiedAt: new Date(),
            updatedAt: new Date(),
          })
          .where('id', '=', user.id)
          .where('workspaceId', '=', workspace.id)
          .executeTakeFirstOrThrow();
      } catch (error) {
        if ((error as { code?: string })?.code === '23505') {
          throw new BadRequestException(
            'A user with this email already exists',
          );
        }
        throw error;
      }

      await trx
        .updateTable('userEmailChangeRequests')
        .set({ usedAt: new Date() })
        .where('id', '=', request.id)
        .where('usedAt', 'is', null)
        .executeTakeFirstOrThrow();

      return {
        userId: user.id,
        username: user.name,
        oldEmail: user.email,
        newEmail: request.newEmail,
      };
    });

    this.auditService.log({
      event: AuditEvent.USER_EMAIL_CHANGED,
      resourceType: AuditResource.USER,
      resourceId: result.userId,
      changes: {
        before: { email: result.oldEmail },
        after: { email: result.newEmail },
      },
    });

    try {
      await this.mailService.sendToQueue({
        to: result.oldEmail,
        subject: 'Your account email was changed',
        template: EmailChangedEmail({
          username: result.username,
          newEmail: result.newEmail,
        }),
      });
    } catch {
      this.logger.error(
        `Failed to enqueue email-change security notification for user ${result.userId}`,
      );
    }

    return { email: result.newEmail };
  }

  private async emailExists(email: string, workspaceId: string) {
    return Boolean(
      await this.db
        .selectFrom('users')
        .select('id')
        .where('workspaceId', '=', workspaceId)
        .where(sql<string>`LOWER(email)`, '=', email.toLowerCase())
        .executeTakeFirst(),
    );
  }
}

function hashEmailChangeToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}
