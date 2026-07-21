import { ForbiddenException, Inject, Injectable } from '@nestjs/common';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { ApiKeyScope, hasApiKeyScope } from '../../core/api-key/api-key-scopes';
import { validateDto } from '../../common/helpers/validate-dto';
import {
  AUDIT_SERVICE,
  IAuditService,
} from '../../integrations/audit/audit.service';
import { AuditEvent, AuditResource } from '../../common/events/audit-events';
import type {
  McpRequestContext,
  McpToolAccess,
  McpToolDescriptor,
  McpToolInvocation,
  McpToolInputPolicy,
} from './mcp.types';
import { McpToolAccessService } from './mcp-tool-access.service';

@Injectable()
export class McpToolExecutorService {
  constructor(
    @Inject(AUDIT_SERVICE) private readonly auditService: IAuditService,
    private readonly toolAccess: McpToolAccessService,
  ) {}

  register(
    server: McpServer,
    invocation: McpToolInvocation,
    descriptor: McpToolDescriptor,
  ): void {
    server.registerTool(
      descriptor.name,
      toolOptions(
        descriptor.description,
        descriptor.inputSchema,
        descriptor.access,
      ),
      (args: Record<string, any> | undefined) =>
        this.execute(invocation, descriptor, args ?? {}),
    );
  }

  async execute(
    invocation: McpToolInvocation,
    descriptor: McpToolDescriptor,
    args: Record<string, any>,
  ): Promise<any> {
    const { context } = invocation;
    try {
      this.assertToolAccess(context, descriptor.access);
      const input = await this.prepareInput(
        descriptor.name,
        args,
        descriptor.input,
      );
      await this.toolAccess.assertCredentialResourceAccess(
        context,
        invocation.workspace.id,
        descriptor.resource,
        args,
      );
      const result = await descriptor.handler(invocation, input, args);
      this.auditToolCall(
        invocation,
        descriptor,
        args,
        !isMcpToolError(result),
        undefined,
        result,
      );
      return result;
    } catch (error) {
      this.auditToolCall(invocation, descriptor, args, false, error);
      throw error;
    }
  }

  assertToolAccess(context: McpRequestContext, access: McpToolAccess): void {
    if (context.mode === 'off') {
      throw new ForbiddenException('MCP is not enabled for this workspace');
    }
    if (
      !hasApiKeyScope(context.scopes, ApiKeyScope.MCP_READ) &&
      !hasApiKeyScope(context.scopes, ApiKeyScope.MCP_WRITE)
    ) {
      throw new ForbiddenException('Missing API key scope: mcp:read');
    }
    if (access !== 'read') {
      if (context.mode === 'read-only') {
        throw new ForbiddenException('MCP is enabled in read-only mode');
      }
      if (!hasApiKeyScope(context.scopes, ApiKeyScope.MCP_WRITE)) {
        throw new ForbiddenException('Missing API key scope: mcp:write');
      }
    }
    if (
      access === 'destructive' &&
      !hasApiKeyScope(context.scopes, ApiKeyScope.MCP_DESTRUCTIVE)
    ) {
      throw new ForbiddenException('Missing API key scope: mcp:destructive');
    }
  }

  async prepareInput<T extends object>(
    name: string,
    args: Record<string, any> | undefined,
    policy: McpToolInputPolicy<T> | undefined,
  ): Promise<T> {
    if (!policy) {
      throw new Error(`MCP tool ${name} must declare a DTO or noDto`);
    }
    const rawArgs = args ?? {};
    if ('noDto' in policy && policy.noDto) {
      return rawArgs as T;
    }
    if (!('dto' in policy) || !policy.dto) {
      throw new Error(`MCP tool ${name} must declare a DTO or noDto`);
    }
    const input = policy.mapArgs ? policy.mapArgs(rawArgs) : rawArgs;
    return validateDto(policy.dto, input);
  }

  private auditToolCall(
    invocation: McpToolInvocation,
    descriptor: McpToolDescriptor,
    args: Record<string, any>,
    success: boolean,
    error?: unknown,
    result?: unknown,
  ): void {
    const { context, user, workspace } = invocation;
    const resultMetadata = getMcpResultMetadata(result);
    const targetId = getMcpAuditResourceId(
      descriptor.name,
      args,
      resultMetadata,
    );
    this.auditService.logWithContext(
      {
        event: AuditEvent.MCP_TOOL_CALLED,
        resourceType: AuditResource.MCP_TOOL,
        resourceId: isUuid(targetId) ? targetId : undefined,
        metadata: {
          toolName: descriptor.name,
          access: descriptor.access,
          resourcePolicy: descriptor.resource.kind,
          authType: context.authType,
          credentialId: context.credentialId,
          apiKeyId: context.apiKeyId,
          oauthAuthorizationId: context.oauthAuthorizationId,
          oauthClientId: context.oauthClientId,
          clientId: context.clientId,
          success,
          target: getMcpTargetMetadata(args),
          result: resultMetadata,
          error: getAuditError(error),
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
}

const MCP_CREATED_RESOURCE_TOOLS = new Set([
  'create_page',
  'duplicate_page',
  'copy_page_to_space',
  'create_space',
  'create_comment',
]);

function getMcpAuditResourceId(
  toolName: string,
  args: Record<string, any>,
  result?: Record<string, string>,
) {
  const resultId = result?.id;
  if (MCP_CREATED_RESOURCE_TOOLS.has(toolName) && isUuid(resultId)) {
    return resultId;
  }
  const targetId =
    args.pageId ?? args.commentId ?? args.spaceId ?? args.parentPageId;
  return isUuid(targetId) ? targetId : undefined;
}

function getMcpTargetMetadata(args: Record<string, any>) {
  const allowedKeys = [
    'pageId',
    'commentId',
    'spaceId',
    'parentPageId',
    'format',
    'operation',
    'title',
  ];
  return Object.fromEntries(
    allowedKeys
      .filter((key) => typeof args[key] !== 'undefined')
      .map((key) => [key, truncateString(args[key], 255) ?? args[key]]),
  );
}

function getMcpResultMetadata(
  result: unknown,
): Record<string, string> | undefined {
  if (isMcpToolError(result) || !result || typeof result !== 'object') {
    return undefined;
  }
  const text = (result as { content?: unknown[] }).content?.find(
    (item): item is { type: string; text: string } =>
      !!item &&
      typeof item === 'object' &&
      (item as { type?: unknown }).type === 'text' &&
      typeof (item as { text?: unknown }).text === 'string',
  )?.text;
  if (!text) return undefined;
  try {
    const value = JSON.parse(text);
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      return undefined;
    }
    const keys = ['id', 'title', 'name', 'slugId', 'spaceId', 'parentPageId'];
    const metadata = Object.fromEntries(
      keys.flatMap((key) => {
        const normalized = truncateString(
          (value as Record<string, unknown>)[key],
          255,
        );
        return normalized ? [[key, normalized]] : [];
      }),
    );
    return Object.keys(metadata).length ? metadata : undefined;
  } catch {
    return undefined;
  }
}

function isMcpToolError(result: unknown) {
  return (
    !!result &&
    typeof result === 'object' &&
    'isError' in result &&
    result.isError === true
  );
}

function getAuditError(error?: unknown) {
  if (!error) return undefined;
  if (error instanceof Error) {
    return {
      name: error.name,
      message: truncateString(error.message, 300),
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

function toolOptions(
  description: string,
  inputSchema: Record<string, any>,
  access: McpToolAccess,
) {
  const scope =
    access === 'read'
      ? 'mcp:read'
      : access === 'destructive'
        ? 'mcp:destructive'
        : 'mcp:write';
  const securitySchemes = [{ type: 'oauth2', scopes: [scope] }];
  return {
    description,
    inputSchema,
    annotations: {
      readOnlyHint: access === 'read',
      destructiveHint: access === 'destructive',
    },
    securitySchemes,
    _meta: { securitySchemes },
  } as any;
}
