import { Injectable } from '@nestjs/common';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { User, Workspace } from '@docmost/db/types/entity.types';
import { McpToolExecutorService } from './mcp-tool-executor.service';
import { McpPageToolProvider } from './tools/page.tools';
import { McpCommentToolProvider } from './tools/comment.tools';
import { McpSpaceToolProvider } from './tools/space.tools';
import { McpSearchToolProvider } from './tools/search.tools';
import { McpMemberToolProvider } from './tools/member.tools';
import type {
  McpRequestContext,
  McpToolDescriptor,
  McpToolProvider,
  McpToolRegistrar,
} from './mcp.types';

@Injectable()
export class McpToolRegistryService implements McpToolRegistrar {
  private readonly providers: McpToolProvider[];

  constructor(
    private readonly executor: McpToolExecutorService,
    pageTools: McpPageToolProvider,
    commentTools: McpCommentToolProvider,
    spaceTools: McpSpaceToolProvider,
    searchTools: McpSearchToolProvider,
    memberTools: McpMemberToolProvider,
  ) {
    this.providers = [
      searchTools,
      pageTools,
      spaceTools,
      commentTools,
      memberTools,
    ];
  }

  getTools(): McpToolDescriptor<any>[] {
    const tools = this.providers
      .flatMap((provider) => provider.getTools())
      .sort(
        (left, right) =>
          MCP_TOOL_ORDER.indexOf(left.name as any) -
          MCP_TOOL_ORDER.indexOf(right.name as any),
      );
    const names = new Set<string>();
    for (const tool of tools) {
      if (names.has(tool.name)) {
        throw new Error(`Duplicate MCP tool registration: ${tool.name}`);
      }
      if (!tool.input) {
        throw new Error(`MCP tool ${tool.name} must declare a DTO or noDto`);
      }
      if (!tool.resource) {
        throw new Error(`MCP tool ${tool.name} must declare a resource policy`);
      }
      if (
        tool.resource.kind === 'scoped_collection' &&
        !MCP_SCOPED_COLLECTION_TOOLS.has(tool.name)
      ) {
        throw new Error(
          `MCP scoped collection policy is not reviewed: ${tool.name}`,
        );
      }
      names.add(tool.name);
    }
    const unlisted = tools.find(
      (tool) => !MCP_TOOL_ORDER.includes(tool.name as any),
    );
    if (unlisted) {
      throw new Error(`MCP tool order is not declared: ${unlisted.name}`);
    }
    return tools;
  }

  registerTools(
    server: McpServer,
    user: User,
    workspace: Workspace,
    context: McpRequestContext,
  ): void {
    const invocation = { user, workspace, context };
    for (const descriptor of this.getTools()) {
      this.executor.register(server, invocation, descriptor);
    }
  }
}

const MCP_SCOPED_COLLECTION_TOOLS = new Set([
  'search_pages',
  'search_attachments',
  'list_spaces',
]);

export const MCP_LEGACY_TOOL_ORDER = [
  'search_pages',
  'get_page',
  'create_page',
  'update_page',
  'list_pages',
  'list_child_pages',
  'duplicate_page',
  'copy_page_to_space',
  'move_page',
  'move_page_to_space',
  'get_space',
  'list_spaces',
  'create_space',
  'update_space',
  'get_comments',
  'create_comment',
  'update_comment',
  'search_attachments',
  'list_workspace_members',
  'get_current_user',
] as const;

export const MCP_TOOL_ORDER = [
  ...MCP_LEGACY_TOOL_ORDER,
  'trash_page',
  'restore_page',
] as const;
