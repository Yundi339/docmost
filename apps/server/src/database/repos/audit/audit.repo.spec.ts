import { AuditRepo, AuditResourceDetails } from './audit.repo';

describe('AuditRepo resource enrichment', () => {
  const workspaceId = '018f3f73-2f69-7c8d-9d79-8f3f4d7d9700';
  const createdPageId = '018f3f73-2f69-7c8d-9d79-8f3f4d7d9701';
  const parentPageId = '018f3f73-2f69-7c8d-9d79-8f3f4d7d9702';
  const resource: AuditResourceDetails = {
    id: createdPageId,
    type: 'page',
    name: 'Created page',
    path: 'Test / Parent / Created page',
  };

  function createRepo() {
    const repo = new AuditRepo({} as any);
    const resolvePageResource = jest
      .spyOn(repo as any, 'resolvePageResource')
      .mockResolvedValue(resource);
    return { repo, resolvePageResource };
  }

  it('uses the created page instead of its parent for create_page', async () => {
    const { repo, resolvePageResource } = createRepo();

    const result = await (repo as any).resolveAuditResource(
      {
        resourceType: 'mcp_tool',
        resourceId: createdPageId,
        metadata: {
          success: true,
          toolName: 'create_page',
          target: { parentPageId },
          result: { id: createdPageId },
        },
      },
      workspaceId,
      new Map(),
    );

    expect(resolvePageResource).toHaveBeenCalledWith(
      createdPageId,
      workspaceId,
    );
    expect(result).toEqual(resource);
  });

  it('does not resolve targets for failed MCP calls', async () => {
    const { repo, resolvePageResource } = createRepo();

    const result = await (repo as any).resolveAuditResource(
      {
        resourceType: 'mcp_tool',
        resourceId: createdPageId,
        metadata: {
          success: false,
          toolName: 'get_page',
          target: { pageId: createdPageId },
        },
      },
      workspaceId,
      new Map(),
    );

    expect(result).toBeNull();
    expect(resolvePageResource).not.toHaveBeenCalled();
  });

  it('prefers the immutable resource snapshot stored with the log', async () => {
    const { repo, resolvePageResource } = createRepo();

    const result = await (repo as any).resolveAuditResource(
      {
        resourceType: 'page',
        resourceId: createdPageId,
        metadata: { resourceSnapshot: resource },
      },
      workspaceId,
      new Map(),
    );

    expect(result).toEqual(resource);
    expect(resolvePageResource).not.toHaveBeenCalled();
  });
});
