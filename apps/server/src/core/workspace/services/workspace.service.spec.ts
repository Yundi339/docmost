import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException } from '@nestjs/common';
import { KYSELY_MODULE_CONNECTION_TOKEN } from 'nestjs-kysely';
import { WorkspaceService } from './workspace.service';
import { SsoLoginCapabilityService } from '../../auth/services/sso-login-capability.service';

describe('WorkspaceService', () => {
  let service: WorkspaceService;
  let query: ReturnType<typeof fluentQuery>;
  let db: { selectFrom: jest.Mock };
  let ssoLoginCapability: { isLoginAvailable: jest.Mock };

  beforeEach(async () => {
    query = fluentQuery();
    db = { selectFrom: jest.fn().mockReturnValue(query) };
    ssoLoginCapability = { isLoginAvailable: jest.fn(() => false) };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        WorkspaceService,
        {
          provide: KYSELY_MODULE_CONNECTION_TOKEN(),
          useValue: db,
        },
        {
          provide: SsoLoginCapabilityService,
          useValue: ssoLoginCapability,
        },
      ],
    })
      .useMocker(() => ({}))
      .compile();

    service = module.get<WorkspaceService>(WorkspaceService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  it('does not expose enabled providers without a login handler', async () => {
    query.executeTakeFirst.mockResolvedValue({
      id: 'workspace-id',
      name: 'Workspace',
      logo: null,
      hostname: null,
      enforceSso: false,
      licenseKey: null,
      plan: null,
      authProviders: [{ id: 'provider-id', name: 'OIDC', type: 'oidc' }],
    });

    await expect(
      service.getWorkspacePublicData('workspace-id'),
    ).resolves.toMatchObject({ authProviders: [] });
  });

  it('rejects enforced SSO when enabled providers have no login handler', async () => {
    query.execute.mockResolvedValue([{ id: 'provider-id', type: 'oidc' }]);

    await expect(
      service.update('workspace-id', { enforceSso: true } as any),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});

function fluentQuery() {
  const query: Record<string, jest.Mock> = {};
  for (const method of ['select', 'where']) {
    query[method] = jest.fn().mockReturnValue(query);
  }
  query.execute = jest.fn().mockResolvedValue([]);
  query.executeTakeFirst = jest.fn().mockResolvedValue(undefined);
  return query;
}
