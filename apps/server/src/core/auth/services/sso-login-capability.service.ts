import { BadRequestException, Injectable } from '@nestjs/common';

export interface SsoLoginCapability {
  providerType: string;
  handler: string;
}

@Injectable()
export class SsoLoginCapabilityService {
  private readonly capabilities = new Map<string, SsoLoginCapability>();

  register(capability: SsoLoginCapability): void {
    const providerType = capability.providerType.trim().toLowerCase();
    const handler = capability.handler.trim();
    if (!providerType || !handler) {
      throw new Error('SSO login capability requires a type and handler');
    }

    const existing = this.capabilities.get(providerType);
    if (existing && existing.handler !== handler) {
      throw new Error(
        `SSO login capability already registered for provider type: ${providerType}`,
      );
    }

    this.capabilities.set(providerType, { providerType, handler });
  }

  isLoginAvailable(providerType: string): boolean {
    return this.capabilities.has(providerType.toLowerCase());
  }

  getAvailableProviderTypes(): string[] {
    return [...this.capabilities.keys()];
  }

  assertLoginAvailable(providerType: string): void {
    if (!this.isLoginAvailable(providerType)) {
      throw new BadRequestException({
        message: `SSO login is not available for provider type: ${providerType}`,
        code: 'SSO_LOGIN_UNAVAILABLE',
      });
    }
  }
}
