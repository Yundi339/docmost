import { ForbiddenException, Injectable } from '@nestjs/common';
import { z } from 'zod';
import { WorkspaceService } from '../../../core/workspace/services/workspace.service';
import { UserRepo } from '@docmost/db/repos/user/user.repo';
import WorkspaceAbilityFactory from '../../../core/casl/abilities/workspace-ability.factory';
import {
  WorkspaceCaslAction,
  WorkspaceCaslSubject,
} from '../../../core/casl/interfaces/workspace-ability.type';
import { McpToolAccessService } from '../mcp-tool-access.service';
import {
  defineMcpTool,
  type McpToolDescriptor,
  type McpToolProvider,
} from '../mcp.types';

@Injectable()
export class McpMemberToolProvider implements McpToolProvider {
  constructor(
    private readonly workspaceService: WorkspaceService,
    private readonly userRepo: UserRepo,
    private readonly workspaceAbility: WorkspaceAbilityFactory,
    private readonly access: McpToolAccessService,
  ) {}

  getTools(): McpToolDescriptor<any>[] {
    return [
      defineMcpTool({
        name: 'list_workspace_members',
        description: 'List workspace members',
        inputSchema: { limit: z.number().optional() },
        access: 'read',
        input: { noDto: true },
        handler: async ({ user, workspace }, { limit }) => {
          const ability = this.workspaceAbility.createForUser(user, workspace);
          if (
            ability.cannot(
              WorkspaceCaslAction.Manage,
              WorkspaceCaslSubject.Member,
            )
          ) {
            throw new ForbiddenException(
              'Forbidden: cannot list workspace members',
            );
          }
          const result = await this.workspaceService.getWorkspaceUsers(
            workspace.id,
            this.access.paginate(limit),
          );
          return textResult(result);
        },
      }),
      defineMcpTool({
        name: 'get_current_user',
        description: 'Get information about the currently authenticated user',
        inputSchema: {},
        access: 'read',
        input: { noDto: true },
        handler: async ({ user, workspace }) => {
          const current = await this.userRepo.findById(user.id, workspace.id);
          return textResult({
            id: current.id,
            name: current.name,
            email: current.email,
            role: current.role,
            avatarUrl: current.avatarUrl,
          });
        },
      }),
    ];
  }
}

function textResult(value: unknown) {
  return { content: [{ type: 'text', text: JSON.stringify(value) }] };
}
