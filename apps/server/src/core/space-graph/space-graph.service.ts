import {
  BadRequestException,
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PageRepo } from '@docmost/db/repos/page/page.repo';
import { SpaceRepo } from '@docmost/db/repos/space/space.repo';
import { User, Workspace } from '@docmost/db/types/entity.types';
import SpaceAbilityFactory from '../casl/abilities/space-ability.factory';
import {
  SpaceCaslAction,
  SpaceCaslSubject,
} from '../casl/interfaces/space-ability.type';
import { PageAccessService } from '../page/page-access/page-access.service';
import { SpaceGraphDto } from './dto/space-graph.dto';
import { SpaceGraphRepo } from './space-graph.repo';
import {
  AUDIT_SERVICE,
  IAuditService,
} from '../../integrations/audit/audit.service';
import { AuditEvent, AuditResource } from '../../common/events/audit-events';

const DEFAULT_GRAPH_LIMIT = 500;
const DEFAULT_GRAPH_DEPTH = 1;

@Injectable()
export class SpaceGraphService {
  constructor(
    private readonly graphRepo: SpaceGraphRepo,
    private readonly spaceRepo: SpaceRepo,
    private readonly pageRepo: PageRepo,
    private readonly pageAccess: PageAccessService,
    private readonly spaceAbility: SpaceAbilityFactory,
    @Inject(AUDIT_SERVICE) private readonly auditService: IAuditService,
  ) {}

  async getGraph(dto: SpaceGraphDto, user: User, workspace: Workspace) {
    if (dto.depth !== undefined && !dto.centerPageId) {
      throw new BadRequestException(
        'A center page is required when graph depth is provided',
      );
    }

    const space = await this.spaceRepo.findById(dto.spaceId, workspace.id);
    if (!space) throw new NotFoundException('Space not found');

    const ability = await this.spaceAbility.createForUser(user, space.id);
    if (ability.cannot(SpaceCaslAction.Read, SpaceCaslSubject.Page)) {
      throw new ForbiddenException();
    }

    if (dto.centerPageId) {
      const centerPage = await this.pageRepo.findById(dto.centerPageId);
      if (
        !centerPage ||
        centerPage.workspaceId !== workspace.id ||
        centerPage.spaceId !== space.id ||
        centerPage.deletedAt
      ) {
        throw new NotFoundException('Page not found');
      }
      await this.pageAccess.validateCanView(centerPage, user);
    }

    const normalized = {
      spaceId: space.id,
      centerPageId: dto.centerPageId,
      depth: dto.depth ?? DEFAULT_GRAPH_DEPTH,
      query: dto.query,
      limit: dto.limit ?? DEFAULT_GRAPH_LIMIT,
    };
    const { nodes, truncated } = await this.graphRepo.findVisibleNodes(
      normalized,
      user.id,
      workspace.id,
    );
    const edges = await this.graphRepo.findEdges(
      nodes.map((node) => node.id),
      workspace.id,
    );

    return {
      nodes,
      edges,
      meta: {
        limit: normalized.limit,
        truncated,
        centerPageId: normalized.centerPageId ?? null,
        depth: normalized.centerPageId ? normalized.depth : null,
        queryApplied: Boolean(normalized.query),
      },
    };
  }

  async exportGraph(dto: SpaceGraphDto, user: User, workspace: Workspace) {
    const graph = await this.getGraph(dto, user, workspace);
    this.auditService.log({
      event: AuditEvent.SPACE_GRAPH_EXPORTED,
      resourceType: AuditResource.SPACE,
      resourceId: dto.spaceId,
      metadata: {
        nodeCount: graph.nodes.length,
        edgeCount: graph.edges.length,
        centerPageId: graph.meta.centerPageId,
        truncated: graph.meta.truncated,
      },
    });
    return graph;
  }
}
