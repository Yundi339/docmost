import { ForbiddenException, Injectable } from '@nestjs/common';
import { z } from 'zod';
import { SpaceService } from '../../../core/space/services/space.service';
import { SpaceMemberService } from '../../../core/space/services/space-member.service';
import { CreateSpaceDto } from '../../../core/space/dto/create-space.dto';
import { UpdateSpaceDto } from '../../../core/space/dto/update-space.dto';
import { SpaceIdDto as SpaceInfoDto } from '../../../core/space/dto/space-id.dto';
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
export class McpSpaceToolProvider implements McpToolProvider {
  constructor(
    private readonly spaceService: SpaceService,
    private readonly spaceMemberService: SpaceMemberService,
    private readonly workspaceAbility: WorkspaceAbilityFactory,
    private readonly access: McpToolAccessService,
  ) {}

  getTools(): McpToolDescriptor<any>[] {
    return [
      defineMcpTool({
        name: 'get_space',
        description: 'Get space information by ID',
        inputSchema: { spaceId: z.string() },
        access: 'read',
        resource: { kind: 'resource_args', spaceIds: ['spaceId'] },
        input: { dto: SpaceInfoDto },
        handler: async ({ user, workspace, context }, input) => {
          await this.access.assertSpaceSettingsRead(
            user,
            input.spaceId,
            context,
          );
          const space = await this.spaceService.getSpaceInfo(
            input.spaceId,
            workspace.id,
          );
          return textResult(space);
        },
      }),
      defineMcpTool({
        name: 'list_spaces',
        description: 'List all spaces the user has access to',
        inputSchema: {},
        access: 'read',
        resource: { kind: 'scoped_collection' },
        input: { noDto: true },
        handler: async ({ user, workspace, context }) => {
          const result = await this.spaceMemberService.getUserSpaces(
            user.id,
            this.access.paginate(100),
            workspace.id,
            context.spaceAccess.effectiveSpaceIds,
          );
          return textResult(result);
        },
      }),
      defineMcpTool({
        name: 'create_space',
        description: 'Create a new space',
        inputSchema: {
          name: z.string(),
          slug: z.string(),
          description: z.string().optional(),
        },
        access: 'write',
        resource: { kind: 'all_spaces_only' },
        input: { dto: CreateSpaceDto },
        handler: async ({ user, workspace }, input) => {
          const ability = this.workspaceAbility.createForUser(user, workspace);
          if (
            ability.cannot(
              WorkspaceCaslAction.Manage,
              WorkspaceCaslSubject.Space,
            )
          ) {
            throw new ForbiddenException('Forbidden: cannot create spaces');
          }
          const space = await this.spaceService.createSpace(
            user,
            workspace.id,
            input,
          );
          return textResult({
            id: space.id,
            name: space.name,
            slug: space.slug,
          });
        },
      }),
      defineMcpTool({
        name: 'update_space',
        description: 'Update a space',
        inputSchema: {
          spaceId: z.string(),
          name: z.string().optional(),
          description: z.string().optional(),
        },
        access: 'write',
        resource: { kind: 'resource_args', spaceIds: ['spaceId'] },
        input: { dto: UpdateSpaceDto },
        handler: async ({ user, workspace, context }, input) => {
          await this.access.assertSpaceSettingsManage(
            user,
            input.spaceId,
            context,
          );
          const space = await this.spaceService.updateSpace(
            input as any,
            workspace.id,
          );
          return textResult(space);
        },
      }),
    ];
  }
}

function textResult(value: unknown) {
  return { content: [{ type: 'text', text: JSON.stringify(value) }] };
}
