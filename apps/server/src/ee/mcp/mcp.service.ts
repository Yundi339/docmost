import {
  ForbiddenException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  OnModuleDestroy,
} from '@nestjs/common';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { IncomingMessage, ServerResponse } from 'node:http';
import { randomUUID } from 'crypto';
import { z } from 'zod';
import { PageService } from '../../core/page/services/page.service';
import { PageRepo } from '@docmost/db/repos/page/page.repo';
import { SpaceService } from '../../core/space/services/space.service';
import { SpaceMemberService } from '../../core/space/services/space-member.service';
import { CommentService } from '../../core/comment/comment.service';
import { SearchService } from '../../core/search/search.service';
import { SearchAttachmentsService } from '../../core/search/search-attachments.service';
import { WorkspaceService } from '../../core/workspace/services/workspace.service';
import { UserRepo } from '@docmost/db/repos/user/user.repo';
import SpaceAbilityFactory from '../../core/casl/abilities/space-ability.factory';
import WorkspaceAbilityFactory from '../../core/casl/abilities/workspace-ability.factory';
import {
  SpaceCaslAction,
  SpaceCaslSubject,
} from '../../core/casl/interfaces/space-ability.type';
import {
  WorkspaceCaslAction,
  WorkspaceCaslSubject,
} from '../../core/casl/interfaces/workspace-ability.type';
import {
  jsonToMarkdown,
  jsonToHtml,
} from '../../collaboration/collaboration.util';
import { User, Workspace } from '@docmost/db/types/entity.types';
import { PaginationOptions } from '../../database/pagination/pagination-options';
import {
  AUDIT_SERVICE,
  IAuditService,
} from '../../integrations/audit/audit.service';
import { AuditEvent, AuditResource } from '../../common/events/audit-events';
import { ApiKeyScope, hasApiKeyScope } from '../../core/api-key/api-key-scopes';
import { PageAccessService } from '../../core/page/page-access/page-access.service';
import { validateDto } from '../../common/helpers/validate-dto';
import { CreatePageDto } from '../../core/page/dto/create-page.dto';
import { UpdatePageDto } from '../../core/page/dto/update-page.dto';
import { PageIdDto, PageInfoDto } from '../../core/page/dto/page.dto';
import { SidebarPageDto } from '../../core/page/dto/sidebar-page.dto';
import {
  MovePageToSpaceDto,
  MovePageUnderDto,
} from '../../core/page/dto/move-page.dto';
import { DuplicatePageDto } from '../../core/page/dto/duplicate-page.dto';
import { CreateCommentDto } from '../../core/comment/dto/create-comment.dto';
import { UpdateCommentDto } from '../../core/comment/dto/update-comment.dto';
import { CreateSpaceDto } from '../../core/space/dto/create-space.dto';
import { UpdateSpaceDto } from '../../core/space/dto/update-space.dto';
import { SpaceIdDto as SpaceInfoDto } from '../../core/space/dto/space-id.dto';
import { SearchDTO } from '../../core/search/dto/search.dto';

// eslint-disable-next-line @typescript-eslint/no-require-imports
const packageJson = require('../../../package.json');

const MAX_LIMIT = 200;
export type McpMode = 'off' | 'read-only' | 'read-write';
type McpToolAccess = 'read' | 'write';

export interface McpRequestContext {
  authType: 'api_key' | 'oauth';
  credentialId: string;
  apiKeyId?: string;
  oauthAuthorizationId?: string;
  oauthClientId?: string;
  clientId?: string;
  scopes: string[];
  mode: McpMode;
  ipAddress?: string;
  userAgent?: string;
}

interface McpSession {
  transport: StreamableHTTPServerTransport;
  server: McpServer;
  userId: string;
  workspaceId: string;
  authType: 'api_key' | 'oauth';
  credentialId: string;
  scopes: string[];
  mode: McpMode;
}

@Injectable()
export class McpService implements OnModuleDestroy {
  private readonly logger = new Logger(McpService.name);
  private sessions = new Map<string, McpSession>();

  constructor(
    private readonly pageService: PageService,
    private readonly pageRepo: PageRepo,
    private readonly spaceService: SpaceService,
    private readonly spaceMemberService: SpaceMemberService,
    private readonly commentService: CommentService,
    private readonly searchService: SearchService,
    private readonly searchAttachmentsService: SearchAttachmentsService,
    private readonly workspaceService: WorkspaceService,
    private readonly userRepo: UserRepo,
    private readonly spaceAbility: SpaceAbilityFactory,
    private readonly workspaceAbility: WorkspaceAbilityFactory,
    private readonly pageAccessService: PageAccessService,
    @Inject(AUDIT_SERVICE) private readonly auditService: IAuditService,
  ) {}

  onModuleDestroy() {
    for (const [, session] of this.sessions) {
      session.transport.close().catch(() => {});
    }
    this.sessions.clear();
  }

  async handleRequest(
    req: IncomingMessage,
    res: ServerResponse,
    body: unknown,
    user: User,
    workspace: Workspace,
    context: McpRequestContext,
  ): Promise<void> {
    const sessionId = req.headers['mcp-session-id'] as string | undefined;

    if (sessionId && this.sessions.has(sessionId)) {
      const session = this.sessions.get(sessionId);
      // Prevent session hijacking: the caller's JWT must match the user/workspace
      // that created this session. Otherwise anyone with the sessionId + any valid
      // API key could execute tools as the original user.
      if (
        session.userId !== user.id ||
        session.workspaceId !== workspace.id ||
        session.authType !== context.authType ||
        session.credentialId !== context.credentialId
      ) {
        res
          .writeHead(403, { 'Content-Type': 'application/json' })
          .end(
            JSON.stringify({ error: 'Session does not belong to this user' }),
          );
        return;
      }
      if (
        session.mode !== context.mode ||
        !sameScopes(session.scopes, context.scopes)
      ) {
        await session.transport.close();
        this.sessions.delete(sessionId);
        res.writeHead(403, { 'Content-Type': 'application/json' }).end(
          JSON.stringify({
            error: 'MCP session permissions changed. Reconnect required.',
          }),
        );
        return;
      }
      await session.transport.handleRequest(req, res, body);
      return;
    }

    if (sessionId && !this.sessions.has(sessionId)) {
      res.writeHead(404).end(JSON.stringify({ error: 'Session not found' }));
      return;
    }

    // New session (initialization). This in-memory session store is suitable for
    // single-instance deployments. Multi-instance deployments must use sticky
    // sessions or replace this with a shared store.
    const server = this.createMcpServer(user, workspace, context);
    let sid: string | undefined;
    let transport: StreamableHTTPServerTransport;
    transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: () => randomUUID(),
      onsessioninitialized: (sessionId) => {
        sid = sessionId;
        this.sessions.set(sessionId, {
          transport,
          server,
          userId: user.id,
          workspaceId: workspace.id,
          authType: context.authType,
          credentialId: context.credentialId,
          scopes: context.scopes,
          mode: context.mode,
        });
      },
    });

    transport.onclose = () => {
      if (!sid) return;

      this.sessions.delete(sid);
      this.logger.debug(`MCP session ${sid} closed`);
    };

    await server.connect(transport);
    await transport.handleRequest(req, res, body);
  }

  async handleDelete(
    req: IncomingMessage,
    res: ServerResponse,
    user?: User,
    workspace?: Workspace,
    context?: McpRequestContext,
  ): Promise<void> {
    const sessionId = req.headers['mcp-session-id'] as string | undefined;
    if (sessionId && this.sessions.has(sessionId)) {
      const session = this.sessions.get(sessionId);
      if (
        user &&
        workspace &&
        (session.userId !== user.id ||
          session.workspaceId !== workspace.id ||
          (context &&
            (session.authType !== context.authType ||
              session.credentialId !== context.credentialId)))
      ) {
        res.writeHead(403).end();
        return;
      }
      await session.transport.close();
      this.sessions.delete(sessionId);
      res.writeHead(200).end();
    } else {
      res.writeHead(404).end();
    }
  }

  private paginate(limit?: number): PaginationOptions {
    const opts = new PaginationOptions();
    const safe = Math.min(Math.max(1, limit ?? 50), MAX_LIMIT);
    opts.limit = safe;
    opts.query = '';
    opts.adminView = false;
    return opts;
  }

  private async assertSpacePageAccess(
    user: User,
    spaceId: string,
    action: SpaceCaslAction = SpaceCaslAction.Read,
  ) {
    const ability = await this.spaceAbility.createForUser(user, spaceId);
    if (ability.cannot(action, SpaceCaslSubject.Page)) {
      throw new ForbiddenException('Forbidden: insufficient space permissions');
    }
  }

  private async getSpacePageEditAccess(user: User, spaceId: string) {
    const ability = await this.spaceAbility.createForUser(user, spaceId);
    if (ability.cannot(SpaceCaslAction.Read, SpaceCaslSubject.Page)) {
      throw new ForbiddenException('Forbidden: insufficient space permissions');
    }
    return ability.can(SpaceCaslAction.Edit, SpaceCaslSubject.Page);
  }

  private async assertSpaceSettingsManage(user: User, spaceId: string) {
    const ability = await this.spaceAbility.createForUser(user, spaceId);
    if (ability.cannot(SpaceCaslAction.Manage, SpaceCaslSubject.Settings)) {
      throw new ForbiddenException(
        'Forbidden: space settings management required',
      );
    }
  }

  private async runTool(
    context: McpRequestContext,
    user: User,
    workspace: Workspace,
    toolName: string,
    access: McpToolAccess,
    args: Record<string, any>,
    handler: () => Promise<any>,
  ) {
    try {
      this.assertMcpToolAccess(context, access);
      const result = await handler();
      this.auditMcpToolCall(
        user,
        workspace,
        context,
        toolName,
        access,
        args,
        !isMcpToolError(result),
      );
      return result;
    } catch (err) {
      this.auditMcpToolCall(
        user,
        workspace,
        context,
        toolName,
        access,
        args,
        false,
        err,
      );
      throw err;
    }
  }

  private assertMcpToolAccess(
    context: McpRequestContext,
    access: McpToolAccess,
  ) {
    if (context.mode === 'off') {
      throw new ForbiddenException('MCP is not enabled for this workspace');
    }

    if (
      !hasApiKeyScope(context.scopes, ApiKeyScope.MCP_READ) &&
      !hasApiKeyScope(context.scopes, ApiKeyScope.MCP_WRITE)
    ) {
      throw new ForbiddenException('Missing API key scope: mcp:read');
    }

    if (access === 'write') {
      if (context.mode === 'read-only') {
        throw new ForbiddenException('MCP is enabled in read-only mode');
      }
      if (!hasApiKeyScope(context.scopes, ApiKeyScope.MCP_WRITE)) {
        throw new ForbiddenException('Missing API key scope: mcp:write');
      }
    }
  }

  private auditMcpToolCall(
    user: User,
    workspace: Workspace,
    context: McpRequestContext,
    toolName: string,
    access: McpToolAccess,
    args: Record<string, any>,
    success: boolean,
    err?: unknown,
  ) {
    const targetId = getMcpTargetId(args);
    this.auditService.logWithContext(
      {
        event: AuditEvent.MCP_TOOL_CALLED,
        resourceType: AuditResource.MCP_TOOL,
        resourceId: isUuid(targetId) ? targetId : undefined,
        metadata: {
          toolName,
          access,
          authType: context.authType,
          credentialId: context.credentialId,
          apiKeyId: context.apiKeyId,
          oauthAuthorizationId: context.oauthAuthorizationId,
          oauthClientId: context.oauthClientId,
          clientId: context.clientId,
          success,
          target: getMcpTargetMetadata(args),
          error: getAuditError(err),
          userAgent: truncateString(context.userAgent, 1000),
        },
      },
      {
        workspaceId: workspace.id,
        actorId: user.id,
        actorType: context.authType,
        ipAddress: context.ipAddress,
      },
    );
  }

  private createMcpServer(
    user: User,
    workspace: Workspace,
    context: McpRequestContext,
  ): McpServer {
    const server = new McpServer(
      {
        name: 'Docmost',
        version: process.env.APP_VERSION || packageJson?.version || 'unknown',
      },
      {
        capabilities: {
          tools: {},
        },
      },
    );

    this.registerTools(server, user, workspace, context);

    return server;
  }

  private registerTools(
    server: McpServer,
    user: User,
    workspace: Workspace,
    context: McpRequestContext,
  ): void {
    const userId = user.id;
    const workspaceId = workspace.id;
    const readTool = (
      name: string,
      description: string,
      schema: any,
      handler: (args: any) => Promise<any>,
    ) =>
      server.registerTool(
        name,
        toolOptions(description, schema, 'read'),
        (args: any) =>
          this.runTool(context, user, workspace, name, 'read', args, () =>
            handler(args),
          ),
      );
    const writeTool = (
      name: string,
      description: string,
      schema: any,
      handler: (args: any) => Promise<any>,
    ) =>
      server.registerTool(
        name,
        toolOptions(description, schema, 'write'),
        (args: any) =>
          this.runTool(context, user, workspace, name, 'write', args, () =>
            handler(args),
          ),
      );

    // 1. search_pages
    readTool(
      'search_pages',
      'Search pages by query text',
      {
        query: z.string(),
        spaceId: z.string().optional(),
        limit: z.number().optional(),
      },
      async ({ query, spaceId, limit }) => {
        const input = await validateDto(SearchDTO, {
          query,
          spaceId,
          limit: this.paginate(limit).limit,
          offset: 0,
        });
        delete input.shareId;

        if (input.spaceId) {
          await this.assertSpacePageAccess(
            user,
            input.spaceId,
            SpaceCaslAction.Read,
          );
        }

        const result = await this.searchService.searchPage(
          input,
          { userId, workspaceId },
        );
        return {
          content: [{ type: 'text', text: JSON.stringify(result.items) }],
        };
      },
    );

    // 2. get_page
    readTool(
      'get_page',
      'Get a page by ID. Returns content in the specified format (json, markdown, or html)',
      {
        pageId: z.string(),
        format: z.enum(['json', 'markdown', 'html']).optional(),
      },
      async ({ pageId, format }) => {
        const input = await validateDto(PageInfoDto, { pageId, format });
        const page = await this.pageRepo.findById(input.pageId, {
          includeContent: true,
          includeSpace: true,
        });
        if (!page || page.workspaceId !== workspaceId) {
          return {
            content: [{ type: 'text', text: 'Page not found' }],
            isError: true,
          };
        }
        await this.pageAccessService.validateCanView(page, user);
        let content = page.content;
        if (input.format && input.format !== 'json' && content) {
          content =
            input.format === 'markdown'
              ? jsonToMarkdown(content)
              : jsonToHtml(content);
        }
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify({
                id: page.id,
                slugId: page.slugId,
                title: page.title,
                icon: page.icon,
                spaceId: page.spaceId,
                parentPageId: page.parentPageId,
                creatorId: page.creatorId,
                content,
                createdAt: page.createdAt,
                updatedAt: page.updatedAt,
              }),
            },
          ],
        };
      },
    );

    // 3. create_page
    writeTool(
      'create_page',
      'Create a new page in a space. Content can be markdown, html, or json format',
      {
        spaceId: z.string(),
        title: z.string().optional(),
        content: z.string().optional(),
        format: z.enum(['json', 'markdown', 'html']).optional(),
        parentPageId: z.string().optional(),
      },
      async ({ spaceId, title, content, format, parentPageId }) => {
        const input = await validateDto(CreatePageDto, {
          spaceId,
          title,
          content,
          format,
          parentPageId,
        });
        if (input.parentPageId) {
          const parentPage = await this.pageRepo.findById(input.parentPageId);
          if (
            !parentPage ||
            parentPage.deletedAt ||
            parentPage.workspaceId !== workspaceId ||
            parentPage.spaceId !== input.spaceId
          ) {
            return {
              content: [{ type: 'text', text: 'Parent page not found' }],
              isError: true,
            };
          }
          await this.pageAccessService.validateCanEdit(parentPage, user);
        } else {
          await this.assertSpacePageAccess(
            user,
            input.spaceId,
            SpaceCaslAction.Create,
          );
        }
        const page = await this.pageService.create(userId, workspaceId, {
          spaceId: input.spaceId,
          title: input.title,
          content: input.content,
          format: input.format ?? 'markdown',
          parentPageId: input.parentPageId,
        });
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify({
                id: page.id,
                slugId: page.slugId,
                title: page.title,
              }),
            },
          ],
        };
      },
    );

    // 4. update_page
    writeTool(
      'update_page',
      'Update an existing page. Supports append, prepend, or replace operations',
      {
        pageId: z.string(),
        title: z.string().optional(),
        content: z.string().optional(),
        format: z.enum(['json', 'markdown', 'html']).optional(),
        operation: z.enum(['append', 'prepend', 'replace']).optional(),
      },
      async ({ pageId, title, content, format, operation }) => {
        const input = await validateDto(UpdatePageDto, {
          pageId,
          title,
          content,
          format,
          operation,
        });
        const page = await this.pageRepo.findById(input.pageId);
        if (!page || page.workspaceId !== workspaceId) {
          return {
            content: [{ type: 'text', text: 'Page not found' }],
            isError: true,
          };
        }
        await this.pageAccessService.validateCanEdit(page, user);
        const updated = await this.pageService.update(
          page,
          {
            pageId: input.pageId,
            title: input.title,
            content: input.content,
            format: input.format ?? 'markdown',
            operation: input.operation ?? 'replace',
          },
          user,
        );
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify({ id: updated.id, title: updated.title }),
            },
          ],
        };
      },
    );

    // 5. list_pages
    readTool(
      'list_pages',
      'List root-level pages in a space',
      { spaceId: z.string(), limit: z.number().optional() },
      async ({ spaceId, limit }) => {
        const input = await validateDto(SidebarPageDto, { spaceId });
        const spaceCanEdit = await this.getSpacePageEditAccess(
          user,
          input.spaceId,
        );
        const result = await this.pageService.getSidebarPages(
          input.spaceId,
          this.paginate(limit),
          undefined,
          userId,
          spaceCanEdit,
        );
        return {
          content: [{ type: 'text', text: JSON.stringify(result.items) }],
        };
      },
    );

    // 6. list_child_pages
    readTool(
      'list_child_pages',
      'List child pages of a specific page',
      { spaceId: z.string(), pageId: z.string(), limit: z.number().optional() },
      async ({ spaceId, pageId, limit }) => {
        const input = await validateDto(SidebarPageDto, { spaceId, pageId });
        const page = await this.pageRepo.findById(input.pageId);
        if (
          !page ||
          page.deletedAt ||
          page.workspaceId !== workspaceId ||
          page.spaceId !== input.spaceId
        ) {
          return {
            content: [{ type: 'text', text: 'Page not found' }],
            isError: true,
          };
        }
        await this.pageAccessService.validateCanView(page, user);
        const spaceCanEdit = await this.getSpacePageEditAccess(
          user,
          input.spaceId,
        );
        const result = await this.pageService.getSidebarPages(
          input.spaceId,
          this.paginate(limit),
          input.pageId,
          userId,
          spaceCanEdit,
        );
        return {
          content: [{ type: 'text', text: JSON.stringify(result.items) }],
        };
      },
    );

    // 7. duplicate_page
    writeTool(
      'duplicate_page',
      'Duplicate a page within the same space',
      { pageId: z.string() },
      async ({ pageId }) => {
        const input = await validateDto(DuplicatePageDto, { pageId });
        const page = await this.pageRepo.findById(input.pageId);
        if (!page || page.workspaceId !== workspaceId) {
          return {
            content: [{ type: 'text', text: 'Page not found' }],
            isError: true,
          };
        }
        await this.pageAccessService.validateCanView(page, user);
        await this.assertSpacePageAccess(
          user,
          page.spaceId,
          SpaceCaslAction.Edit,
        );
        const newPage = await this.pageService.duplicatePage(
          page,
          undefined,
          user,
        );
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify({ id: newPage.id, title: newPage.title }),
            },
          ],
        };
      },
    );

    // 8. copy_page_to_space
    writeTool(
      'copy_page_to_space',
      'Copy a page to a different space',
      { pageId: z.string(), spaceId: z.string() },
      async ({ pageId, spaceId }) => {
        const input = await validateDto(DuplicatePageDto, { pageId, spaceId });
        const page = await this.pageRepo.findById(input.pageId);
        if (!page || page.workspaceId !== workspaceId) {
          return {
            content: [{ type: 'text', text: 'Page not found' }],
            isError: true,
          };
        }
        await this.pageAccessService.validateCanView(page, user);
        await this.assertSpacePageAccess(
          user,
          page.spaceId,
          SpaceCaslAction.Edit,
        );
        await this.assertSpacePageAccess(
          user,
          input.spaceId,
          SpaceCaslAction.Edit,
        );
        const newPage = await this.pageService.duplicatePage(
          page,
          input.spaceId,
          user,
        );
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify({ id: newPage.id, title: newPage.title }),
            },
          ],
        };
      },
    );

    // 9. move_page
    writeTool(
      'move_page',
      'Move a page under a new parent within the same space',
      { pageId: z.string(), parentPageId: z.string().optional() },
      async ({ pageId, parentPageId }) => {
        const input = await validateDto(MovePageUnderDto, {
          pageId,
          targetPageId: parentPageId,
        });
        const page = await this.pageRepo.findById(input.pageId);
        if (!page || page.workspaceId !== workspaceId) {
          return {
            content: [{ type: 'text', text: 'Page not found' }],
            isError: true,
          };
        }
        await this.assertSpacePageAccess(
          user,
          page.spaceId,
          SpaceCaslAction.Edit,
        );
        await this.pageAccessService.validateCanEdit(page, user);
        if (input.targetPageId) {
          const parentPage = await this.pageRepo.findById(input.targetPageId);
          if (
            !parentPage ||
            parentPage.deletedAt ||
            parentPage.workspaceId !== workspaceId ||
            parentPage.spaceId !== page.spaceId
          ) {
            return {
              content: [{ type: 'text', text: 'Parent page not found' }],
              isError: true,
            };
          }
          await this.pageAccessService.validateCanEdit(parentPage, user);
        }
        await this.pageService.movePageToParent(
          page,
          input.targetPageId ?? null,
        );
        return {
          content: [
            { type: 'text', text: `Page ${input.pageId} moved successfully` },
          ],
        };
      },
    );

    // 10. move_page_to_space
    writeTool(
      'move_page_to_space',
      'Move a page to a different space',
      { pageId: z.string(), spaceId: z.string() },
      async ({ pageId, spaceId }) => {
        const input = await validateDto(MovePageToSpaceDto, {
          pageId,
          spaceId,
        });
        const page = await this.pageRepo.findById(input.pageId);
        if (!page || page.workspaceId !== workspaceId) {
          return {
            content: [{ type: 'text', text: 'Page not found' }],
            isError: true,
          };
        }
        await this.assertSpacePageAccess(
          user,
          page.spaceId,
          SpaceCaslAction.Edit,
        );
        await this.pageAccessService.validateCanEdit(page, user);
        await this.assertSpacePageAccess(
          user,
          input.spaceId,
          SpaceCaslAction.Edit,
        );
        await this.pageService.movePageToSpace(page, input.spaceId, userId);
        return {
          content: [
            {
              type: 'text',
              text: `Page ${input.pageId} moved to space ${input.spaceId}`,
            },
          ],
        };
      },
    );

    // 11. get_space
    readTool(
      'get_space',
      'Get space information by ID',
      { spaceId: z.string() },
      async ({ spaceId }) => {
        const input = await validateDto(SpaceInfoDto, { spaceId });
        await this.assertSpacePageAccess(
          user,
          input.spaceId,
          SpaceCaslAction.Read,
        );
        const space = await this.spaceService.getSpaceInfo(
          input.spaceId,
          workspaceId,
        );
        return { content: [{ type: 'text', text: JSON.stringify(space) }] };
      },
    );

    // 12. list_spaces
    readTool(
      'list_spaces',
      'List all spaces the user has access to',
      {},
      async () => {
        const result = await this.spaceMemberService.getUserSpaces(
          userId,
          this.paginate(100),
        );
        return { content: [{ type: 'text', text: JSON.stringify(result) }] };
      },
    );

    // 13. create_space
    writeTool(
      'create_space',
      'Create a new space',
      {
        name: z.string(),
        slug: z.string(),
        description: z.string().optional(),
      },
      async ({ name, slug, description }) => {
        const input = await validateDto(CreateSpaceDto, {
          name,
          slug,
          description,
        });
        const ability = this.workspaceAbility.createForUser(user, workspace);
        if (
          ability.cannot(WorkspaceCaslAction.Manage, WorkspaceCaslSubject.Space)
        ) {
          throw new ForbiddenException('Forbidden: cannot create spaces');
        }
        const space = await this.spaceService.createSpace(
          user,
          workspaceId,
          input,
        );
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify({
                id: space.id,
                name: space.name,
                slug: space.slug,
              }),
            },
          ],
        };
      },
    );

    // 14. update_space
    writeTool(
      'update_space',
      'Update a space',
      {
        spaceId: z.string(),
        name: z.string().optional(),
        description: z.string().optional(),
      },
      async ({ spaceId, name, description }) => {
        const input = await validateDto(UpdateSpaceDto, {
          spaceId,
          name,
          description,
        });
        await this.assertSpaceSettingsManage(user, input.spaceId);
        const space = await this.spaceService.updateSpace(
          input as any,
          workspaceId,
        );
        return { content: [{ type: 'text', text: JSON.stringify(space) }] };
      },
    );

    // 15. get_comments
    readTool(
      'get_comments',
      'Get comments on a page',
      { pageId: z.string(), limit: z.number().optional() },
      async ({ pageId, limit }) => {
        const input = await validateDto(PageIdDto, { pageId });
        const page = await this.pageRepo.findById(input.pageId);
        if (!page || page.workspaceId !== workspaceId) {
          return {
            content: [{ type: 'text', text: 'Page not found' }],
            isError: true,
          };
        }
        await this.pageAccessService.validateCanView(page, user);
        const comments = await this.commentService.findByPageId(
          input.pageId,
          this.paginate(limit),
        );
        return { content: [{ type: 'text', text: JSON.stringify(comments) }] };
      },
    );

    // 16. create_comment
    writeTool(
      'create_comment',
      'Create a comment on a page (page-level comment). Content must be a JSON string of ProseMirror document.',
      {
        pageId: z.string(),
        content: z.string().describe('JSON ProseMirror content string'),
      },
      async ({ pageId, content }) => {
        const input = await validateDto(CreateCommentDto, {
          pageId,
          content,
          type: 'page',
        });
        const page = await this.pageRepo.findById(input.pageId);
        if (!page || page.workspaceId !== workspaceId) {
          return {
            content: [{ type: 'text', text: 'Page not found' }],
            isError: true,
          };
        }
        await this.pageAccessService.validateCanComment(page, user, workspaceId);
        const comment = await this.commentService.create(
          { page, workspaceId, user },
          input,
        );
        return {
          content: [{ type: 'text', text: JSON.stringify({ id: comment.id }) }],
        };
      },
    );

    // 17. update_comment
    writeTool(
      'update_comment',
      'Update an existing comment. Content must be a JSON string of ProseMirror document.',
      {
        commentId: z.string(),
        content: z.string().describe('JSON ProseMirror content string'),
      },
      async ({ commentId, content }) => {
        const input = await validateDto(UpdateCommentDto, {
          commentId,
          content,
        });
        const existingComment = await this.commentService.findById(
          input.commentId,
          workspaceId,
        );
        if (!existingComment) {
          throw new NotFoundException('Comment not found');
        }
        if (existingComment.creatorId !== userId) {
          throw new ForbiddenException('You can only edit your own comments');
        }
        const page = await this.pageRepo.findById(existingComment.pageId);
        if (!page || page.workspaceId !== workspaceId) {
          throw new NotFoundException('Page not found');
        }
        await this.pageAccessService.validateCanComment(page, user, workspaceId);
        const updated = await this.commentService.update(
          existingComment,
          input,
          user,
        );
        return {
          content: [{ type: 'text', text: JSON.stringify({ id: updated.id }) }],
        };
      },
    );

    // 18. search_attachments
    readTool(
      'search_attachments',
      'Search attachments (PDF, DOCX) by text content',
      { query: z.string(), limit: z.number().optional() },
      async ({ query, limit }) => {
        const input = await validateDto(SearchDTO, {
          query,
          limit: this.paginate(limit).limit,
          offset: 0,
        });
        const result = await this.searchAttachmentsService.searchAttachments(
          input,
          userId,
          workspaceId,
        );

        return {
          content: [{ type: 'text', text: JSON.stringify(result.items) }],
        };
      },
    );

    // 19. list_workspace_members
    readTool(
      'list_workspace_members',
      'List workspace members',
      { limit: z.number().optional() },
      async ({ limit }) => {
        const ability = this.workspaceAbility.createForUser(user, workspace);
        if (
          ability.cannot(WorkspaceCaslAction.Manage, WorkspaceCaslSubject.Member)
        ) {
          throw new ForbiddenException(
            'Forbidden: cannot list workspace members',
          );
        }
        const result = await this.workspaceService.getWorkspaceUsers(
          workspaceId,
          this.paginate(limit),
        );
        return { content: [{ type: 'text', text: JSON.stringify(result) }] };
      },
    );

    // 20. get_current_user
    readTool(
      'get_current_user',
      'Get information about the currently authenticated user',
      {},
      async () => {
        const u = await this.userRepo.findById(userId, workspaceId);
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify({
                id: u.id,
                name: u.name,
                email: u.email,
                role: u.role,
                avatarUrl: u.avatarUrl,
              }),
            },
          ],
        };
      },
    );
  }
}

function getMcpTargetId(args: Record<string, any>) {
  return (
    args.pageId ??
    args.commentId ??
    args.spaceId ??
    args.parentPageId ??
    undefined
  );
}

function getMcpTargetMetadata(args: Record<string, any>) {
  const allowedKeys = [
    'pageId',
    'commentId',
    'spaceId',
    'parentPageId',
    'format',
    'operation',
  ];

  return Object.fromEntries(
    allowedKeys
      .filter((key) => typeof args[key] !== 'undefined')
      .map((key) => [key, args[key]]),
  );
}

function isMcpToolError(result: unknown) {
  return (
    !!result &&
    typeof result === 'object' &&
    'isError' in result &&
    result.isError === true
  );
}

function getAuditError(err?: unknown) {
  if (!err) return undefined;
  if (err instanceof Error) {
    return {
      name: err.name,
      message: truncateString(err.message, 300),
    };
  }
  return { name: 'Error' };
}

function truncateString(value: unknown, maxLength: number) {
  if (typeof value !== 'string') return undefined;
  return value.length > maxLength ? value.slice(0, maxLength) : value;
}

function isUuid(value: unknown) {
  return (
    typeof value === 'string' &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
      value,
    )
  );
}

function sameScopes(left: string[], right: string[]) {
  if (left.length !== right.length) return false;

  const leftSet = new Set(left);
  return right.every((scope) => leftSet.has(scope));
}

function toolOptions(
  description: string,
  inputSchema: any,
  access: McpToolAccess,
) {
  const scope = access === 'write' ? 'mcp:write' : 'mcp:read';
  const securitySchemes = [{ type: 'oauth2', scopes: [scope] }];

  return {
    description,
    inputSchema,
    annotations: {
      readOnlyHint: access === 'read',
      destructiveHint: false,
    },
    securitySchemes,
    _meta: {
      securitySchemes,
    },
  } as any;
}
