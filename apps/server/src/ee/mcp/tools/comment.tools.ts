import {
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { z } from 'zod';
import { CommentService } from '../../../core/comment/comment.service';
import { PageIdDto } from '../../../core/page/dto/page.dto';
import { CreateCommentDto } from '../../../core/comment/dto/create-comment.dto';
import { UpdateCommentDto } from '../../../core/comment/dto/update-comment.dto';
import { McpToolAccessService } from '../mcp-tool-access.service';
import {
  defineMcpTool,
  type McpToolDescriptor,
  type McpToolProvider,
} from '../mcp.types';

@Injectable()
export class McpCommentToolProvider implements McpToolProvider {
  constructor(
    private readonly commentService: CommentService,
    private readonly access: McpToolAccessService,
  ) {}

  getTools(): McpToolDescriptor<any>[] {
    return [
      defineMcpTool({
        name: 'get_comments',
        description: 'Get comments on a page',
        inputSchema: { pageId: z.string(), limit: z.number().optional() },
        access: 'read',
        input: { dto: PageIdDto, mapArgs: ({ pageId }) => ({ pageId }) },
        handler: async ({ user, workspace }, input, { limit }) => {
          const page = await this.access.findActiveWorkspacePage(
            input.pageId,
            workspace.id,
          );
          if (!page) return pageNotFound();
          await this.access.validateCanView(page, user);
          const comments = await this.commentService.findByPageId(
            input.pageId,
            this.access.paginate(limit),
          );
          return textResult(comments);
        },
      }),
      defineMcpTool({
        name: 'create_comment',
        description:
          'Create a comment on a page (page-level comment). Content must be a JSON string of ProseMirror document.',
        inputSchema: {
          pageId: z.string(),
          content: z.string().describe('JSON ProseMirror content string'),
        },
        access: 'write',
        input: {
          dto: CreateCommentDto,
          mapArgs: ({ pageId, content }) => ({
            pageId,
            content,
            type: 'page',
          }),
        },
        handler: async ({ user, workspace }, input) => {
          const page = await this.access.findActiveWorkspacePage(
            input.pageId,
            workspace.id,
          );
          if (!page) return pageNotFound();
          await this.access.validateCanComment(page, user, workspace.id);
          const comment = await this.commentService.create(
            { page, workspaceId: workspace.id, user },
            input,
          );
          return textResult({ id: comment.id });
        },
      }),
      defineMcpTool({
        name: 'update_comment',
        description:
          'Update an existing comment. Content must be a JSON string of ProseMirror document.',
        inputSchema: {
          commentId: z.string(),
          content: z.string().describe('JSON ProseMirror content string'),
        },
        access: 'write',
        input: { dto: UpdateCommentDto },
        handler: async ({ user, workspace }, input) => {
          const comment = await this.commentService.findById(
            input.commentId,
            workspace.id,
          );
          if (!comment) throw new NotFoundException('Comment not found');
          if (comment.creatorId !== user.id) {
            throw new ForbiddenException('You can only edit your own comments');
          }
          const page = await this.access.findActiveWorkspacePage(
            comment.pageId,
            workspace.id,
          );
          if (!page) throw new NotFoundException('Page not found');
          await this.access.validateCanComment(page, user, workspace.id);
          const updated = await this.commentService.update(
            comment,
            input,
            user,
          );
          return textResult({ id: updated.id });
        },
      }),
    ];
  }
}

function pageNotFound() {
  return { content: [{ type: 'text', text: 'Page not found' }], isError: true };
}

function textResult(value: unknown) {
  return { content: [{ type: 'text', text: JSON.stringify(value) }] };
}
