import { Injectable, Logger, OnModuleDestroy, ForbiddenException, NotFoundException } from '@nestjs/common';
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

// eslint-disable-next-line @typescript-eslint/no-require-imports
const tsquery = require('pg-tsquery')();

const MAX_LIMIT = 200;

interface McpSession {
  transport: StreamableHTTPServerTransport;
  server: McpServer;
  userId: string;
  workspaceId: string;
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
  ): Promise<void> {
    const sessionId = req.headers['mcp-session-id'] as string | undefined;

    if (sessionId && this.sessions.has(sessionId)) {
      const session = this.sessions.get(sessionId);
      // Prevent session hijacking: the caller's JWT must match the user/workspace
      // that created this session. Otherwise anyone with the sessionId + any valid
      // API key could execute tools as the original user.
      if (session.userId !== user.id || session.workspaceId !== workspace.id) {
        res
          .writeHead(403, { 'Content-Type': 'application/json' })
          .end(JSON.stringify({ error: 'Session does not belong to this user' }));
        return;
      }
      await session.transport.handleRequest(req, res, body);
      return;
    }

    if (sessionId && !this.sessions.has(sessionId)) {
      res.writeHead(404).end(JSON.stringify({ error: 'Session not found' }));
      return;
    }

    // New session (initialization)
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: () => randomUUID(),
    });

    const server = this.createMcpServer(user, workspace);
    await server.connect(transport);

    const sid = transport.sessionId;
    if (sid) {
      this.sessions.set(sid, {
        transport,
        server,
        userId: user.id,
        workspaceId: workspace.id,
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
  ): Promise<void> {
    const sessionId = req.headers['mcp-session-id'] as string | undefined;
    if (sessionId && this.sessions.has(sessionId)) {
      const session = this.sessions.get(sessionId);
      if (user && workspace && (session.userId !== user.id || session.workspaceId !== workspace.id)) {
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
      throw new ForbiddenException('Forbidden: space settings management required');
    }
  }

  private createMcpServer(user: User, workspace: Workspace): McpServer {
    const server = new McpServer(
      {
        name: 'Docmost',
        version: '0.80.0',
      },
      {
        capabilities: {
          tools: {},
        },
      },
    );

    this.registerTools(server, user, workspace);

    return server;
  }

  private registerTools(
    server: McpServer,
    user: User,
    workspace: Workspace,
  ): void {
    const userId = user.id;
    const workspaceId = workspace.id;

    // 1. search_pages
    server.tool(
      'search_pages',
      'Search pages by query text',
      { query: z.string(), spaceId: z.string().optional(), limit: z.number().optional() },
      async ({ query, spaceId, limit }) => {
        const result = await this.searchService.searchPage(
          { query, spaceId, limit: limit ?? 25, offset: 0 },
          { userId, workspaceId },
        );
        return { content: [{ type: 'text', text: JSON.stringify(result.items) }] };
      },
    );

    // 2. get_page
    server.tool(
      'get_page',
      'Get a page by ID. Returns content in the specified format (json, markdown, or html)',
      { pageId: z.string(), format: z.enum(['json', 'markdown', 'html']).optional() },
      async ({ pageId, format }) => {
        const page = await this.pageRepo.findById(pageId, {
          includeContent: true,
          includeSpace: true,
        });
        if (!page || page.workspaceId !== workspaceId) {
          return { content: [{ type: 'text', text: 'Page not found' }], isError: true };
        }
        await this.assertSpacePageAccess(user, page.spaceId, SpaceCaslAction.Read);
        let content = page.content;
        if (format && format !== 'json' && content) {
          content = format === 'markdown' ? jsonToMarkdown(content) : jsonToHtml(content);
        }
        return {
          content: [{
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
          }],
        };
      },
    );

    // 3. create_page
    server.tool(
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
        await this.assertSpacePageAccess(user, spaceId, SpaceCaslAction.Create);
        const page = await this.pageService.create(userId, workspaceId, {
          spaceId,
          title,
          content,
          format: format ?? 'markdown',
          parentPageId,
        });
        return { content: [{ type: 'text', text: JSON.stringify({ id: page.id, slugId: page.slugId, title: page.title }) }] };
      },
    );

    // 4. update_page
    server.tool(
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
          return { content: [{ type: 'text', text: 'Page not found' }], isError: true };
        }
        await this.assertSpacePageAccess(user, page.spaceId, SpaceCaslAction.Edit);
        const updated = await this.pageService.update(
          page,
          { pageId, title, content, format: format ?? 'markdown', operation: operation ?? 'replace' },
          user,
        );
        return { content: [{ type: 'text', text: JSON.stringify({ id: updated.id, title: updated.title }) }] };
      },
    );

    // 5. list_pages
    server.tool(
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
        return { content: [{ type: 'text', text: JSON.stringify(result.items) }] };
      },
    );

    // 6. list_child_pages
    server.tool(
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
        return { content: [{ type: 'text', text: JSON.stringify(result.items) }] };
      },
    );

    // 7. duplicate_page
    server.tool(
      'duplicate_page',
      'Duplicate a page within the same space',
      { pageId: z.string() },
      async ({ pageId }) => {
        const page = await this.pageRepo.findById(pageId);
        if (!page || page.workspaceId !== workspaceId) {
          return { content: [{ type: 'text', text: 'Page not found' }], isError: true };
        }
        await this.assertSpacePageAccess(user, page.spaceId, SpaceCaslAction.Create);
        const newPage = await this.pageService.duplicatePage(page, undefined, user);
        return { content: [{ type: 'text', text: JSON.stringify({ id: newPage.id, title: newPage.title }) }] };
      },
    );

    // 8. copy_page_to_space
    server.tool(
      'copy_page_to_space',
      'Copy a page to a different space',
      { pageId: z.string(), spaceId: z.string() },
      async ({ pageId, spaceId }) => {
        const page = await this.pageRepo.findById(pageId);
        if (!page || page.workspaceId !== workspaceId) {
          return { content: [{ type: 'text', text: 'Page not found' }], isError: true };
        }
        await this.assertSpacePageAccess(user, page.spaceId, SpaceCaslAction.Read);
        await this.assertSpacePageAccess(user, spaceId, SpaceCaslAction.Create);
        const newPage = await this.pageService.duplicatePage(page, spaceId, user);
        return { content: [{ type: 'text', text: JSON.stringify({ id: newPage.id, title: newPage.title }) }] };
      },
    );

    // 9. move_page
    server.tool(
      'move_page',
      'Move a page under a new parent within the same space',
      { pageId: z.string(), parentPageId: z.string().optional() },
      async ({ pageId, parentPageId }) => {
        const page = await this.pageRepo.findById(pageId);
        if (!page || page.workspaceId !== workspaceId) {
          return { content: [{ type: 'text', text: 'Page not found' }], isError: true };
        }
        await this.assertSpacePageAccess(user, page.spaceId, SpaceCaslAction.Edit);
        await this.pageService.movePage(
          { pageId, position: page.position ?? 'a0', parentPageId: parentPageId ?? null },
          page,
        );
        return { content: [{ type: 'text', text: `Page ${pageId} moved successfully` }] };
      },
    );

    // 10. move_page_to_space
    server.tool(
      'move_page_to_space',
      'Move a page to a different space',
      { pageId: z.string(), spaceId: z.string() },
      async ({ pageId, spaceId }) => {
        const page = await this.pageRepo.findById(pageId);
        if (!page || page.workspaceId !== workspaceId) {
          return { content: [{ type: 'text', text: 'Page not found' }], isError: true };
        }
        await this.assertSpacePageAccess(user, page.spaceId, SpaceCaslAction.Edit);
        await this.assertSpacePageAccess(user, spaceId, SpaceCaslAction.Create);
        await this.pageService.movePageToSpace(page, spaceId, userId);
        return { content: [{ type: 'text', text: `Page ${pageId} moved to space ${spaceId}` }] };
      },
    );

    // 11. get_space
    server.tool(
      'get_space',
      'Get space information by ID',
      { spaceId: z.string() },
      async ({ spaceId }) => {
        await this.assertSpacePageAccess(user, spaceId, SpaceCaslAction.Read);
        const space = await this.spaceService.getSpaceInfo(spaceId, workspaceId);
        return { content: [{ type: 'text', text: JSON.stringify(space) }] };
      },
    );

    // 12. list_spaces
    server.tool(
      'list_spaces',
      'List all spaces the user has access to',
      {},
      async () => {
        const result = await this.spaceMemberService.getUserSpaces(userId, this.paginate(100));
        return { content: [{ type: 'text', text: JSON.stringify(result) }] };
      },
    );

    // 13. create_space
    server.tool(
      'create_space',
      'Create a new space',
      {
        name: z.string(),
        slug: z.string(),
        description: z.string().optional(),
      },
      async ({ name, slug, description }) => {
        const ability = this.workspaceAbility.createForUser(user, workspace);
        if (ability.cannot(WorkspaceCaslAction.Manage, WorkspaceCaslSubject.Space)) {
          throw new ForbiddenException('Forbidden: cannot create spaces');
        }
        const space = await this.spaceService.createSpace(user, workspaceId, {
          name,
          slug,
          description,
        });
        return { content: [{ type: 'text', text: JSON.stringify({ id: space.id, name: space.name, slug: space.slug }) }] };
      },
    );

    // 14. update_space
    server.tool(
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
    server.tool(
      'get_comments',
      'Get comments on a page',
      { pageId: z.string(), limit: z.number().optional() },
      async ({ pageId, limit }) => {
        const page = await this.pageRepo.findById(pageId);
        if (!page || page.workspaceId !== workspaceId) {
          return { content: [{ type: 'text', text: 'Page not found' }], isError: true };
        }
        await this.assertSpacePageAccess(user, page.spaceId, SpaceCaslAction.Read);
        const comments = await this.commentService.findByPageId(
          pageId,
          this.paginate(limit),
        );
        return { content: [{ type: 'text', text: JSON.stringify(comments) }] };
      },
    );

    // 16. create_comment
    server.tool(
      'create_comment',
      'Create a comment on a page (page-level comment). Content must be a JSON string of ProseMirror document.',
      { pageId: z.string(), content: z.string().describe('JSON ProseMirror content string') },
      async ({ pageId, content }) => {
        const page = await this.pageRepo.findById(pageId);
        if (!page || page.workspaceId !== workspaceId) {
          return { content: [{ type: 'text', text: 'Page not found' }], isError: true };
        }
        await this.assertSpacePageAccess(user, page.spaceId, SpaceCaslAction.Read);
        const comment = await this.commentService.create(
          { page, workspaceId, user },
          { pageId, content, type: 'page' } as any,
        );
        return { content: [{ type: 'text', text: JSON.stringify({ id: comment.id }) }] };
      },
    );

    // 17. update_comment
    server.tool(
      'update_comment',
      'Update an existing comment. Content must be a JSON string of ProseMirror document.',
      { commentId: z.string(), content: z.string().describe('JSON ProseMirror content string') },
      async ({ commentId, content }) => {
        const existingComment = await this.commentService.findById(commentId, workspaceId);
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
        return { content: [{ type: 'text', text: JSON.stringify({ id: updated.id }) }] };
      },
    );

    // 18. search_attachments
    server.tool(
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
            sql<number>`ts_rank(a.tsv, to_tsquery('english', f_unaccent(${searchQuery})))`.as('rank'),
            sql<string>`ts_headline('english', a.text_content, to_tsquery('english', f_unaccent(${searchQuery})), 'MinWords=9,MaxWords=10,MaxFragments=3')`.as('highlight'),
            's.name as spaceName',
            'p.title as pageTitle',
            'p.slugId as pageSlugId',
          ])
          .where('a.tsv', '@@', sql<string>`to_tsquery('english', f_unaccent(${searchQuery}))`)
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
    server.tool(
      'list_workspace_members',
      'List workspace members',
      { limit: z.number().optional() },
      async ({ limit }) => {
        const ability = this.workspaceAbility.createForUser(user, workspace);
        if (ability.cannot(WorkspaceCaslAction.Read, WorkspaceCaslSubject.Member)) {
          throw new ForbiddenException('Forbidden: cannot list workspace members');
        }
        const result = await this.workspaceService.getWorkspaceUsers(
          workspaceId,
          this.paginate(limit),
        );
        return { content: [{ type: 'text', text: JSON.stringify(result) }] };
      },
    );

    // 20. get_current_user
    server.tool(
      'get_current_user',
      'Get information about the currently authenticated user',
      {},
      async () => {
        const u = await this.userRepo.findById(userId, workspaceId);
        return {
          content: [{
            type: 'text',
            text: JSON.stringify({
              id: u.id,
              name: u.name,
              email: u.email,
              role: u.role,
              avatarUrl: u.avatarUrl,
            }),
          }],
        };
      },
    );
  }
}
