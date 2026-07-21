import { ForbiddenException } from '@nestjs/common';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { McpService, McpRequestContext } from './mcp.service';
import { resolveMcpMode } from './mcp.controller';
import { ApiKeyScope } from '../../core/api-key/api-key-scopes';
import { PageInfoDto } from '../../core/page/dto/page.dto';
import { McpToolExecutorService } from './mcp-tool-executor.service';
import { McpToolAccessService } from './mcp-tool-access.service';
import {
  MCP_LEGACY_TOOL_ORDER,
  MCP_TOOL_ORDER,
  McpToolRegistryService,
} from './mcp-tool-registry.service';
import { McpPageToolProvider } from './tools/page.tools';
import { McpCommentToolProvider } from './tools/comment.tools';
import { McpSpaceToolProvider } from './tools/space.tools';
import { McpSearchToolProvider } from './tools/search.tools';
import { McpMemberToolProvider } from './tools/member.tools';
import {
  SpaceCaslAction,
  SpaceCaslSubject,
} from '../../core/casl/interfaces/space-ability.type';

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
  const pageId = '018f3f73-2f69-7c8d-9d79-8f3f4d7d9711';
  const spaceId = '018f3f73-2f69-7c8d-9d79-8f3f4d7d9712';
  const targetSpaceId = '018f3f73-2f69-7c8d-9d79-8f3f4d7d9713';
  let service: McpService;
  let executor: McpToolExecutorService;
  let auditService: { logWithContext: jest.Mock };

  beforeEach(() => {
    jest.clearAllMocks();
    auditService = { logWithContext: jest.fn() };
    executor = new McpToolExecutorService(
      auditService as any,
      {
        assertCredentialResourceAccess: jest.fn(),
      } as any,
    );
    service = new McpService(
      { registerTools: jest.fn() } as any,
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
    spaceAccess: {
      mode: 'all',
      selectedSpaceIds: [],
      effectiveSpaceIds: [spaceId, targetSpaceId],
      revision: 'space-revision-1',
    },
    principalRevision: 'principal-revision-1',
    ipAddress: '203.0.113.10',
    userAgent: 'test-agent',
  });

  function registerMcpTools(overrides: Record<string, any> = {}) {
    const handlers: Record<string, (args: any) => Promise<any>> = {};
    const registrations: Record<string, any> = {};
    const server = {
      registerTool: jest.fn((name: string, options: any, handler: any) => {
        handlers[name] = handler;
        registrations[name] = options;
      }),
    };
    const pageService = overrides.pageService ?? {
      duplicatePage: jest.fn().mockResolvedValue({ id: pageId, title: 'Copy' }),
    };
    const pageRepo = overrides.pageRepo ?? {
      findById: jest.fn().mockResolvedValue({
        id: pageId,
        workspaceId: 'workspace-id',
        spaceId,
        deletedAt: null,
      }),
    };
    const pageAccessService = overrides.pageAccessService ?? {
      validateCanEdit: jest.fn().mockResolvedValue({ hasRestriction: false }),
      validateCanView: jest.fn().mockResolvedValue(undefined),
      validateCanComment: jest.fn().mockResolvedValue(undefined),
    };
    const spaceMemberService = overrides.spaceMemberService ?? {
      getUserSpaces: jest.fn().mockResolvedValue({ items: [] }),
    };
    const spaceAbility = overrides.spaceAbility ?? {
      createForUser: jest.fn(async () => ({
        can: jest.fn().mockReturnValue(true),
        cannot: jest.fn().mockReturnValue(false),
      })),
    };
    const workspaceAbility = overrides.workspaceAbility ?? {
      createForUser: jest.fn(() => ({
        cannot: jest.fn().mockReturnValue(false),
      })),
    };
    const access = new McpToolAccessService(
      pageRepo as any,
      spaceAbility as any,
      pageAccessService as any,
      {} as any,
    );
    const registry = new McpToolRegistryService(
      new McpToolExecutorService(overrides.auditService ?? auditService, {
        assertCredentialResourceAccess: jest.fn(),
      } as any),
      new McpPageToolProvider(
        pageService as any,
        overrides.pageLifecycleService ?? ({} as any),
        access,
      ),
      new McpCommentToolProvider(
        overrides.commentService ?? ({} as any),
        access,
      ),
      new McpSpaceToolProvider(
        overrides.spaceService ?? ({} as any),
        spaceMemberService as any,
        workspaceAbility as any,
        access,
      ),
      new McpSearchToolProvider(
        overrides.searchService ?? ({} as any),
        overrides.searchAttachmentsService ?? ({} as any),
        access,
      ),
      new McpMemberToolProvider(
        overrides.workspaceService ?? ({} as any),
        overrides.userRepo ?? ({} as any),
        workspaceAbility as any,
        access,
      ),
    );
    registry.registerTools(
      server as any,
      { id: 'user-id' } as any,
      { id: 'workspace-id' } as any,
      overrides.context ?? context('read-write', [ApiKeyScope.MCP_WRITE]),
    );

    return {
      handlers,
      registrations,
      registry,
      access,
      pageAccessService,
      pageService,
      pageRepo,
      spaceAbility,
      spaceMemberService,
    };
  }

  function runTool(
    requestContext: McpRequestContext,
    user: any,
    workspace: any,
    name: string,
    access: 'read' | 'write',
    args: Record<string, any>,
    handler: () => Promise<any>,
  ) {
    return executor.execute(
      { context: requestContext, user, workspace },
      {
        name,
        description: name,
        inputSchema: {},
        access,
        resource: { kind: 'identity' },
        input: { noDto: true },
        handler,
      },
      args,
    );
  }

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
      executor.assertToolAccess(
        context('read-write', [ApiKeyScope.REST_READ]),
        'read',
      ),
    ).toThrow(ForbiddenException);
  });

  it('allows mcp:read keys to call read tools', () => {
    expect(() =>
      executor.assertToolAccess(
        context('read-only', [ApiKeyScope.MCP_READ]),
        'read',
      ),
    ).not.toThrow();
  });

  it('blocks write tools in workspace read-only mode', () => {
    expect(() =>
      executor.assertToolAccess(
        context('read-only', [ApiKeyScope.MCP_WRITE]),
        'write',
      ),
    ).toThrow(ForbiddenException);
  });

  it('requires mcp:write for write tools', () => {
    expect(() =>
      executor.assertToolAccess(
        context('read-write', [ApiKeyScope.MCP_READ]),
        'write',
      ),
    ).toThrow(ForbiddenException);
  });

  it('allows write tools when mode and scope permit it', () => {
    expect(() =>
      executor.assertToolAccess(
        context('read-write', [ApiKeyScope.MCP_WRITE]),
        'write',
      ),
    ).not.toThrow();
  });

  it('requires the independent destructive scope for destructive tools', () => {
    expect(() =>
      executor.assertToolAccess(
        context('read-write', [ApiKeyScope.MCP_WRITE]),
        'destructive',
      ),
    ).toThrow('Missing API key scope: mcp:destructive');

    expect(() =>
      executor.assertToolAccess(
        context('read-write', [ApiKeyScope.MCP_DESTRUCTIVE]),
        'destructive',
      ),
    ).not.toThrow();
  });

  it('audits MCP tool calls without sensitive content', async () => {
    const result = await runTool(
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
    await runTool(
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

  it('audits created resources without storing page content', async () => {
    await runTool(
      context('read-write', [ApiKeyScope.MCP_WRITE]),
      { id: 'user-id' },
      { id: 'workspace-id' },
      'create_page',
      'write',
      {
        spaceId,
        title: 'MCP audit page',
        content: 'sensitive page content',
      },
      async () => ({
        content: [
          {
            type: 'text',
            text: JSON.stringify({ id: pageId, title: 'MCP audit page' }),
          },
        ],
      }),
    );

    expect(auditService.logWithContext).toHaveBeenCalledWith(
      expect.objectContaining({
        resourceId: pageId,
        metadata: expect.objectContaining({
          target: { spaceId, title: 'MCP audit page' },
          result: { id: pageId, title: 'MCP audit page' },
        }),
      }),
      expect.anything(),
    );
    expect(
      JSON.stringify(auditService.logWithContext.mock.calls),
    ).not.toContain('sensitive page content');
  });

  it('limits list_spaces to the authenticated workspace', async () => {
    const { handlers, spaceMemberService } = registerMcpTools();

    await handlers.list_spaces({});

    expect(spaceMemberService.getUserSpaces).toHaveBeenCalledWith(
      'user-id',
      expect.objectContaining({ limit: 100 }),
      'workspace-id',
      [spaceId, targetSpaceId],
    );
  });

  it('preserves the existing 20-tool registration contract and order', () => {
    const { registrations } = registerMcpTools();
    const legacyRegistrations = Object.fromEntries(
      Object.entries(registrations).filter(([name]) =>
        MCP_LEGACY_TOOL_ORDER.includes(name as any),
      ),
    );

    expect(Object.keys(registrations)).toEqual(MCP_TOOL_ORDER);
    expect(Object.keys(legacyRegistrations)).toEqual(MCP_LEGACY_TOOL_ORDER);
    expect(
      Object.fromEntries(
        Object.entries(legacyRegistrations).map(
          ([name, options]: [string, any]) => [
            name,
            {
              description: options.description,
              readOnlyHint: options.annotations.readOnlyHint,
              destructiveHint: options.annotations.destructiveHint,
              scopes: options.securitySchemes[0].scopes,
              schema: Object.fromEntries(
                Object.entries(options.inputSchema).map(([key, schema]) => [
                  key,
                  getSchemaContract(schema),
                ]),
              ),
            },
          ],
        ),
      ),
    ).toMatchSnapshot();
  });

  it('registers reversible page maintenance with explicit destructive metadata', () => {
    const { registrations } = registerMcpTools();

    expect(registrations.trash_page).toMatchObject({
      annotations: { readOnlyHint: false, destructiveHint: true },
      securitySchemes: [{ type: 'oauth2', scopes: ['mcp:destructive'] }],
    });
    expect(registrations.restore_page).toMatchObject({
      annotations: { readOnlyHint: false, destructiveHint: false },
      securitySchemes: [{ type: 'oauth2', scopes: ['mcp:write'] }],
    });
  });

  it('requires confirmation and delegates trash and restore to page lifecycle', async () => {
    const pageLifecycleService = {
      trashPage: jest.fn().mockResolvedValue({
        id: pageId,
        title: 'Page',
        spaceId,
      }),
      restorePage: jest.fn().mockResolvedValue({
        id: pageId,
        title: 'Page',
        spaceId,
      }),
    };
    const { handlers } = registerMcpTools({
      pageLifecycleService,
      context: context('read-write', [ApiKeyScope.MCP_DESTRUCTIVE]),
    });

    await expect(
      handlers.trash_page({ pageId, confirm: false }),
    ).rejects.toThrow('confirm must be true');
    expect(pageLifecycleService.trashPage).not.toHaveBeenCalled();

    await handlers.trash_page({ pageId, confirm: true });
    await handlers.restore_page({ pageId });

    expect(pageLifecycleService.trashPage).toHaveBeenCalledWith(
      pageId,
      expect.objectContaining({ id: 'user-id' }),
      expect.objectContaining({ id: 'workspace-id' }),
      [spaceId, targetSpaceId],
    );
    expect(pageLifecycleService.restorePage).toHaveBeenCalledWith(
      pageId,
      expect.objectContaining({ id: 'user-id' }),
      expect.objectContaining({ id: 'workspace-id' }),
      [spaceId, targetSpaceId],
    );
  });

  it('requires MCP tool registrations to declare DTO handling', async () => {
    await expect(
      executor.prepareInput('unsafe_tool', {}, undefined),
    ).rejects.toThrow('MCP tool unsafe_tool must declare a DTO or noDto');
  });

  it('validates MCP tool input through the registration template', async () => {
    await expect(
      executor.prepareInput(
        'get_page',
        {
          pageId: '018f3f73-2f69-7c8d-9d79-8f3f4d7d9711',
          format: 'xml',
        },
        { dto: PageInfoDto },
      ),
    ).rejects.toThrow('format must be one of the following values');

    await expect(
      executor.prepareInput('current_user', { ignored: true }, { noDto: true }),
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
    const access = new McpToolAccessService(
      pageRepo as any,
      {} as any,
      {} as any,
      {} as any,
    );

    await expect(
      access.findActiveWorkspacePage('page-id', 'workspace-id'),
    ).resolves.toBeNull();
  });

  it('requires source page edit permission for duplicate_page', async () => {
    const { handlers, pageAccessService, pageService } = registerMcpTools({
      auditService,
      pageAccessService: {
        validateCanEdit: jest.fn().mockRejectedValue(new ForbiddenException()),
        validateCanView: jest.fn(),
      },
    });

    await expect(handlers.duplicate_page({ pageId })).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    expect(pageAccessService.validateCanEdit).toHaveBeenCalled();
    expect(pageAccessService.validateCanView).not.toHaveBeenCalled();
    expect(pageService.duplicatePage).not.toHaveBeenCalled();
  });

  it('passes the authenticated actor through MCP page moves', async () => {
    const pageService = {
      movePageToParent: jest.fn().mockResolvedValue(undefined),
    };
    const { handlers } = registerMcpTools({ pageService });

    await handlers.move_page({ pageId });

    expect(pageService.movePageToParent).toHaveBeenCalledWith(
      expect.objectContaining({ id: pageId }),
      null,
      'user-id',
    );
  });

  it('requires target space create permission for copy_page_to_space', async () => {
    const { handlers, pageService } = registerMcpTools({
      auditService,
      spaceAbility: {
        createForUser: jest.fn(async (_user, checkedSpaceId: string) => ({
          can: jest.fn().mockReturnValue(false),
          cannot: jest.fn(
            (action: SpaceCaslAction, subject: SpaceCaslSubject) =>
              checkedSpaceId === targetSpaceId &&
              action === SpaceCaslAction.Create &&
              subject === SpaceCaslSubject.Page,
          ),
        })),
      },
    });

    await expect(
      handlers.copy_page_to_space({
        pageId,
        spaceId: targetSpaceId,
      }),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(pageService.duplicatePage).not.toHaveBeenCalled();
  });

  it('keeps workspace member listing behind Manage Member', async () => {
    const workspaceService = { getWorkspaceUsers: jest.fn() };
    const { handlers } = registerMcpTools({
      auditService,
      workspaceService,
      workspaceAbility: {
        createForUser: jest.fn(() => ({
          cannot: jest.fn().mockReturnValue(true),
        })),
      },
    });

    await expect(
      handlers.list_workspace_members({ limit: 10 }),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(workspaceService.getWorkspaceUsers).not.toHaveBeenCalled();
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
        spaceAccess: context('read-write', [ApiKeyScope.MCP_WRITE]).spaceAccess,
        principalRevision: 'principal-revision-1',
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
      permissionRevision: 'principal-revision-1:space-revision-1',
      context: context('read-write', [ApiKeyScope.MCP_WRITE]),
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

  it('closes an existing session when its effective spaces change', async () => {
    const end = jest.fn();
    const close = jest.fn().mockResolvedValue(undefined);
    const handleRequest = jest.fn();
    const res = {
      writeHead: jest.fn().mockReturnValue({ end }),
    };
    const originalContext = context('read-write', [ApiKeyScope.MCP_WRITE]);
    (service as any).sessions.set('session-id', {
      userId: 'user-id',
      workspaceId: 'workspace-id',
      authType: 'api_key',
      credentialId: 'api-key-id',
      mode: originalContext.mode,
      scopes: originalContext.scopes,
      permissionRevision: 'principal-revision-1:space-revision-1',
      context: originalContext,
      transport: { close, handleRequest },
    });
    const narrowedContext = {
      ...originalContext,
      spaceAccess: {
        ...originalContext.spaceAccess,
        effectiveSpaceIds: [spaceId],
        revision: 'space-revision-2',
      },
    };

    await service.handleRequest(
      { headers: { 'mcp-session-id': 'session-id' } } as any,
      res as any,
      {},
      { id: 'user-id' } as any,
      { id: 'workspace-id' } as any,
      narrowedContext,
    );

    expect(close).toHaveBeenCalled();
    expect(handleRequest).not.toHaveBeenCalled();
    expect((service as any).sessions.has('session-id')).toBe(false);
  });

  it('closes sessions that include a deleted space', async () => {
    const affectedClose = jest.fn().mockResolvedValue(undefined);
    const unaffectedClose = jest.fn().mockResolvedValue(undefined);
    const affectedContext = context('read-write', [ApiKeyScope.MCP_WRITE]);
    const unaffectedContext = {
      ...affectedContext,
      credentialId: 'other-api-key-id',
      apiKeyId: 'other-api-key-id',
      spaceAccess: {
        ...affectedContext.spaceAccess,
        effectiveSpaceIds: [targetSpaceId],
      },
    };
    (service as any).sessions.set('affected-session', {
      sessionId: 'affected-session',
      userId: 'user-id',
      workspaceId: 'workspace-id',
      authType: 'api_key',
      credentialId: 'api-key-id',
      context: affectedContext,
      transport: { close: affectedClose },
    });
    (service as any).sessions.set('unaffected-session', {
      sessionId: 'unaffected-session',
      userId: 'user-id',
      workspaceId: 'workspace-id',
      authType: 'api_key',
      credentialId: 'other-api-key-id',
      context: unaffectedContext,
      transport: { close: unaffectedClose },
    });

    await service.handleSpaceDeleted({ spaceId });

    expect(affectedClose).toHaveBeenCalled();
    expect(unaffectedClose).not.toHaveBeenCalled();
    expect((service as any).sessions.has('affected-session')).toBe(false);
    expect((service as any).sessions.has('unaffected-session')).toBe(true);
  });

  it('expires idle sessions and audits the expiry', async () => {
    const close = jest.fn().mockResolvedValue(undefined);
    const session = {
      sessionId: 'expired-session-id',
      userId: 'user-id',
      workspaceId: 'workspace-id',
      authType: 'api_key',
      credentialId: 'api-key-id',
      mode: 'read-write',
      scopes: [ApiKeyScope.MCP_WRITE],
      context: context('read-write', [ApiKeyScope.MCP_WRITE]),
      lastActivityAt: 0,
      transport: { close },
    };
    (service as any).sessions.set('expired-session-id', session);

    await (service as any).pruneExpiredSessions();

    expect(close).toHaveBeenCalled();
    expect((service as any).sessions.has('expired-session-id')).toBe(false);
    expect(auditService.logWithContext).toHaveBeenCalledWith(
      expect.objectContaining({ event: 'mcp.session_expired' }),
      expect.objectContaining({ actorId: 'user-id' }),
    );
  });

  it('keeps sessions with an active MCP operation', async () => {
    const close = jest.fn().mockResolvedValue(undefined);
    (service as any).sessions.set('streaming-session-id', {
      sessionId: 'streaming-session-id',
      userId: 'user-id',
      workspaceId: 'workspace-id',
      authType: 'api_key',
      credentialId: 'api-key-id',
      mode: 'read-write',
      scopes: [ApiKeyScope.MCP_WRITE],
      context: context('read-write', [ApiKeyScope.MCP_WRITE]),
      lastActivityAt: 0,
      activeOperations: 1,
      transport: { close },
    });

    await (service as any).pruneExpiredSessions();

    expect(close).not.toHaveBeenCalled();
    expect((service as any).sessions.has('streaming-session-id')).toBe(true);
  });

  it('does not treat an open SSE request as session activity', async () => {
    const session = {
      sessionId: 'sse-session-id',
      lastActivityAt: 123,
      activeOperations: 0,
      transport: { handleRequest: jest.fn().mockResolvedValue(undefined) },
    };
    (service as any).sessions.set(session.sessionId, session);

    await (service as any).handleSessionRequest(
      session,
      { method: 'GET' },
      {},
      undefined,
    );

    expect(session.lastActivityAt).toBe(123);
    expect(session.activeOperations).toBe(0);
  });

  it('rejects new sessions when the active session limit is reached', async () => {
    const end = jest.fn();
    const res = {
      writeHead: jest.fn().mockReturnValue({ end }),
    };
    (service as any).maxSessions = 1;
    (service as any).sessions.set('active-session-id', {
      sessionId: 'active-session-id',
      userId: 'user-id',
      workspaceId: 'workspace-id',
      authType: 'api_key',
      credentialId: 'api-key-id',
      mode: 'read-write',
      scopes: [ApiKeyScope.MCP_WRITE],
      context: context('read-write', [ApiKeyScope.MCP_WRITE]),
      lastActivityAt: Date.now(),
      transport: { close: jest.fn() },
    });

    await service.handleRequest(
      { headers: {} } as any,
      res as any,
      { jsonrpc: '2.0', id: 1, method: 'initialize' },
      { id: 'user-id' } as any,
      { id: 'workspace-id' } as any,
      context('read-write', [ApiKeyScope.MCP_WRITE]),
    );

    expect(res.writeHead).toHaveBeenCalledWith(429, {
      'Content-Type': 'application/json',
    });
    expect(end).toHaveBeenCalledWith(
      JSON.stringify({ error: 'Too many active MCP sessions' }),
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
      activeOperations: 0,
    });
    expect(server.connect).toHaveBeenCalledWith(transport);
    expect(transport.handleRequest).toHaveBeenCalledWith(req, res, body);

    expect(auditService.logWithContext).toHaveBeenCalledWith(
      expect.objectContaining({ event: 'mcp.session_started' }),
      expect.objectContaining({ actorId: 'user-id' }),
    );

    transport.onclose();
    expect(sessions.has('generated-session-id')).toBe(false);
    expect(auditService.logWithContext).toHaveBeenCalledWith(
      expect.objectContaining({ event: 'mcp.session_closed' }),
      expect.objectContaining({ actorId: 'user-id' }),
    );
  });
});

function getSchemaContract(schema: any) {
  const optional = schema.isOptional?.() === true;
  let current = schema;
  while (current?._def?.type === 'optional') {
    current = current._def.innerType;
  }
  const definition = current?._def ?? {};
  const values = definition.entries
    ? Object.values(definition.entries)
    : definition.values;

  return {
    type: definition.type ?? current?.constructor?.name ?? 'unknown',
    optional,
    ...(values ? { values } : {}),
  };
}
