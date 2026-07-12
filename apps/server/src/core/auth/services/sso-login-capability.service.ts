import { BadRequestException, Injectable } from '@nestjs/common';

@Injectable()
export class SsoLoginCapabilityService {
  private readonly availableProviderTypes = new Set<string>();

  isLoginAvailable(type: string): boolean {
    return this.availableProviderTypes.has(type);
  }

  assertLoginAvailable(type: string): void {
    if (!this.isLoginAvailable(type)) {
      throw new BadRequestException(
        `SSO login is not available for provider type: ${type}`,
      );
    }
  }
}
