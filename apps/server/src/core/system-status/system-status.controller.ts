import {
  Controller,
  ForbiddenException,
  HttpCode,
  HttpStatus,
  Post,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { AuthUser } from '../../common/decorators/auth-user.decorator';
import { User } from '@docmost/db/types/entity.types';
import { UserRole } from '../../common/helpers/types/permission';
import { SystemStatusService } from './system-status.service';

@UseGuards(JwtAuthGuard)
@Controller('system-status')
export class SystemStatusController {
  constructor(private readonly systemStatusService: SystemStatusService) {}

  @HttpCode(HttpStatus.OK)
  @Post()
  async getStatus(@AuthUser() user: User) {
    // Owner-only. Admins are NOT allowed to read infrastructure metrics —
    // this matches the sidebar gating (role: "owner") and avoids leaking
    // database size / version / connection counts to non-owner admins.
    if (user.role !== UserRole.OWNER) {
      throw new ForbiddenException();
    }
    return this.systemStatusService.getStatus();
  }
}
