import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import { Workspace } from '@docmost/db/types/entity.types';
import { DomainService } from '../../integrations/environment/domain.service';

export type PasskeyOriginConfig = {
  expectedOrigin: string;
  rpId: string;
};

@Injectable()
export class PasskeyOriginService {
  constructor(private readonly domainService: DomainService) {}

  getConfig(workspace: Workspace): PasskeyOriginConfig {
    const configuredUrl = this.domainService.getUrl(workspace.hostname);
    let url: URL;
    try {
      url = new URL(configuredUrl);
    } catch {
      throw new ServiceUnavailableException(
        'Passkey is unavailable because the public application URL is invalid.',
      );
    }

    const isLocalhost =
      url.hostname === 'localhost' || url.hostname.endsWith('.localhost');
    if (
      url.protocol !== 'https:' &&
      !(isLocalhost && url.protocol === 'http:')
    ) {
      throw new ServiceUnavailableException(
        'Passkey requires HTTPS outside localhost.',
      );
    }

    return { expectedOrigin: url.origin, rpId: url.hostname.toLowerCase() };
  }

  getStatus(workspace: Workspace) {
    try {
      const config = this.getConfig(workspace);
      return { available: true, ...config };
    } catch {
      return { available: false, expectedOrigin: null, rpId: null };
    }
  }
}
