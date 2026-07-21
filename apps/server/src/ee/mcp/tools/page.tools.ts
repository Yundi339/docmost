import { Injectable } from '@nestjs/common';
import { z } from 'zod';
import {
  jsonToHtml,
  jsonToMarkdown,
} from '../../../collaboration/collaboration.util';
import { PageService } from '../../../core/page/services/page.service';
import { PageLifecycleService } from '../../../core/page/services/page-lifecycle.service';
import { CreatePageDto } from '../../../core/page/dto/create-page.dto';
import { UpdatePageDto } from '../../../core/page/dto/update-page.dto';
import { PageInfoDto } from '../../../core/page/dto/page.dto';
import { SidebarPageDto } from '../../../core/page/dto/sidebar-page.dto';
import { DuplicatePageDto } from '../../../core/page/dto/duplicate-page.dto';
import {
  MovePageToSpaceDto,
  MovePageUnderDto,
} from '../../../core/page/dto/move-page.dto';
import { SpaceCaslAction } from '../../../core/casl/interfaces/space-ability.type';
import { McpToolAccessService } from '../mcp-tool-access.service';
import {
  defineMcpTool,
  type McpToolDescriptor,
  type McpToolProvider,
} from '../mcp.types';
import { TrashPageToolDto } from '../dto/page-maintenance.dto';
import { PageIdDto } from '../../../core/page/dto/page.dto';

@Injectable()
export class McpPageToolProvider implements McpToolProvider {
  constructor(
    private readonly pageService: PageService,
    private readonly pageLifecycleService: PageLifecycleService,
    private readonly access: McpToolAccessService,
  ) {}

  getTools(): McpToolDescriptor<any>[] {
    return [
      defineMcpTool({
        name: 'get_page',
        description:
          'Get a page by ID. Returns content in the specified format (json, markdown, or html)',
        inputSchema: {
          pageId: z.string(),
          format: z.enum(['json', 'markdown', 'html']).optional(),
        },
        access: 'read',
        resource: { kind: 'resource_args', pageIds: ['pageId'] },
        input: { dto: PageInfoDto },
        handler: async ({ user, workspace, context }, input) => {
          const page = await this.access.findActiveWorkspacePage(
            input.pageId,
            workspace.id,
            { includeContent: true, includeSpace: true },
            context,
          );
          if (!page) return pageNotFound();
          await this.access.validateCanView(page, user, context);
          let content = page.content;
          if (input.format && input.format !== 'json' && content) {
            content =
              input.format === 'markdown'
                ? jsonToMarkdown(content)
                : jsonToHtml(content);
          }
          return textResult({
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
          });
        },
      }),
      defineMcpTool({
        name: 'create_page',
        description:
          'Create a new page in a space. Content can be markdown, html, or json format',
        inputSchema: {
          spaceId: z.string(),
          title: z.string().optional(),
          content: z.string().optional(),
          format: z.enum(['json', 'markdown', 'html']).optional(),
          parentPageId: z.string().optional(),
        },
        access: 'write',
        resource: {
          kind: 'resource_args',
          spaceIds: ['spaceId'],
          pageIds: ['parentPageId'],
        },
        input: { dto: CreatePageDto },
        handler: async ({ user, workspace, context }, input) => {
          if (input.parentPageId) {
            const parent = await this.access.findActiveWorkspacePage(
              input.parentPageId,
              workspace.id,
              undefined,
              context,
            );
            if (!parent || parent.spaceId !== input.spaceId) {
              return pageNotFound('Parent page not found');
            }
            await this.access.validateCanEdit(parent, user, context);
          } else {
            await this.access.assertSpacePageAccess(
              user,
              input.spaceId,
              SpaceCaslAction.Create,
              context,
            );
          }
          const page = await this.pageService.create(user.id, workspace.id, {
            spaceId: input.spaceId,
            title: input.title,
            content: input.content,
            format: input.format ?? 'markdown',
            parentPageId: input.parentPageId,
          });
          return textResult({
            id: page.id,
            slugId: page.slugId,
            title: page.title,
          });
        },
      }),
      defineMcpTool({
        name: 'update_page',
        description:
          'Update an existing page. Supports append, prepend, or replace operations',
        inputSchema: {
          pageId: z.string(),
          title: z.string().optional(),
          content: z.string().optional(),
          format: z.enum(['json', 'markdown', 'html']).optional(),
          operation: z.enum(['append', 'prepend', 'replace']).optional(),
        },
        access: 'write',
        resource: { kind: 'resource_args', pageIds: ['pageId'] },
        input: { dto: UpdatePageDto },
        handler: async ({ user, workspace, context }, input) => {
          const page = await this.access.findActiveWorkspacePage(
            input.pageId,
            workspace.id,
            undefined,
            context,
          );
          if (!page) return pageNotFound();
          await this.access.validateCanEdit(page, user, context);
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
          return textResult({ id: updated.id, title: updated.title });
        },
      }),
      defineMcpTool({
        name: 'list_pages',
        description: 'List root-level pages in a space',
        inputSchema: { spaceId: z.string(), limit: z.number().optional() },
        access: 'read',
        resource: { kind: 'resource_args', spaceIds: ['spaceId'] },
        input: {
          dto: SidebarPageDto,
          mapArgs: ({ spaceId }) => ({ spaceId }),
        },
        handler: async ({ user, context }, input, { limit }) => {
          const canEdit = await this.access.getSpacePageEditAccess(
            user,
            input.spaceId,
            context,
          );
          const result = await this.pageService.getSidebarPages(
            input.spaceId,
            this.access.paginate(limit),
            undefined,
            user.id,
            canEdit,
          );
          return textResult(result.items);
        },
      }),
      defineMcpTool({
        name: 'list_child_pages',
        description: 'List child pages of a specific page',
        inputSchema: {
          spaceId: z.string(),
          pageId: z.string(),
          limit: z.number().optional(),
        },
        access: 'read',
        resource: {
          kind: 'resource_args',
          spaceIds: ['spaceId'],
          pageIds: ['pageId'],
        },
        input: { dto: SidebarPageDto },
        handler: async ({ user, workspace, context }, input, { limit }) => {
          const page = await this.access.findActiveWorkspacePage(
            input.pageId,
            workspace.id,
            undefined,
            context,
          );
          if (!page || page.spaceId !== input.spaceId) return pageNotFound();
          await this.access.validateCanView(page, user, context);
          const canEdit = await this.access.getSpacePageEditAccess(
            user,
            input.spaceId,
            context,
          );
          const result = await this.pageService.getSidebarPages(
            input.spaceId,
            this.access.paginate(limit),
            input.pageId,
            user.id,
            canEdit,
          );
          return textResult(result.items);
        },
      }),
      defineMcpTool({
        name: 'duplicate_page',
        description: 'Duplicate a page within the same space',
        inputSchema: { pageId: z.string() },
        access: 'write',
        resource: { kind: 'resource_args', pageIds: ['pageId'] },
        input: {
          dto: DuplicatePageDto,
          mapArgs: ({ pageId }) => ({ pageId }),
        },
        handler: async ({ user, workspace, context }, input) => {
          const page = await this.access.findActiveWorkspacePage(
            input.pageId,
            workspace.id,
            undefined,
            context,
          );
          if (!page) return pageNotFound();
          await this.access.validateCanEdit(page, user, context);
          await this.access.assertSpacePageAccess(
            user,
            page.spaceId,
            SpaceCaslAction.Create,
            context,
          );
          const copy = await this.pageService.duplicatePage(
            page,
            undefined,
            user,
          );
          return textResult({ id: copy.id, title: copy.title });
        },
      }),
      defineMcpTool({
        name: 'copy_page_to_space',
        description: 'Copy a page to a different space',
        inputSchema: { pageId: z.string(), spaceId: z.string() },
        access: 'write',
        resource: {
          kind: 'resource_args',
          spaceIds: ['spaceId'],
          pageIds: ['pageId'],
        },
        input: { dto: DuplicatePageDto },
        handler: async ({ user, workspace, context }, input) => {
          const page = await this.access.findActiveWorkspacePage(
            input.pageId,
            workspace.id,
            undefined,
            context,
          );
          if (!page) return pageNotFound();
          await this.access.validateCanEdit(page, user, context);
          await this.access.assertSpacePageAccess(
            user,
            input.spaceId,
            SpaceCaslAction.Create,
            context,
          );
          const copy = await this.pageService.duplicatePage(
            page,
            input.spaceId,
            user,
          );
          return textResult({ id: copy.id, title: copy.title });
        },
      }),
      defineMcpTool({
        name: 'move_page',
        description: 'Move a page under a new parent within the same space',
        inputSchema: {
          pageId: z.string(),
          parentPageId: z.string().optional(),
        },
        access: 'write',
        resource: {
          kind: 'resource_args',
          pageIds: ['pageId', 'parentPageId'],
        },
        input: {
          dto: MovePageUnderDto,
          mapArgs: ({ pageId, parentPageId }) => ({
            pageId,
            targetPageId: parentPageId,
          }),
        },
        handler: async ({ user, workspace, context }, input) => {
          const page = await this.access.findActiveWorkspacePage(
            input.pageId,
            workspace.id,
            undefined,
            context,
          );
          if (!page) return pageNotFound();
          await this.access.assertSpacePageAccess(
            user,
            page.spaceId,
            SpaceCaslAction.Edit,
            context,
          );
          await this.access.validateCanEdit(page, user, context);
          if (input.targetPageId) {
            const parent = await this.access.findActiveWorkspacePage(
              input.targetPageId,
              workspace.id,
              undefined,
              context,
            );
            if (!parent || parent.spaceId !== page.spaceId) {
              return pageNotFound('Parent page not found');
            }
            await this.access.validateCanEdit(parent, user, context);
          }
          await this.pageService.movePageToParent(
            page,
            input.targetPageId ?? null,
            user.id,
          );
          return textResult(`Page ${input.pageId} moved successfully`, false);
        },
      }),
      defineMcpTool({
        name: 'move_page_to_space',
        description: 'Move a page to a different space',
        inputSchema: { pageId: z.string(), spaceId: z.string() },
        access: 'write',
        resource: {
          kind: 'resource_args',
          spaceIds: ['spaceId'],
          pageIds: ['pageId'],
        },
        input: { dto: MovePageToSpaceDto },
        handler: async ({ user, workspace, context }, input) => {
          const page = await this.access.findActiveWorkspacePage(
            input.pageId,
            workspace.id,
            undefined,
            context,
          );
          if (!page) return pageNotFound();
          await this.access.assertSpacePageAccess(
            user,
            page.spaceId,
            SpaceCaslAction.Edit,
            context,
          );
          await this.access.validateCanEdit(page, user, context);
          await this.access.assertSpacePageAccess(
            user,
            input.spaceId,
            SpaceCaslAction.Edit,
            context,
          );
          await this.pageService.movePageToSpace(page, input.spaceId, user.id);
          return textResult(
            `Page ${input.pageId} moved to space ${input.spaceId}`,
            false,
          );
        },
      }),
      defineMcpTool({
        name: 'trash_page',
        description:
          'Move a page and its descendants to trash. Requires confirm=true and can be reversed with restore_page.',
        inputSchema: { pageId: z.string(), confirm: z.literal(true) },
        access: 'destructive',
        resource: { kind: 'resource_args', pageIds: ['pageId'] },
        input: { dto: TrashPageToolDto },
        handler: async ({ user, workspace, context }, input) => {
          const page = await this.pageLifecycleService.trashPage(
            input.pageId,
            user,
            workspace,
            context.spaceAccess.effectiveSpaceIds,
          );
          return textResult({
            id: page.id,
            title: page.title,
            spaceId: page.spaceId,
            trashed: true,
          });
        },
      }),
      defineMcpTool({
        name: 'restore_page',
        description:
          'Restore a trashed page and its descendants using existing page permissions.',
        inputSchema: { pageId: z.string() },
        access: 'write',
        resource: { kind: 'resource_args', pageIds: ['pageId'] },
        input: { dto: PageIdDto },
        handler: async ({ user, workspace, context }, input) => {
          const page = await this.pageLifecycleService.restorePage(
            input.pageId,
            user,
            workspace,
            context.spaceAccess.effectiveSpaceIds,
          );
          return textResult({
            id: page.id,
            title: page.title,
            spaceId: page.spaceId,
            restored: true,
          });
        },
      }),
    ];
  }
}

function pageNotFound(message = 'Page not found') {
  return { content: [{ type: 'text', text: message }], isError: true };
}

function textResult(value: unknown, serialize = true) {
  return {
    content: [
      { type: 'text', text: serialize ? JSON.stringify(value) : String(value) },
    ],
  };
}
