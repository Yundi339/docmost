import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { hashPassword } from '../../common/helpers';
import { ShareRepo, ShareView } from '@docmost/db/repos/share/share.repo';

@Injectable()
export class SharePasswordService {
  constructor(private readonly shareRepo: ShareRepo) {}

  async setPassword(
    shareId: string,
    password: string,
  ): Promise<{ share: ShareView; wasProtected: boolean }> {
    const current = await this.shareRepo.findPasswordStateById(shareId);
    if (!current) {
      throw new NotFoundException('Share not found');
    }

    const passwordHash = await hashPassword(password);
    const share = await this.shareRepo.setPassword(shareId, passwordHash);
    if (!share) {
      throw new NotFoundException('Share not found');
    }

    return { share, wasProtected: Boolean(current.passwordHash) };
  }

  async removePassword(shareId: string): Promise<ShareView> {
    const current = await this.shareRepo.findPasswordStateById(shareId);
    if (!current) {
      throw new NotFoundException('Share not found');
    }
    if (!current.passwordHash) {
      throw new BadRequestException('Share password is not set');
    }

    const share = await this.shareRepo.removePassword(shareId);
    if (!share) {
      throw new NotFoundException('Share not found');
    }
    return share;
  }
}
