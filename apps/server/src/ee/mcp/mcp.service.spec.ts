import { ForbiddenException } from '@nestjs/common';
import { McpService, McpRequestContext } from './mcp.service';
import { resolveMcpMode } from './mcp.controller';
import { ApiKeyScope } from '../../core/api-key/api-key-scopes';

jest.mock(
  'src/collaboration/collaboration.util',
  () => ({
    jsonToNode: jest.fn(),
  }),
  { virtual: true },
);

jest.mock('../../core/page/services/page.service', () => ({
  PageService: jest.fn(),
}));

jest.mock('../../core/space/services/space.service', () => ({
  SpaceService: jest.fn(),
}));

jest.mock('../../core/space/services/space-member.service', () => ({
  SpaceMemberService: jest.fn(),
}));

jest.mock('../../core/comment/comment.service', () => ({
  CommentService: jest.fn(),
}));

jest.mock('../../core/search/search.service', () => ({
  SearchService: jest.fn(),
}));

jest.mock('../../core/workspace/services/workspace.service', () => ({
  WorkspaceService: jest.fn(),
}));

describe('McpService access control', () => {
  let service: McpService;
  let auditService: { logWithContext: jest.Mock };

  beforeEach(() => {
    auditService = { logWithContext: jest.fn() };
    service = new McpService(
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      auditService as any,
    );
  });

  const context = (
    mode: McpRequestContext['mode'],
    scopes: string[],
  ): McpRequestContext => ({
    apiKeyId: 'api-key-id',
    mode,
    scopes,
  });

  it('resolves legacy and mode-based MCP settings', () => {
    expect(resolveMcpMode({ mcpMode: 'read-only', mcp: true })).toBe(
      'read-only',
    );
    expect(resolveMcpMode({ mcpMode: 'read-write' })).toBe('read-write');
    expect(resolveMcpMode({ mcpMode: 'off', mcp: true })).toBe('off');
    expect(resolveMcpMode({ mcp: true })).toBe('read-write');
    expect(resolveMcpMode({ mcp: false })).toBe('off');
  });

  it('requires an MCP scope for read tools', () => {
    expect(() =>
      (service as any).assertMcpToolAccess(
        context('read-write', [ApiKeyScope.REST_READ]),
        'read',
      ),
    ).toThrow(ForbiddenException);
  });

  it('allows mcp:read keys to call read tools', () => {
    expect(() =>
      (service as any).assertMcpToolAccess(
        context('read-only', [ApiKeyScope.MCP_READ]),
        'read',
      ),
    ).not.toThrow();
  });

  it('blocks write tools in workspace read-only mode', () => {
    expect(() =>
      (service as any).assertMcpToolAccess(
        context('read-only', [ApiKeyScope.MCP_WRITE]),
        'write',
      ),
    ).toThrow(ForbiddenException);
  });

  it('requires mcp:write for write tools', () => {
    expect(() =>
      (service as any).assertMcpToolAccess(
        context('read-write', [ApiKeyScope.MCP_READ]),
        'write',
      ),
    ).toThrow(ForbiddenException);
  });

  it('allows write tools when mode and scope permit it', () => {
    expect(() =>
      (service as any).assertMcpToolAccess(
        context('read-write', [ApiKeyScope.MCP_WRITE]),
        'write',
      ),
    ).not.toThrow();
  });

  it('audits MCP write tool calls without sensitive content', async () => {
    const result = await (service as any).runTool(
      context('read-write', [ApiKeyScope.MCP_WRITE]),
      { id: 'user-id' },
      { id: 'workspace-id' },
      'update_page',
      'write',
      {
        pageId: 'page-id',
        content: 'sensitive content',
        operation: 'replace',
      },
      async () => ({ ok: true }),
    );

    expect(result).toEqual({ ok: true });
    expect(auditService.logWithContext).toHaveBeenCalledWith(
      expect.objectContaining({
        resourceId: 'page-id',
        metadata: expect.objectContaining({
          toolName: 'update_page',
          apiKeyId: 'api-key-id',
          success: true,
          target: { pageId: 'page-id', operation: 'replace' },
        }),
      }),
      expect.objectContaining({
        workspaceId: 'workspace-id',
        actorId: 'user-id',
        actorType: 'api_key',
      }),
    );
    expect(
      JSON.stringify(auditService.logWithContext.mock.calls),
    ).not.toContain('sensitive content');
  });

  it('rejects session owner mismatch', async () => {
    const end = jest.fn();
    const res = {
      writeHead: jest.fn().mockReturnValue({ end }),
    };
    (service as any).sessions.set('session-id', {
      userId: 'user-id',
      workspaceId: 'workspace-id',
      apiKeyId: 'api-key-id',
      transport: { handleRequest: jest.fn() },
    });

    await service.handleRequest(
      { headers: { 'mcp-session-id': 'session-id' } } as any,
      res as any,
      {},
      { id: 'user-id' } as any,
      { id: 'workspace-id' } as any,
      {
        apiKeyId: 'other-api-key-id',
        mode: 'read-write',
        scopes: [ApiKeyScope.MCP_WRITE],
      },
    );

    expect(res.writeHead).toHaveBeenCalledWith(403, {
      'Content-Type': 'application/json',
    });
    expect(end).toHaveBeenCalledWith(
      JSON.stringify({ error: 'Session does not belong to this user' }),
    );
  });
});
