import { ForbiddenException } from '@nestjs/common';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { McpService, McpRequestContext } from './mcp.service';
import { resolveMcpMode } from './mcp.controller';
import { ApiKeyScope } from '../../core/api-key/api-key-scopes';
import { PageInfoDto } from '../../core/page/dto/page.dto';

jest.mock('@modelcontextprotocol/sdk/server/streamableHttp.js', () => ({
  StreamableHTTPServerTransport: jest.fn().mockImplementation((options) => ({
    close: jest.fn().mockResolvedValue(undefined),
    handleRequest: jest.fn(async () => {
      await options?.onsessioninitialized?.('generated-session-id');
    }),
  })),
}));

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
    jest.clearAllMocks();
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
    authType: 'api_key',
    credentialId: 'api-key-id',
    apiKeyId: 'api-key-id',
    mode,
    scopes,
    ipAddress: '203.0.113.10',
    userAgent: 'test-agent',
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

  it('audits MCP tool calls without sensitive content', async () => {
    const pageId = '018f3f73-2f69-7c8d-9d79-8f3f4d7d9711';
    const result = await (service as any).runTool(
      context('read-write', [ApiKeyScope.MCP_WRITE]),
      { id: 'user-id' },
      { id: 'workspace-id' },
      'update_page',
      'write',
      {
        pageId,
        content: 'sensitive content',
        operation: 'replace',
      },
      async () => ({ ok: true }),
    );

    expect(result).toEqual({ ok: true });
    expect(auditService.logWithContext).toHaveBeenCalledWith(
      expect.objectContaining({
        resourceId: pageId,
        metadata: expect.objectContaining({
          toolName: 'update_page',
          access: 'write',
          apiKeyId: 'api-key-id',
          success: true,
          target: { pageId, operation: 'replace' },
          userAgent: 'test-agent',
        }),
      }),
      expect.objectContaining({
        workspaceId: 'workspace-id',
        actorId: 'user-id',
        actorType: 'api_key',
        ipAddress: '203.0.113.10',
      }),
    );
    expect(
      JSON.stringify(auditService.logWithContext.mock.calls),
    ).not.toContain('sensitive content');
  });

  it('audits MCP read tool calls', async () => {
    await (service as any).runTool(
      context('read-only', [ApiKeyScope.MCP_READ]),
      { id: 'user-id' },
      { id: 'workspace-id' },
      'search_pages',
      'read',
      {
        query: 'sensitive search',
        limit: 10,
      },
      async () => ({ ok: true }),
    );

    expect(auditService.logWithContext).toHaveBeenCalledWith(
      expect.objectContaining({
        resourceId: undefined,
        metadata: expect.objectContaining({
          toolName: 'search_pages',
          access: 'read',
          success: true,
          target: {},
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
    ).not.toContain('sensitive search');
  });

  it('requires MCP tool registrations to declare DTO handling', async () => {
    await expect(
      (service as any).prepareMcpToolInput('unsafe_tool', {}, undefined),
    ).rejects.toThrow('MCP tool unsafe_tool must declare a DTO or noDto');
  });

  it('validates MCP tool input through the registration template', async () => {
    await expect(
      (service as any).prepareMcpToolInput(
        'get_page',
        { format: 'xml' },
        { dto: PageInfoDto },
      ),
    ).rejects.toThrow('format must be one of the following values');

    await expect(
      (service as any).prepareMcpToolInput(
        'current_user',
        { ignored: true },
        { noDto: true },
      ),
    ).resolves.toEqual({ ignored: true });
  });

  it('treats deleted pages as missing for MCP page tools', async () => {
    const pageRepo = {
      findById: jest.fn().mockResolvedValue({
        id: 'page-id',
        workspaceId: 'workspace-id',
        deletedAt: new Date(),
      }),
    };
    const mcp = new McpService(
      {} as any,
      pageRepo as any,
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

    await expect(
      (mcp as any).findActiveWorkspacePage('page-id', 'workspace-id'),
    ).resolves.toBeNull();
  });

  it('rejects session owner mismatch', async () => {
    const end = jest.fn();
    const res = {
      writeHead: jest.fn().mockReturnValue({ end }),
    };
    (service as any).sessions.set('session-id', {
      userId: 'user-id',
      workspaceId: 'workspace-id',
      authType: 'api_key',
      credentialId: 'api-key-id',
      transport: { handleRequest: jest.fn() },
    });

    await service.handleRequest(
      { headers: { 'mcp-session-id': 'session-id' } } as any,
      res as any,
      {},
      { id: 'user-id' } as any,
      { id: 'workspace-id' } as any,
      {
        authType: 'api_key',
        credentialId: 'other-api-key-id',
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

  it('closes existing sessions when MCP permissions change', async () => {
    const end = jest.fn();
    const close = jest.fn().mockResolvedValue(undefined);
    const handleRequest = jest.fn();
    const res = {
      writeHead: jest.fn().mockReturnValue({ end }),
    };
    (service as any).sessions.set('session-id', {
      userId: 'user-id',
      workspaceId: 'workspace-id',
      authType: 'api_key',
      credentialId: 'api-key-id',
      mode: 'read-write',
      scopes: [ApiKeyScope.MCP_WRITE],
      transport: { close, handleRequest },
    });

    await service.handleRequest(
      { headers: { 'mcp-session-id': 'session-id' } } as any,
      res as any,
      {},
      { id: 'user-id' } as any,
      { id: 'workspace-id' } as any,
      context('read-only', [ApiKeyScope.MCP_READ]),
    );

    expect(close).toHaveBeenCalled();
    expect(handleRequest).not.toHaveBeenCalled();
    expect((service as any).sessions.has('session-id')).toBe(false);
    expect(res.writeHead).toHaveBeenCalledWith(403, {
      'Content-Type': 'application/json',
    });
    expect(end).toHaveBeenCalledWith(
      JSON.stringify({
        error: 'MCP session permissions changed. Reconnect required.',
      }),
    );
  });

  it('stores new sessions when the streamable HTTP transport initializes them', async () => {
    const body = { jsonrpc: '2.0', id: 1, method: 'initialize' };
    const req = { headers: {} };
    const res = {};
    const server = { connect: jest.fn().mockResolvedValue(undefined) };
    jest.spyOn(service as any, 'createMcpServer').mockReturnValue(server);

    await service.handleRequest(
      req as any,
      res as any,
      body,
      { id: 'user-id' } as any,
      { id: 'workspace-id' } as any,
      context('read-write', [ApiKeyScope.MCP_WRITE]),
    );

    const sessions = (service as any).sessions as Map<string, any>;
    const session = sessions.get('generated-session-id');
    const transport = (
      StreamableHTTPServerTransport as jest.MockedClass<
        typeof StreamableHTTPServerTransport
      >
    ).mock.results[0].value;

    expect(session).toMatchObject({
      userId: 'user-id',
      workspaceId: 'workspace-id',
      authType: 'api_key',
      credentialId: 'api-key-id',
      scopes: [ApiKeyScope.MCP_WRITE],
      mode: 'read-write',
      server,
      transport,
    });
    expect(server.connect).toHaveBeenCalledWith(transport);
    expect(transport.handleRequest).toHaveBeenCalledWith(req, res, body);

    transport.onclose();
    expect(sessions.has('generated-session-id')).toBe(false);
  });
});
