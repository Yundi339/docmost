import {
  BadRequestException,
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Post,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import { FastifyReply, FastifyRequest } from 'fastify';
import { SkipThrottle, Throttle, ThrottlerGuard } from '@nestjs/throttler';
import { UnlockShareDto } from './dto/share.dto';
import { ShareAccessService } from './share-access.service';
import {
  AI_CHAT_THROTTLER,
  AUTH_THROTTLER,
  FORGOT_PASSWORD_THROTTLER,
  OAUTH_REGISTRATION_THROTTLER,
  OAUTH_TOKEN_THROTTLER,
  SHARE_UNLOCK_THROTTLER,
} from '../../integrations/throttle/throttler-names';

@SkipThrottle({
  [AI_CHAT_THROTTLER]: true,
  [AUTH_THROTTLER]: true,
  [FORGOT_PASSWORD_THROTTLER]: true,
  [OAUTH_REGISTRATION_THROTTLER]: true,
  [OAUTH_TOKEN_THROTTLER]: true,
})
@UseGuards(ThrottlerGuard)
@Controller('shares')
export class ShareAccessController {
  constructor(private readonly shareAccessService: ShareAccessService) {}

  @HttpCode(HttpStatus.OK)
  @Throttle({ [SHARE_UNLOCK_THROTTLER]: { ttl: 60_000, limit: 10 } })
  @Post('/unlock')
  async unlock(
    @Body() dto: UnlockShareDto,
    @Req() request: FastifyRequest,
    @Res({ passthrough: true }) reply: FastifyReply,
  ) {
    if (Boolean(dto.shareId) === Boolean(dto.pageId)) {
      throw new BadRequestException('Provide exactly one of shareId or pageId');
    }
    reply.header('Cache-Control', 'no-store');
    return this.shareAccessService.unlock(request, reply, dto);
  }
}
