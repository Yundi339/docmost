import { UserRepo } from '@docmost/db/repos/user/user.repo';
import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { UpdateUserDto } from './dto/update-user.dto';
import { NotificationSettingKey } from '../notification/notification.constants';
import { diffAuditTrackedFields } from 'src/common/helpers/utils';
import { Workspace } from '@docmost/db/types/entity.types';
import { AuditEvent, AuditResource } from '../../common/events/audit-events';
import {
  AUDIT_SERVICE,
  IAuditService,
} from '../../integrations/audit/audit.service';

@Injectable()
export class UserService {
  constructor(
    private userRepo: UserRepo,
    @Inject(AUDIT_SERVICE) private readonly auditService: IAuditService,
  ) {}

  async findById(userId: string, workspaceId: string) {
    return this.userRepo.findById(userId, workspaceId);
  }

  async update(
    updateUserDto: UpdateUserDto,
    userId: string,
    workspace: Workspace,
  ) {
    const user = await this.userRepo.findById(userId, workspace.id);

    if (!user) {
      throw new NotFoundException('User not found');
    }

    // preference update
    if (typeof updateUserDto.fullPageWidth !== 'undefined') {
      return this.userRepo.updatePreference(
        userId,
        'fullPageWidth',
        updateUserDto.fullPageWidth,
      );
    }

    if (typeof updateUserDto.pageEditMode !== 'undefined') {
      return this.userRepo.updatePreference(
        userId,
        'pageEditMode',
        updateUserDto.pageEditMode.toLowerCase(),
      );
    }

    if (typeof updateUserDto.spellcheck !== 'undefined') {
      return this.userRepo.updatePreference(
        userId,
        'spellcheck',
        updateUserDto.spellcheck,
      );
    }

    if (typeof updateUserDto.editorToolbar !== 'undefined') {
      return this.userRepo.updatePreference(
        userId,
        'editorToolbar',
        updateUserDto.editorToolbar,
      );
    }

    const notificationSettings: Record<string, NotificationSettingKey> = {
      notificationPageUpdates: 'page.updated',
      notificationPageUserMention: 'page.userMention',
      notificationCommentUserMention: 'comment.userMention',
      notificationCommentCreated: 'comment.created',
      notificationCommentResolved: 'comment.resolved',
    };

    for (const [dtoField, settingKey] of Object.entries(notificationSettings)) {
      if (typeof updateUserDto[dtoField] !== 'undefined') {
        return this.userRepo.updateNotificationSetting(
          userId,
          settingKey,
          updateUserDto[dtoField],
        );
      }
    }

    const userBefore = {
      name: user.name,
      locale: user.locale,
    };

    if (updateUserDto.name) {
      user.name = updateUserDto.name;
    }

    if (updateUserDto.locale) {
      user.locale = updateUserDto.locale;
    }

    await this.userRepo.updateUser(updateUserDto, userId, workspace.id);

    const changes = diffAuditTrackedFields(
      ['name'],
      updateUserDto,
      userBefore,
      user,
    );

    if (changes) {
      this.auditService.log({
        event: AuditEvent.USER_UPDATED,
        resourceType: AuditResource.USER,
        resourceId: userId,
        changes,
      });
    }

    return user;
  }
}
