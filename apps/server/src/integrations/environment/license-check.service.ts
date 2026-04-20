import { Injectable } from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';
import { EnvironmentService } from './environment.service';

// All features — no license gating, all features enabled unconditionally
const ALL_FEATURES = [
  'sso:custom',
  'sso:google',
  'mfa',
  'api:keys',
  'comment:resolution',
  'page:permissions',
  'ai',
  'import:confluence',
  'import:docx',
  'attachment:indexing',
  'security:settings',
  'mcp',
  'scim',
  'page:verification',
  'audit:logs',
  'retention',
  'sharing:controls',
  'templates',
  'comment:viewer',
];

@Injectable()
export class LicenseCheckService {
  constructor(
    private moduleRef: ModuleRef,
    private environmentService: EnvironmentService,
  ) {}

  isValidEELicense(_licenseKey: string): boolean {
    return true;
  }

  hasFeature(_licenseKey: string, feature: string, _plan?: string): boolean {
    return ALL_FEATURES.includes(feature);
  }

  getFeatures(_licenseKey: string): string[] {
    return [...ALL_FEATURES];
  }

  resolveFeatures(_licenseKey: string, _plan: string): string[] {
    return [...ALL_FEATURES];
  }

  resolveTier(_licenseKey: string, _plan: string): string {
    return 'business';
  }
}
