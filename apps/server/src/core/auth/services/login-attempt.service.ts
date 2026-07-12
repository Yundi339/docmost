import { HttpException, HttpStatus, Injectable } from '@nestjs/common';
import {
  LoginCounterRepo,
  LoginMethod,
} from '@docmost/db/repos/passkey/login-counter.repo';

@Injectable()
export class LoginAttemptService {
  constructor(private readonly loginCounterRepo: LoginCounterRepo) {}

  async assertAllowed(
    workspaceId: string,
    userId: string,
    method: LoginMethod,
  ): Promise<void> {
    const counter = await this.loginCounterRepo.find(
      workspaceId,
      userId,
      method,
    );
    if (counter?.lockedUntil && counter.lockedUntil > new Date()) {
      throw new HttpException(
        'Login is temporarily unavailable. Please try again later.',
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
  }

  async recordFailure(
    workspaceId: string,
    userId: string,
    method: LoginMethod,
  ): Promise<void> {
    await this.loginCounterRepo.recordFailure(workspaceId, userId, method);
  }

  async clearForUser(workspaceId: string, userId: string): Promise<void> {
    await this.loginCounterRepo.clearForUser(workspaceId, userId);
  }
}
