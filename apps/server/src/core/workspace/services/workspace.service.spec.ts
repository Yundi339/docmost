import { Test, TestingModule } from '@nestjs/testing';
import { WorkspaceService } from './workspace.service';

describe('WorkspaceService', () => {
  let service: WorkspaceService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [WorkspaceService],
    })
      .useMocker(() => ({}))
      .compile();

    service = module.get<WorkspaceService>(WorkspaceService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  it('does not publish enabled providers without a registered login handler', async () => {
    const query = fluentQuery();
    query.executeTakeFirst.mockResolvedValue({
      id: 'workspace-id',
      name: 'Workspace',
      logo: null,
      hostname: 'workspace',
      enforceSso: true,
      licenseKey: null,
      plan: null,
      authProviders: [{ id: 'provider-id', type: 'oidc', name: 'OIDC' }],
    });
    (service as any).db = { selectFrom: jest.fn().mockReturnValue(query) };
    (service as any).ssoEnforcement = {
      filterAvailableProviders: jest.fn().mockReturnValue([]),
    };

    await expect(
      service.getWorkspacePublicData('workspace-id'),
    ).resolves.toMatchObject({
      enforceSso: false,
      authProviders: [],
    });
  });
});

function fluentQuery() {
  const query: Record<string, jest.Mock> = {};
  for (const method of ['select', 'selectFrom', 'selectAll', 'where']) {
    query[method] = jest.fn().mockReturnValue(query);
  }
  query.executeTakeFirst = jest.fn();
  return query;
}
