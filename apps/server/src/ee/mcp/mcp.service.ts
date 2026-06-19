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
import { InjectKysely } from 'nestjs-kysely';
import { KyselyDB } from '@docmost/db/types/kysely.types';
import { PageService } from '../../core/page/services/page.service';
import { PageRepo } from '@docmost/db/repos/page/page.repo';
import { SpaceService } from '../../core/space/services/space.service';
import { SpaceMemberService } from '../../core/space/services/space-member.service';
import { SpaceMemberRepo } from '@docmost/db/repos/space/space-member.repo';
import { CommentService } from '../../core/comment/comment.service';
import { SearchService } from '../../core/search/search.service';
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
import { sql } from 'kysely';
import { User, Workspace } from '@docmost/db/types/entity.types';
import { PaginationOptions } from '../../database/pagination/pagination-options';
import {
  AUDIT_SERVICE,
  IAuditService,
} from '../../integrations/audit/audit.service';
import { AuditEvent, AuditResource } from '../../common/events/audit-events';
import { ApiKeyScope, hasApiKeyScope } from '../../core/api-key/api-key-scopes';

// eslint-disable-next-line @typescript-eslint/no-require-imports
const tsquery = require('pg-tsquery')();
// eslint-disable-next-line @typescript-eslint/no-require-imports
const packageJson = require('../../../package.json');

const MAX_LIMIT = 200;
export type McpMode = 'off' | 'read-only' | 'read-write';
type McpToolAccess = 'read' | 'write';

export interface McpRequestContext {
  apiKeyId: string;
  scopes: string[];
  mode: McpMode;
}

interface McpSession {
  transport: StreamableHTTPServerTransport;
  server: McpServer;
  userId: string;
  workspaceId: string;
  apiKeyId: string;
  scopes: string[];
  mode: McpMode;
}

@Injectable()
export class McpService implements OnModuleDestroy {
  private readonly logger = new Logger(McpService.name);
  private sessions = new Map<string, McpSession>();

  constructor(
    @InjectKysely() private readonly db: KyselyDB,
    private readonly pageService: PageService,
    private readonly pageRepo: PageRepo,
    private readonly spaceService: SpaceService,
    private readonly spaceMemberService: SpaceMemberService,
    private readonly spaceMemberRepo: SpaceMemberRepo,
    private readonly commentService: CommentService,
    private readonly searchService: SearchService,
    private readonly workspaceService: WorkspaceService,
    private readonly userRepo: UserRepo,
    private readonly spaceAbility: SpaceAbilityFactory,
    private readonly workspaceAbility: WorkspaceAbilityFactory,
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
        session.apiKeyId !== context.apiKeyId
      ) {
        res
          .writeHead(403, { 'Content-Type': 'application/json' })
          .end(
            JSON.stringify({ error: 'Session does not belong to this user' }),
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
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: () => randomUUID(),
    });

    const server = this.createMcpServer(user, workspace, context);
    await server.connect(transport);

    const sid = transport.sessionId;
    if (sid) {
      this.sessions.set(sid, {
        transport,
        server,
        userId: user.id,
        workspaceId: workspace.id,
        apiKeyId: context.apiKeyId,
        scopes: context.scopes,
        mode: context.mode,
      });

      transport.onclose = () => {
        this.sessions.delete(sid);
        this.logger.debug(`MCP session ${sid} closed`);
      };
    }

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
          (context && session.apiKeyId !== context.apiKeyId))
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
    this.assertMcpToolAccess(context, access);

    try {
      const result = await handler();
      if (access === 'write') {
        this.auditMcpWriteTool(user, workspace, context, toolName, args, true);
      }
      return result;
    } catch (err) {
      if (access === 'write') {
        this.auditMcpWriteTool(user, workspace, context, toolName, args, false);
      }
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

  private auditMcpWriteTool(
    user: User,
    workspace: Workspace,
    context: McpRequestContext,
    toolName: string,
    args: Record<string, any>,
    success: boolean,
  ) {
    this.auditService.logWithContext(
      {
        event: AuditEvent.MCP_TOOL_CALLED,
        resourceType: AuditResource.MCP_TOOL,
        resourceId: getMcpTargetId(args),
        metadata: {
          toolName,
          apiKeyId: context.apiKeyId,
          success,
          target: getMcpTargetMetadata(args),
        },
      },
      {
        workspaceId: workspace.id,
        actorId: user.id,
        actorType: 'api_key',
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
      server.tool(name, description, schema, (args: any) =>
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
      server.tool(name, description, schema, (args: any) =>
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
        const result = await this.searchService.searchPage(
          { query, spaceId, limit: limit ?? 25, offset: 0 },
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
        const page = await this.pageRepo.findById(pageId, {
          includeContent: true,
          includeSpace: true,
        });
        if (!page || page.workspaceId !== workspaceId) {
          return {
            content: [{ type: 'text', text: 'Page not found' }],
            isError: true,
          };
        }
        await this.assertSpacePageAccess(
          user,
          page.spaceId,
          SpaceCaslAction.Read,
        );
        let content = page.content;
        if (format && format !== 'json' && content) {
          content =
            format === 'markdown'
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
        if (parentPageId) {
          const parentPage = await this.pageRepo.findById(parentPageId);
          if (
            !parentPage ||
            parentPage.workspaceId !== workspaceId ||
            parentPage.spaceId !== spaceId
          ) {
            return {
              content: [{ type: 'text', text: 'Parent page not found' }],
              isError: true,
            };
          }
        }
        await this.assertSpacePageAccess(user, spaceId, SpaceCaslAction.Create);
        const page = await this.pageService.create(userId, workspaceId, {
          spaceId,
          title,
          content,
          format: format ?? 'markdown',
          parentPageId,
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
        const page = await this.pageRepo.findById(pageId);
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
        const updated = await this.pageService.update(
          page,
          {
            pageId,
            title,
            content,
            format: format ?? 'markdown',
            operation: operation ?? 'replace',
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
        await this.assertSpacePageAccess(user, spaceId, SpaceCaslAction.Read);
        const result = await this.pageService.getSidebarPages(
          spaceId,
          this.paginate(limit),
          undefined,
          userId,
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
        await this.assertSpacePageAccess(user, spaceId, SpaceCaslAction.Read);
        const result = await this.pageService.getSidebarPages(
          spaceId,
          this.paginate(limit),
          pageId,
          userId,
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
        const page = await this.pageRepo.findById(pageId);
        if (!page || page.workspaceId !== workspaceId) {
          return {
            content: [{ type: 'text', text: 'Page not found' }],
            isError: true,
          };
        }
        await this.assertSpacePageAccess(
          user,
          page.spaceId,
          SpaceCaslAction.Read,
        );
        await this.assertSpacePageAccess(
          user,
          page.spaceId,
          SpaceCaslAction.Create,
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
        const page = await this.pageRepo.findById(pageId);
        if (!page || page.workspaceId !== workspaceId) {
          return {
            content: [{ type: 'text', text: 'Page not found' }],
            isError: true,
          };
        }
        await this.assertSpacePageAccess(
          user,
          page.spaceId,
          SpaceCaslAction.Read,
        );
        await this.assertSpacePageAccess(user, spaceId, SpaceCaslAction.Create);
        const newPage = await this.pageService.duplicatePage(
          page,
          spaceId,
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
        const page = await this.pageRepo.findById(pageId);
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
        if (parentPageId) {
          const parentPage = await this.pageRepo.findById(parentPageId);
          if (
            !parentPage ||
            parentPage.workspaceId !== workspaceId ||
            parentPage.spaceId !== page.spaceId
          ) {
            return {
              content: [{ type: 'text', text: 'Parent page not found' }],
              isError: true,
            };
          }
          await this.assertSpacePageAccess(
            user,
            parentPage.spaceId,
            SpaceCaslAction.Create,
          );
        }
        await this.pageService.movePage(
          {
            pageId,
            position: page.position ?? 'a0',
            parentPageId: parentPageId ?? null,
          },
          page,
        );
        return {
          content: [
            { type: 'text', text: `Page ${pageId} moved successfully` },
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
        const page = await this.pageRepo.findById(pageId);
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
        await this.assertSpacePageAccess(user, spaceId, SpaceCaslAction.Create);
        await this.pageService.movePageToSpace(page, spaceId, userId);
        return {
          content: [
            { type: 'text', text: `Page ${pageId} moved to space ${spaceId}` },
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
        await this.assertSpacePageAccess(user, spaceId, SpaceCaslAction.Read);
        const space = await this.spaceService.getSpaceInfo(
          spaceId,
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
        const ability = this.workspaceAbility.createForUser(user, workspace);
        if (
          ability.cannot(WorkspaceCaslAction.Manage, WorkspaceCaslSubject.Space)
        ) {
          throw new ForbiddenException('Forbidden: cannot create spaces');
        }
        const space = await this.spaceService.createSpace(user, workspaceId, {
          name,
          slug,
          description,
        });
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
        await this.assertSpaceSettingsManage(user, spaceId);
        const space = await this.spaceService.updateSpace(
          { spaceId, name, description } as any,
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
        const page = await this.pageRepo.findById(pageId);
        if (!page || page.workspaceId !== workspaceId) {
          return {
            content: [{ type: 'text', text: 'Page not found' }],
            isError: true,
          };
        }
        await this.assertSpacePageAccess(
          user,
          page.spaceId,
          SpaceCaslAction.Read,
        );
        const comments = await this.commentService.findByPageId(
          pageId,
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
        const page = await this.pageRepo.findById(pageId);
        if (!page || page.workspaceId !== workspaceId) {
          return {
            content: [{ type: 'text', text: 'Page not found' }],
            isError: true,
          };
        }
        await this.assertSpacePageAccess(
          user,
          page.spaceId,
          SpaceCaslAction.Read,
        );
        const comment = await this.commentService.create(
          { page, workspaceId, user },
          { pageId, content, type: 'page' } as any,
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
        const existingComment = await this.commentService.findById(
          commentId,
          workspaceId,
        );
        if (!existingComment) {
          throw new NotFoundException('Comment not found');
        }
        if (existingComment.creatorId !== userId) {
          throw new ForbiddenException('You can only edit your own comments');
        }
        const updated = await this.commentService.update(
          existingComment,
          { commentId, content } as any,
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
        if (query.length < 1) {
          return { content: [{ type: 'text', text: '[]' }] };
        }
        const searchQuery = tsquery(query.trim() + '*');
        const userSpaceIds = this.spaceMemberRepo.getUserSpaceIdsQuery(userId);

        const items = await this.db
          .selectFrom('attachments as a')
          .innerJoin('pages as p', 'p.id', 'a.pageId')
          .innerJoin('spaces as s', 's.id', 'a.spaceId')
          .select([
            'a.id',
            'a.fileName',
            'a.pageId',
            'a.creatorId',
            'a.createdAt',
            sql<number>`ts_rank(a.tsv, to_tsquery('english', f_unaccent(${searchQuery})))`.as(
              'rank',
            ),
            sql<string>`ts_headline('english', a.text_content, to_tsquery('english', f_unaccent(${searchQuery})), 'MinWords=9,MaxWords=10,MaxFragments=3')`.as(
              'highlight',
            ),
            's.name as spaceName',
            'p.title as pageTitle',
            'p.slugId as pageSlugId',
          ])
          .where(
            'a.tsv',
            '@@',
            sql<string>`to_tsquery('english', f_unaccent(${searchQuery}))`,
          )
          .where('a.workspaceId', '=', workspaceId)
          .where('a.spaceId', 'in', userSpaceIds)
          .where('a.deletedAt', 'is', null)
          .orderBy('rank', 'desc')
          .limit(limit ?? 25)
          .execute();

        return { content: [{ type: 'text', text: JSON.stringify(items) }] };
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
          ability.cannot(WorkspaceCaslAction.Read, WorkspaceCaslSubject.Member)
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
