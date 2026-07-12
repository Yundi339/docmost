import {
  Body,
  Controller,
  Header,
  HttpCode,
  HttpStatus,
  Post,
  UseGuards,
} from '@nestjs/common';
import { UserService } from './user.service';
import { UpdateUserDto } from './dto/update-user.dto';
import { AuthUser } from '../../common/decorators/auth-user.decorator';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { AuthWorkspace } from '../../common/decorators/auth-workspace.decorator';
import { RequireApiKeyScopes } from '../../common/decorators/api-key-scope.decorator';
import { ApiKeyScope } from '../api-key/api-key-scopes';
import { User, Workspace } from '@docmost/db/types/entity.types';
import { WorkspaceRepo } from '@docmost/db/repos/workspace/workspace.repo';
import { InjectKysely } from 'nestjs-kysely';
import { KyselyDB } from '@docmost/db/types/kysely.types';
import { SsoEnforcementService } from '../auth/services/sso-enforcement.service';
import { SessionAuthGuard } from '../../common/guards/session-auth.guard';
import { SkipThrottle, Throttle, ThrottlerGuard } from '@nestjs/throttler';
import {
  AI_CHAT_THROTTLER,
  AUTH_THROTTLER,
  FORGOT_PASSWORD_THROTTLER,
  OAUTH_REGISTRATION_THROTTLER,
  OAUTH_TOKEN_THROTTLER,
  SHARE_UNLOCK_THROTTLER,
} from '../../integrations/throttle/throttler-names';
import { EmailChangeService } from './email-change.service';
import {
  ConfirmEmailChangeDto,
  RequestEmailChangeDto,
} from './dto/email-change.dto';

const skipUnrelatedThrottlers = {
  [AI_CHAT_THROTTLER]: true,
  [FORGOT_PASSWORD_THROTTLER]: true,
  [OAUTH_REGISTRATION_THROTTLER]: true,
  [OAUTH_TOKEN_THROTTLER]: true,
  [SHARE_UNLOCK_THROTTLER]: true,
};

@UseGuards(JwtAuthGuard)
@Controller('users')
export class UserController {
  constructor(
    private readonly userService: UserService,
    private readonly workspaceRepo: WorkspaceRepo,
    @InjectKysely() private readonly db: KyselyDB,
    private readonly ssoEnforcement: SsoEnforcementService,
    private readonly emailChangeService: EmailChangeService,
  ) {}

  @HttpCode(HttpStatus.OK)
  @RequireApiKeyScopes(ApiKeyScope.REST_READ)
  @Post('me')
  async getUserInfo(
    @AuthUser() authUser: User,
    @AuthWorkspace() workspace: Workspace,
  ) {
    const memberCount = await this.workspaceRepo.getActiveUserCount(
      workspace.id,
    );

    const invitationResult = await this.db
      .selectFrom('workspaceInvitations')
      .select((eb) => eb.fn.countAll().as('count'))
      .where('workspaceId', '=', workspace.id)
      .executeTakeFirst();
    const invitationCount = Number(invitationResult?.count ?? 0);

    const { licenseKey, stripeCustomerId, billingEmail, ...rest } = workspace;

    const workspaceInfo = {
      ...rest,
      enforceSso: await this.ssoEnforcement.isEnforced(workspace),
      memberCount,
      invitationCount,
    };

    return { user: authUser, workspace: workspaceInfo };
  }

  @HttpCode(HttpStatus.OK)
  @Post('update')
  async updateUser(
    @Body() updateUserDto: UpdateUserDto,
    @AuthUser() user: User,
    @AuthWorkspace() workspace: Workspace,
  ) {
    return this.userService.update(updateUserDto, user.id, workspace);
  }

  @UseGuards(SessionAuthGuard, ThrottlerGuard)
  @SkipThrottle(skipUnrelatedThrottlers)
  @Throttle({ [AUTH_THROTTLER]: { ttl: 15 * 60_000, limit: 3 } })
  @Header('Cache-Control', 'no-store')
  @HttpCode(HttpStatus.OK)
  @Post('email-change/request')
  requestEmailChange(
    @Body() dto: RequestEmailChangeDto,
    @AuthUser() user: User,
    @AuthWorkspace() workspace: Workspace,
  ) {
    return this.emailChangeService.request(dto, user, workspace);
  }

  @UseGuards(SessionAuthGuard, ThrottlerGuard)
  @SkipThrottle(skipUnrelatedThrottlers)
  @Throttle({ [AUTH_THROTTLER]: { ttl: 60_000, limit: 10 } })
  @Header('Cache-Control', 'no-store')
  @HttpCode(HttpStatus.OK)
  @Post('email-change/confirm')
  confirmEmailChange(
    @Body() dto: ConfirmEmailChangeDto,
    @AuthUser() user: User,
    @AuthWorkspace() workspace: Workspace,
  ) {
    return this.emailChangeService.confirm(dto, user, workspace);
  }
}
