import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { User, Workspace } from '@docmost/db/types/entity.types';

export type McpMode = 'off' | 'read-only' | 'read-write';
export type McpToolAccess = 'read' | 'write' | 'destructive';

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

export interface McpToolInvocation {
  user: User;
  workspace: Workspace;
  context: McpRequestContext;
}

export type McpDtoClass<T extends object = Record<string, any>> = new () => T;

export type McpToolInputPolicy<T extends object = Record<string, any>> =
  | {
      dto: McpDtoClass<T>;
      mapArgs?: (args: any) => Record<string, unknown>;
      noDto?: never;
    }
  | {
      noDto: true;
      dto?: never;
      mapArgs?: never;
    };

export interface McpToolDescriptor<T extends object = any> {
  name: string;
  description: string;
  inputSchema: Record<string, any>;
  access: McpToolAccess;
  input: McpToolInputPolicy<T>;
  handler: (
    invocation: McpToolInvocation,
    input: T,
    rawArgs: Record<string, any>,
  ) => Promise<any>;
}

export interface McpToolProvider {
  getTools(): McpToolDescriptor<any>[];
}

export function defineMcpTool<T extends object>(
  descriptor: McpToolDescriptor<T>,
): McpToolDescriptor<T> {
  return descriptor;
}

export interface McpToolRegistrar {
  registerTools(
    server: McpServer,
    user: User,
    workspace: Workspace,
    context: McpRequestContext,
  ): void;
}
