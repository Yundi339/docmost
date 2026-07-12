import { ForbiddenException } from '@nestjs/common';
import { WorkspaceController } from './workspace.controller';
import { UserRole } from '../../../common/helpers/types/permission';

jest.mock('../services/workspace.service', () => ({
  WorkspaceService: jest.fn(),
}));

jest.mock('../services/workspace-invitation.service', () => ({
  WorkspaceInvitationService: jest.fn(),
}));

describe('WorkspaceController', () => {
  let controller: WorkspaceController;
  let workspaceService: { update: jest.Mock };
  let ability: { cannot: jest.Mock };

  const user = (role: UserRole) =>
    ({
      id: `${role}-id`,
      role,
    }) as any;

  const workspace = (settings: Record<string, any> = {}) =>
    ({
      id: 'workspace-id',
      hostname: null,
      settings,
    }) as any;

  const response = () =>
    ({
      clearCookie: jest.fn(),
    }) as any;

  const dto = (value: Record<string, any>) => value as any;

  beforeEach(() => {
    workspaceService = {
      update: jest.fn().mockResolvedValue({
        id: 'workspace-id',
        hostname: null,
      }),
    };
    ability = {
      cannot: jest.fn().mockReturnValue(false),
    };

    controller = new WorkspaceController(
      workspaceService as any,
      {} as any,
      { createForUser: jest.fn().mockReturnValue(ability) } as any,
      {} as any,
      {} as any,
      {} as any,
    );
  });

  it('blocks admins from changing owner-only member management settings', async () => {
    await expect(
      controller.updateWorkspace(
        response(),
        dto({ allowMemberApiManagement: false }),
        user(UserRole.ADMIN),
        workspace(),
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);

    expect(workspaceService.update).not.toHaveBeenCalled();
  });

  it('blocks admins from changing API management settings', async () => {
    await expect(
      controller.updateWorkspace(
        response(),
        dto({ restrictApiToAdmins: true }),
        user(UserRole.ADMIN),
        workspace(),
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);

    expect(workspaceService.update).not.toHaveBeenCalled();
  });

  it.each([{ enforceSso: true }, { emailDomains: ['example.com'] }])(
    'blocks admins from changing SSO settings: %j',
    async (settings) => {
      await expect(
        controller.updateWorkspace(
          response(),
          dto(settings),
          user(UserRole.ADMIN),
          workspace(),
        ),
      ).rejects.toBeInstanceOf(ForbiddenException);

      expect(workspaceService.update).not.toHaveBeenCalled();
    },
  );

  it('allows owners to change member management settings', async () => {
    await expect(
      controller.updateWorkspace(
        response(),
        dto({ allowMemberAiSettings: false }),
        user(UserRole.OWNER),
        workspace(),
      ),
    ).resolves.toMatchObject({ id: 'workspace-id' });

    expect(workspaceService.update).toHaveBeenCalledWith('workspace-id', {
      allowMemberAiSettings: false,
    });
  });

  it('blocks admins from updating AI settings', async () => {
    await expect(
      controller.updateWorkspace(
        response(),
        dto({ aiSearch: true }),
        user(UserRole.ADMIN),
        workspace({ ai: { allowMemberSettings: true } }),
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);

    expect(workspaceService.update).not.toHaveBeenCalled();
  });

  it('blocks members from updating AI settings when member AI settings are enabled', async () => {
    ability.cannot.mockReturnValue(true);

    await expect(
      controller.updateWorkspace(
        response(),
        dto({ aiSearch: true }),
        user(UserRole.MEMBER),
        workspace({ ai: { allowMemberSettings: true } }),
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);

    expect(workspaceService.update).not.toHaveBeenCalled();
  });

  it('allows owners to update AI settings', async () => {
    await expect(
      controller.updateWorkspace(
        response(),
        dto({ aiSearch: true }),
        user(UserRole.OWNER),
        workspace({ ai: { allowMemberSettings: false } }),
      ),
    ).resolves.toMatchObject({ id: 'workspace-id' });

    expect(workspaceService.update).toHaveBeenCalledWith('workspace-id', {
      aiSearch: true,
    });
  });

  it('blocks members from updating AI settings when member AI settings are disabled', async () => {
    await expect(
      controller.updateWorkspace(
        response(),
        dto({ aiSearch: true }),
        user(UserRole.MEMBER),
        workspace({ ai: { allowMemberSettings: false } }),
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);

    expect(workspaceService.update).not.toHaveBeenCalled();
  });

  it('blocks members from updating MCP mode even when member AI settings are enabled', async () => {
    await expect(
      controller.updateWorkspace(
        response(),
        dto({ mcpMode: 'read-write' }),
        user(UserRole.MEMBER),
        workspace({ ai: { allowMemberSettings: true } }),
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);

    expect(workspaceService.update).not.toHaveBeenCalled();
  });
});
