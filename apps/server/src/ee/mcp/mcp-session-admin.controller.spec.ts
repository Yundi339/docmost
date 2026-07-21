import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { GUARDS_METADATA } from '@nestjs/common/constants';
import { API_KEY_SCOPES_KEY } from '../../common/decorators/api-key-scope.decorator';
import { JwtAuthGuard } from '../../common/guards/jwt-auth.guard';
import { UserRole } from '../../common/helpers/types/permission';
import { ApiKeyScope } from '../../core/api-key/api-key-scopes';
import { McpSessionAdminController } from './mcp-session-admin.controller';

describe('McpSessionAdminController authorization', () => {
  const owner = {
    id: 'owner-id',
    role: UserRole.OWNER,
    workspaceId: 'workspace-id',
  } as any;
  const req = { ip: '203.0.113.10' } as any;

  it('requires JWT authentication and the expected REST scopes', () => {
    expect(
      Reflect.getMetadata(GUARDS_METADATA, McpSessionAdminController),
    ).toContain(JwtAuthGuard);
    expect(
      Reflect.getMetadata(
        API_KEY_SCOPES_KEY,
        McpSessionAdminController.prototype.getSessions,
      ),
    ).toEqual([ApiKeyScope.REST_READ]);
    expect(
      Reflect.getMetadata(
        API_KEY_SCOPES_KEY,
        McpSessionAdminController.prototype.releaseSessions,
      ),
    ).toEqual([ApiKeyScope.REST_WRITE]);
  });

  it('returns only the owner workspace sessions', async () => {
    const mcpService = {
      getSessionDiagnostics: jest.fn().mockResolvedValue({ sessions: [] }),
    };
    const controller = new McpSessionAdminController(mcpService as any);

    await expect(controller.getSessions(owner)).resolves.toEqual({
      sessions: [],
    });
    expect(mcpService.getSessionDiagnostics).toHaveBeenCalledWith(
      'workspace-id',
    );
  });

  it.each([UserRole.ADMIN, UserRole.MEMBER])(
    'rejects the %s role on the server',
    async (role) => {
      const mcpService = {
        getSessionDiagnostics: jest.fn(),
        releaseSessions: jest.fn(),
      };
      const controller = new McpSessionAdminController(mcpService as any);
      const user = { ...owner, role };

      await expect(controller.getSessions(user)).rejects.toBeInstanceOf(
        ForbiddenException,
      );
      await expect(
        controller.releaseSessions({ idleOnly: true }, user, req),
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(mcpService.getSessionDiagnostics).not.toHaveBeenCalled();
      expect(mcpService.releaseSessions).not.toHaveBeenCalled();
    },
  );

  it('releases a session in the owner workspace with actor context', async () => {
    const mcpService = {
      releaseSessions: jest.fn().mockResolvedValue({ releasedCount: 1 }),
    };
    const controller = new McpSessionAdminController(mcpService as any);

    await expect(
      controller.releaseSessions(
        { sessionId: 'ddba7b6a-8692-4dc4-9a5a-8fd983794690' },
        owner,
        req,
      ),
    ).resolves.toEqual({ releasedCount: 1 });
    expect(mcpService.releaseSessions).toHaveBeenCalledWith(
      'workspace-id',
      { sessionId: 'ddba7b6a-8692-4dc4-9a5a-8fd983794690' },
      { userId: 'owner-id', ipAddress: '203.0.113.10' },
    );
  });

  it('rejects ambiguous or empty release targets', async () => {
    const mcpService = { releaseSessions: jest.fn() };
    const controller = new McpSessionAdminController(mcpService as any);

    await expect(
      controller.releaseSessions({} as any, owner, req),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      controller.releaseSessions(
        {
          sessionId: 'ddba7b6a-8692-4dc4-9a5a-8fd983794690',
          idleOnly: true,
        },
        owner,
        req,
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
    expect(mcpService.releaseSessions).not.toHaveBeenCalled();
  });
});
