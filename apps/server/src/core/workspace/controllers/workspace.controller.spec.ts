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

  it('allows members to update AI settings when member AI settings are enabled', async () => {
    ability.cannot.mockReturnValue(true);

    await expect(
      controller.updateWorkspace(
        response(),
        dto({ aiSearch: true }),
        user(UserRole.MEMBER),
        workspace({ ai: { allowMemberSettings: true } }),
      ),
    ).resolves.toMatchObject({ id: 'workspace-id' });

    expect(workspaceService.update).toHaveBeenCalledWith('workspace-id', {
      aiSearch: true,
    });
  });

  it('blocks members from updating AI settings when member AI settings are disabled', async () => {
    ability.cannot.mockReturnValue(true);

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
});
