import { Injectable } from '@nestjs/common';
import { z } from 'zod';
import { SearchService } from '../../../core/search/search.service';
import { SearchAttachmentsService } from '../../../core/search/search-attachments.service';
import { SearchDTO } from '../../../core/search/dto/search.dto';
import { SpaceCaslAction } from '../../../core/casl/interfaces/space-ability.type';
import { McpToolAccessService } from '../mcp-tool-access.service';
import {
  defineMcpTool,
  type McpToolDescriptor,
  type McpToolProvider,
} from '../mcp.types';

@Injectable()
export class McpSearchToolProvider implements McpToolProvider {
  constructor(
    private readonly searchService: SearchService,
    private readonly searchAttachmentsService: SearchAttachmentsService,
    private readonly access: McpToolAccessService,
  ) {}

  getTools(): McpToolDescriptor<any>[] {
    return [
      defineMcpTool({
        name: 'search_pages',
        description: 'Search pages by query text',
        inputSchema: {
          query: z.string(),
          spaceId: z.string().optional(),
          limit: z.number().optional(),
        },
        access: 'read',
        input: {
          dto: SearchDTO,
          mapArgs: ({ query, spaceId, limit }) => ({
            query,
            spaceId,
            limit: this.access.paginate(limit).limit,
            offset: 0,
          }),
        },
        handler: async ({ user, workspace }, input) => {
          delete input.shareId;
          if (input.spaceId) {
            await this.access.assertSpacePageAccess(
              user,
              input.spaceId,
              SpaceCaslAction.Read,
            );
          }
          const result = await this.searchService.searchPage(input, {
            userId: user.id,
            workspaceId: workspace.id,
          });
          return textResult(result.items);
        },
      }),
      defineMcpTool({
        name: 'search_attachments',
        description: 'Search attachments (PDF, DOCX) by text content',
        inputSchema: { query: z.string(), limit: z.number().optional() },
        access: 'read',
        input: {
          dto: SearchDTO,
          mapArgs: ({ query, limit }) => ({
            query,
            limit: this.access.paginate(limit).limit,
            offset: 0,
          }),
        },
        handler: async ({ user, workspace }, input) => {
          const result = await this.searchAttachmentsService.searchAttachments(
            input,
            user.id,
            workspace.id,
          );
          return textResult(result.items);
        },
      }),
    ];
  }
}

function textResult(value: unknown) {
  return { content: [{ type: 'text', text: JSON.stringify(value) }] };
}
