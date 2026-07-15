import { AuditEvent } from '../../common/events/audit-events';
import { SystemDiagnosticsService } from './system-diagnostics.service';
import { SystemDiagnosticCode } from './system-diagnostics.types';

describe('SystemDiagnosticsService', () => {
  const defaultSignals = {
    externalDataSourceCount: 0,
    largeBoardCount: 0,
    maxRecordCount: 12,
    orphanDataSourceCount: 0,
    invalidRelationCount: 0,
    realtimeFailureCount: 0,
  };

  let diagnosticsRepo: {
    getSignals: jest.Mock;
    findLatestTransition: jest.Mock;
    listHistory: jest.Mock;
    listWorkspaceIds: jest.Mock;
    listDataSources: jest.Mock;
  };
  let auditRepo: { insertAudit: jest.Mock };
  let pageRepo: { findByIds: jest.Mock };
  let pageAccessService: { filterViewablePagesWithPermissions: jest.Mock };
  let service: SystemDiagnosticsService;

  beforeEach(() => {
    diagnosticsRepo = {
      getSignals: jest.fn().mockResolvedValue(defaultSignals),
      findLatestTransition: jest.fn().mockResolvedValue(undefined),
      listHistory: jest.fn().mockResolvedValue([]),
      listWorkspaceIds: jest.fn().mockResolvedValue([]),
      listDataSources: jest.fn().mockResolvedValue({
        items: [],
        nextCursor: null,
      }),
    };
    auditRepo = { insertAudit: jest.fn().mockResolvedValue(undefined) };
    pageRepo = { findByIds: jest.fn().mockResolvedValue([]) };
    pageAccessService = {
      filterViewablePagesWithPermissions: jest.fn().mockResolvedValue([]),
    };
    service = new SystemDiagnosticsService(
      diagnosticsRepo as any,
      auditRepo as any,
      pageRepo as any,
      pageAccessService as any,
    );
  });

  it('delegates owner data-source inspection with workspace scope', async () => {
    const options = { filter: 'issues', limit: 50 } as any;
    const user = { workspaceId: 'workspace-1', id: 'user-1' } as any;

    await expect(service.listDataSources(user, options)).resolves.toEqual({
      items: [],
      nextCursor: null,
    });
    expect(diagnosticsRepo.listDataSources).toHaveBeenCalledWith(
      'workspace-1',
      options,
    );
  });

  it('hides host page metadata when the owner cannot view the page', async () => {
    diagnosticsRepo.listDataSources.mockResolvedValue({
      items: [
        {
          id: 'database-1',
          hostPage: { id: 'page-1', title: 'Private page' },
          space: { id: 'space-1', name: 'Private', slug: 'private' },
        },
      ],
      nextCursor: null,
    });
    pageRepo.findByIds.mockResolvedValue([
      { id: 'page-1', workspaceId: 'workspace-1', spaceId: 'space-1' },
    ]);
    const user = { workspaceId: 'workspace-1', id: 'user-1' } as any;

    const result = await service.listDataSources(user, {
      filter: 'issues',
      limit: 50,
    } as any);

    expect(result.items[0]).toEqual(
      expect.objectContaining({
        title: null,
        recordCount: null,
        hostPage: null,
        space: null,
      }),
    );
    expect(
      pageAccessService.filterViewablePagesWithPermissions,
    ).toHaveBeenCalledWith([expect.objectContaining({ id: 'page-1' })], user);
  });

  it('maps signals and only audits newly detected transition checks', async () => {
    diagnosticsRepo.getSignals.mockResolvedValue({
      ...defaultSignals,
      externalDataSourceCount: 1,
      largeBoardCount: 2,
      maxRecordCount: 740,
      invalidRelationCount: 3,
      realtimeFailureCount: 4,
    });

    const result = await service.getDiagnostics('workspace-1');

    expect(result.status).toBe('up');
    expect(result.checks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: SystemDiagnosticCode.LARGE_BOARD,
          status: 'attention',
          count: 2,
          value: 740,
          threshold: 500,
        }),
        expect.objectContaining({
          code: SystemDiagnosticCode.REALTIME_INVALIDATION_FAILURE,
          count: 4,
          windowHours: 24,
        }),
      ]),
    );
    expect(auditRepo.insertAudit).toHaveBeenCalledTimes(3);
    expect(auditRepo.insertAudit).not.toHaveBeenCalledWith(
      expect.objectContaining({
        metadata: expect.objectContaining({
          diagnosticCode: SystemDiagnosticCode.REALTIME_INVALIDATION_FAILURE,
        }),
      }),
    );
  });

  it('writes a resolved transition when a previously active check is clear', async () => {
    diagnosticsRepo.findLatestTransition.mockImplementation(
      async (_workspaceId: string, code: string) =>
        code === SystemDiagnosticCode.ORPHAN_DATABASE_SOURCE
          ? {
              id: 'audit-1',
              event: AuditEvent.SYSTEM_DIAGNOSTIC_DETECTED,
              metadata: {},
              createdAt: new Date(),
            }
          : undefined,
    );

    await service.getDiagnostics('workspace-1');

    expect(auditRepo.insertAudit).toHaveBeenCalledTimes(1);
    expect(auditRepo.insertAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        event: AuditEvent.SYSTEM_DIAGNOSTIC_RESOLVED,
        metadata: expect.objectContaining({
          diagnosticCode: SystemDiagnosticCode.ORPHAN_DATABASE_SOURCE,
          count: 0,
        }),
      }),
    );
  });

  it('samples repeated realtime incidents and invalidates the cache', async () => {
    await service.getDiagnostics('workspace-1');
    await service.recordIncident(
      'workspace-1',
      SystemDiagnosticCode.REALTIME_INVALIDATION_FAILURE,
      { source: 'database_invalidation' },
    );
    await service.recordIncident(
      'workspace-1',
      SystemDiagnosticCode.REALTIME_INVALIDATION_FAILURE,
      { source: 'database_invalidation' },
    );
    await service.getDiagnostics('workspace-1');

    expect(auditRepo.insertAudit).toHaveBeenCalledTimes(1);
    expect(auditRepo.insertAudit).toHaveBeenCalledWith(
      expect.objectContaining({
        event: AuditEvent.SYSTEM_DIAGNOSTIC_OCCURRED,
        metadata: expect.objectContaining({ sampled: true }),
      }),
    );
    expect(diagnosticsRepo.getSignals).toHaveBeenCalledTimes(2);
  });

  it('returns an unavailable section without failing system status', async () => {
    diagnosticsRepo.getSignals.mockRejectedValue(new Error('database down'));

    await expect(service.getDiagnostics('workspace-1')).resolves.toEqual(
      expect.objectContaining({
        status: 'down',
        checks: [],
        history: [],
      }),
    );
  });
});
