import { Injectable, Logger } from '@nestjs/common';
import { ClsService } from 'nestjs-cls';
import * as Bowser from 'bowser';
import { User } from '@docmost/db/types/entity.types';
import { MailService } from '../../integrations/mail/mail.service';
import PasskeyChangedEmail from '../../integrations/transactional/emails/passkey-changed-email';
import {
  AUDIT_CONTEXT_KEY,
  AuditContext,
} from '../../common/middlewares/audit-context.middleware';

@Injectable()
export class PasskeySecurityNotificationService {
  private readonly logger = new Logger(PasskeySecurityNotificationService.name);

  constructor(
    private readonly mailService: MailService,
    private readonly cls: ClsService,
  ) {}

  async notify(
    user: User,
    action: 'added' | 'removed',
    passkeyName: string,
  ): Promise<void> {
    const context = this.cls.get<AuditContext>(AUDIT_CONTEXT_KEY);
    const template = PasskeyChangedEmail({
      username: user.name,
      action,
      passkeyName,
      occurredAt: new Date().toISOString(),
      ipAddress: context?.ipAddress ?? undefined,
      device: this.describeDevice(context?.userAgent),
    });

    try {
      await this.mailService.sendToQueue({
        to: user.email,
        subject: `Passkey ${action} on your Docmost account`,
        template,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'unknown error';
      this.logger.warn(`Failed to queue Passkey security email: ${message}`);
    }
  }

  private describeDevice(userAgent?: string | null): string | undefined {
    if (!userAgent) return undefined;
    try {
      const parsed = Bowser.parse(userAgent);
      return [parsed.browser?.name, parsed.os?.name]
        .filter(Boolean)
        .join(' on ');
    } catch {
      return undefined;
    }
  }
}
