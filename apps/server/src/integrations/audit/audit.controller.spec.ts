import { ForbiddenException } from '@nestjs/common';
import { AuditController } from './audit.controller';
import { UserRole } from '../../common/helpers/types/permission';
import { AuditEvent, AuditResource } from '../../common/events/audit-events';

describe('AuditController', () => {
  let controller: AuditController;
  let auditRepo: { findAuditLogs: jest.Mock };
  let auditService: { updateRetention: jest.Mock };

  const user = (role: UserRole) =>
    ({
      id: `${role}-id`,
      role,
    }) as any;

  const workspace = () =>
    ({
      id: 'workspace-id',
      trashRetentionDays: 90,
    }) as any;
  const params = () =>
    ({
      limit: 20,
      query: undefined,
      adminView: false,
    }) as any;

  beforeEach(() => {
    auditRepo = {
      findAuditLogs: jest.fn().mockResolvedValue({ items: [], meta: {} }),
    };
    auditService = {
      updateRetention: jest.fn().mockResolvedValue(undefined),
    };

    controller = new AuditController(auditRepo as any, auditService as any);
  });

  it('blocks admins from reading audit logs', async () => {
    await expect(
      controller.findAuditLogs(params(), user(UserRole.ADMIN), workspace()),
    ).rejects.toBeInstanceOf(ForbiddenException);

    expect(auditRepo.findAuditLogs).not.toHaveBeenCalled();
  });

  it('allows owners to read audit logs', async () => {
    await expect(
      controller.findAuditLogs(params(), user(UserRole.OWNER), workspace()),
    ).resolves.toMatchObject({ items: [] });

    expect(auditRepo.findAuditLogs).toHaveBeenCalledWith(
      'workspace-id',
      params(),
    );
  });

  it('allows users to read only their own MCP audit logs', async () => {
    await controller.findMyMcpAuditLogs(
      { ...params(), actorId: 'other-user-id', event: 'user.login' } as any,
      user(UserRole.MEMBER),
      workspace(),
    );

    expect(auditRepo.findAuditLogs).toHaveBeenCalledWith(
      'workspace-id',
      expect.objectContaining({
        actorId: 'member-id',
        event: AuditEvent.MCP_TOOL_CALLED,
        resourceType: AuditResource.MCP_TOOL,
      }),
    );
  });

  it('blocks admins from updating audit retention', async () => {
    await expect(
      controller.updateRetention(30, user(UserRole.ADMIN), workspace()),
    ).rejects.toBeInstanceOf(ForbiddenException);

    expect(auditService.updateRetention).not.toHaveBeenCalled();
  });
});
