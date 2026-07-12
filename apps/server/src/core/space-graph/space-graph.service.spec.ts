import {
  BadRequestException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { AuditEvent, AuditResource } from '../../common/events/audit-events';
import { SpaceGraphService } from './space-graph.service';

describe('SpaceGraphService', () => {
  const user = { id: 'user-id' } as any;
  const workspace = { id: 'workspace-id' } as any;
  const space = { id: 'space-id' } as any;

  let graphRepo: {
    findVisibleNodes: jest.Mock;
    findEdges: jest.Mock;
  };
  let spaceRepo: { findById: jest.Mock };
  let pageRepo: { findById: jest.Mock };
  let pageAccess: { validateCanView: jest.Mock };
  let spaceAbility: { createForUser: jest.Mock };
  let auditService: { log: jest.Mock };
  let service: SpaceGraphService;

  beforeEach(() => {
    graphRepo = {
      findVisibleNodes: jest.fn().mockResolvedValue({
        nodes: [],
        truncated: false,
      }),
      findEdges: jest.fn().mockResolvedValue([]),
    };
    spaceRepo = { findById: jest.fn().mockResolvedValue(space) };
    pageRepo = { findById: jest.fn() };
    pageAccess = { validateCanView: jest.fn() };
    spaceAbility = {
      createForUser: jest.fn().mockResolvedValue({
        cannot: jest.fn().mockReturnValue(false),
      }),
    };
    auditService = { log: jest.fn() };
    service = new SpaceGraphService(
      graphRepo as any,
      spaceRepo as any,
      pageRepo as any,
      pageAccess as any,
      spaceAbility as any,
      auditService as any,
    );
  });

  it('requires a center page when depth is provided', async () => {
    await expect(
      service.getGraph({ spaceId: space.id, depth: 2 }, user, workspace),
    ).rejects.toBeInstanceOf(BadRequestException);

    expect(spaceRepo.findById).not.toHaveBeenCalled();
  });

  it('rejects users without space read permission before querying pages', async () => {
    spaceAbility.createForUser.mockResolvedValue({
      cannot: jest.fn().mockReturnValue(true),
    });

    await expect(
      service.getGraph({ spaceId: space.id }, user, workspace),
    ).rejects.toBeInstanceOf(ForbiddenException);

    expect(graphRepo.findVisibleNodes).not.toHaveBeenCalled();
  });

  it.each([
    null,
    { id: 'center-id', workspaceId: 'other-workspace', spaceId: space.id },
    { id: 'center-id', workspaceId: workspace.id, spaceId: 'other-space' },
    {
      id: 'center-id',
      workspaceId: workspace.id,
      spaceId: space.id,
      deletedAt: new Date(),
    },
  ])('does not reveal an invalid center page: %p', async (centerPage) => {
    pageRepo.findById.mockResolvedValue(centerPage);

    await expect(
      service.getGraph(
        { spaceId: space.id, centerPageId: 'center-id' },
        user,
        workspace,
      ),
    ).rejects.toBeInstanceOf(NotFoundException);

    expect(pageAccess.validateCanView).not.toHaveBeenCalled();
    expect(graphRepo.findVisibleNodes).not.toHaveBeenCalled();
  });

  it('returns only edges whose endpoints survived the visible node query', async () => {
    const centerPage = {
      id: 'center-id',
      workspaceId: workspace.id,
      spaceId: space.id,
      deletedAt: null,
    };
    const nodes = [{ id: 'center-id' }, { id: 'visible-id' }];
    pageRepo.findById.mockResolvedValue(centerPage);
    graphRepo.findVisibleNodes.mockResolvedValue({
      nodes,
      truncated: true,
    });
    graphRepo.findEdges.mockResolvedValue([
      {
        id: 'edge-id',
        sourcePageId: 'center-id',
        targetPageId: 'visible-id',
      },
    ]);

    const result = await service.getGraph(
      {
        spaceId: space.id,
        centerPageId: centerPage.id,
        depth: 2,
        query: 'architecture',
        limit: 100,
      },
      user,
      workspace,
    );

    expect(pageAccess.validateCanView).toHaveBeenCalledWith(centerPage, user);
    expect(graphRepo.findVisibleNodes).toHaveBeenCalledWith(
      {
        spaceId: space.id,
        centerPageId: centerPage.id,
        depth: 2,
        query: 'architecture',
        limit: 100,
      },
      user.id,
      workspace.id,
    );
    expect(graphRepo.findEdges).toHaveBeenCalledWith(
      ['center-id', 'visible-id'],
      workspace.id,
    );
    expect(result.meta).toEqual({
      limit: 100,
      truncated: true,
      centerPageId: centerPage.id,
      depth: 2,
      queryApplied: true,
    });
  });

  it('audits export counts without recording the search query', async () => {
    graphRepo.findVisibleNodes.mockResolvedValue({
      nodes: [{ id: 'visible-id' }],
      truncated: false,
    });

    await service.exportGraph(
      { spaceId: space.id, query: 'confidential title' },
      user,
      workspace,
    );

    expect(auditService.log).toHaveBeenCalledWith({
      event: AuditEvent.SPACE_GRAPH_EXPORTED,
      resourceType: AuditResource.SPACE,
      resourceId: space.id,
      metadata: {
        nodeCount: 1,
        edgeCount: 0,
        centerPageId: null,
        truncated: false,
      },
    });
    expect(JSON.stringify(auditService.log.mock.calls)).not.toContain(
      'confidential title',
    );
  });
});
