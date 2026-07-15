import { ForbiddenException } from '@nestjs/common';
import { GUARDS_METADATA } from '@nestjs/common/constants';
import { API_KEY_SCOPES_KEY } from '../../common/decorators/api-key-scope.decorator';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { UserRole } from '../../common/helpers/types/permission';
import { ApiKeyScope } from '../api-key/api-key-scopes';
import { SystemStatusController } from './system-status.controller';

describe('SystemStatusController authorization', () => {
  it('requires JWT authentication and REST read scope', () => {
    expect(
      Reflect.getMetadata(GUARDS_METADATA, SystemStatusController),
    ).toContain(JwtAuthGuard);
    expect(
      Reflect.getMetadata(
        API_KEY_SCOPES_KEY,
        SystemStatusController.prototype.getStatus,
      ),
    ).toEqual([ApiKeyScope.REST_READ]);
    expect(
      Reflect.getMetadata(
        API_KEY_SCOPES_KEY,
        SystemStatusController.prototype.listDiagnosticDataSources,
      ),
    ).toEqual([ApiKeyScope.REST_READ]);
  });

  it('lists diagnostic data sources only within the owner workspace', async () => {
    const systemStatusService = {
      listDiagnosticDataSources: jest.fn().mockResolvedValue({ items: [] }),
    };
    const controller = new SystemStatusController(systemStatusService as any);
    const dto = { filter: 'issues', limit: 50 } as any;
    const user = {
      role: UserRole.OWNER,
      workspaceId: 'workspace-1',
    } as any;

    await expect(
      controller.listDiagnosticDataSources(dto, user),
    ).resolves.toEqual({ items: [] });
    expect(systemStatusService.listDiagnosticDataSources).toHaveBeenCalledWith(
      user,
      dto,
    );
  });

  it('passes the owner workspace to the status service', async () => {
    const systemStatusService = {
      getStatus: jest.fn().mockResolvedValue({ status: 'ok' }),
    };
    const controller = new SystemStatusController(systemStatusService as any);

    await expect(
      controller.getStatus({
        role: UserRole.OWNER,
        workspaceId: 'workspace-1',
      } as any),
    ).resolves.toEqual({ status: 'ok' });
    expect(systemStatusService.getStatus).toHaveBeenCalledWith('workspace-1');
  });

  it.each([UserRole.ADMIN, UserRole.MEMBER])(
    'rejects the %s role on the server',
    async (role) => {
      const systemStatusService = { getStatus: jest.fn() };
      const controller = new SystemStatusController(systemStatusService as any);

      await expect(
        controller.getStatus({ role, workspaceId: 'workspace-1' } as any),
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(systemStatusService.getStatus).not.toHaveBeenCalled();
    },
  );

  it.each([UserRole.ADMIN, UserRole.MEMBER])(
    'rejects the %s role from diagnostic data sources',
    async (role) => {
      const systemStatusService = {
        listDiagnosticDataSources: jest.fn(),
      };
      const controller = new SystemStatusController(systemStatusService as any);

      await expect(
        controller.listDiagnosticDataSources(
          {} as any,
          {
            role,
            workspaceId: 'workspace-1',
          } as any,
        ),
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(
        systemStatusService.listDiagnosticDataSources,
      ).not.toHaveBeenCalled();
    },
  );
});
