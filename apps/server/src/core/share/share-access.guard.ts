import {
  BadRequestException,
  CanActivate,
  ExecutionContext,
  Injectable,
} from '@nestjs/common';
import { ShareAccessService } from './share-access.service';

@Injectable()
export class ShareAccessGuard implements CanActivate {
  constructor(private readonly shareAccessService: ShareAccessService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest();
    if (request.body?.shareId && request.body?.pageId) {
      throw new BadRequestException('Provide exactly one share locator');
    }
    await this.shareAccessService.assertRequestAccess(request, {
      shareId: request.body?.shareId,
      pageId: request.body?.pageId,
    });
    return true;
  }
}
