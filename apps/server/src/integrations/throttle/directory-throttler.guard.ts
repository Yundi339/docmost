import { Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import {
  InjectThrottlerOptions,
  InjectThrottlerStorage,
  ThrottlerModuleOptions,
  ThrottlerStorage,
} from '@nestjs/throttler';
import { UserThrottlerGuard } from './user-throttler.guard';
import { DIRECTORY_THROTTLER } from './throttler-names';

@Injectable()
export class DirectoryThrottlerGuard extends UserThrottlerGuard {
  constructor(
    @InjectThrottlerOptions() options: ThrottlerModuleOptions,
    @InjectThrottlerStorage() storageService: ThrottlerStorage,
    reflector: Reflector,
  ) {
    super(options, storageService, reflector);
  }

  async onModuleInit(): Promise<void> {
    await super.onModuleInit();
    this.throttlers = this.throttlers.filter(
      (throttler) => throttler.name === DIRECTORY_THROTTLER,
    );

    if (this.throttlers.length !== 1) {
      throw new Error('Directory throttler is not configured');
    }
  }
}
