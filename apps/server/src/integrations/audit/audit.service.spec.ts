import { RealAuditService } from './audit.service';

describe('RealAuditService retention', () => {
  function createService() {
    const auditRepo = {
      deleteOldAuditLogs: jest.fn().mockResolvedValue(undefined),
      deleteExpiredAuditLogs: jest.fn().mockResolvedValue(undefined),
    };
    const workspaceRepo = {
      updateWorkspace: jest.fn().mockResolvedValue(undefined),
    };
    const service = new RealAuditService(
      { get: jest.fn(), set: jest.fn() } as any,
      auditRepo as any,
      workspaceRepo as any,
    );

    return { service, auditRepo, workspaceRepo };
  }

  it('persists a workspace retention policy before pruning existing logs', async () => {
    const { service, auditRepo, workspaceRepo } = createService();

    await service.updateRetention('workspace-id', 30);

    expect(workspaceRepo.updateWorkspace).toHaveBeenCalledWith(
      { auditRetentionDays: 30 },
      'workspace-id',
    );
    expect(auditRepo.deleteOldAuditLogs).toHaveBeenCalledWith(
      'workspace-id',
      30,
    );
  });

  it('prunes all workspaces according to their saved policies', async () => {
    const { service, auditRepo } = createService();

    await service.pruneExpiredAuditLogs();

    expect(auditRepo.deleteExpiredAuditLogs).toHaveBeenCalledTimes(1);
  });
});
