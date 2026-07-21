import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { McpToolAccessService } from './mcp-tool-access.service';
import type { McpRequestContext } from './mcp.types';

describe('McpToolAccessService credential boundary', () => {
  const allowedSpaceId = '018f3f73-2f69-7c8d-9d79-8f3f4d7d9711';
  const otherSpaceId = '018f3f73-2f69-7c8d-9d79-8f3f4d7d9712';
  const pageId = '018f3f73-2f69-7c8d-9d79-8f3f4d7d9713';

  const context = (mode: 'all' | 'selected'): McpRequestContext => ({
    authType: 'api_key',
    credentialId: 'api-key-id',
    apiKeyId: 'api-key-id',
    scopes: ['mcp:read'],
    mode: 'read-only',
    principalRevision: 'principal-1',
    spaceAccess: {
      mode,
      selectedSpaceIds: mode === 'selected' ? [allowedSpaceId] : [],
      effectiveSpaceIds: [allowedSpaceId],
      revision: 'spaces-1',
    },
  });

  it('hides a direct space outside the credential boundary', async () => {
    const service = createService([]);
    await expect(
      service.assertCredentialResourceAccess(
        context('selected'),
        'workspace-id',
        { kind: 'resource_args', spaceIds: ['spaceId'] },
        { spaceId: otherSpaceId },
      ),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('checks the current page space instead of trusting the page ID', async () => {
    const service = createService([{ id: pageId, spaceId: otherSpaceId }]);
    await expect(
      service.assertCredentialResourceAccess(
        context('selected'),
        'workspace-id',
        { kind: 'resource_args', pageIds: ['pageId'] },
        { pageId },
      ),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('blocks workspace-global tools for selected-space credentials', async () => {
    const service = createService([]);
    await expect(
      service.assertCredentialResourceAccess(
        context('selected'),
        'workspace-id',
        { kind: 'all_spaces_only' },
        {},
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });
});

function createService(rows: any[]) {
  const query: Record<string, jest.Mock> = {};
  for (const method of ['select', 'where', 'innerJoin']) {
    query[method] = jest.fn(() => query);
  }
  query.execute = jest.fn().mockResolvedValue(rows);
  const db = { selectFrom: jest.fn().mockReturnValue(query) };
  return new McpToolAccessService({} as any, {} as any, {} as any, db as any);
}
