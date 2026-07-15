import { PostgresQueryCompiler } from 'kysely';
import { SystemDiagnosticsRepo } from './system-diagnostics.repo';

describe('SystemDiagnosticsRepo', () => {
  it('treats trashed board and work-item pages as restorable', async () => {
    const compiler = new PostgresQueryCompiler();
    const executeQuery = jest.fn().mockResolvedValue({
      rows: [
        {
          externalDataSourceCount: 0,
          largeBoardCount: 0,
          maxRecordCount: 0,
          orphanDataSourceCount: 0,
          invalidRelationCount: 0,
          realtimeFailureCount: 0,
        },
      ],
    });
    const executor = {
      transformQuery: (node: unknown) => node,
      compileQuery: (
        node: Parameters<typeof compiler.compileQuery>[0],
        queryId: Parameters<typeof compiler.compileQuery>[1],
      ) => compiler.compileQuery(node, queryId),
      executeQuery,
    };
    const repo = new SystemDiagnosticsRepo({
      getExecutor: () => executor,
    } as any);

    await repo.getSignals('workspace-1');

    const compiledQuery = executeQuery.mock.calls[0][0];
    expect(compiledQuery.sql).not.toContain('host_deleted_at');
    expect(compiledQuery.sql).not.toContain('work_item.deleted_at IS NOT NULL');
    expect(compiledQuery.sql).toContain('db.deleted_at IS NOT NULL');
  });

  it('lists only workspace-scoped diagnostic details without page content', async () => {
    const compiler = new PostgresQueryCompiler();
    const executeQuery = jest.fn().mockResolvedValue({
      rows: [
        {
          id: '019eeac3-98d3-754c-a78a-c23b2bf0e4cc',
          blockId: 'block-1',
          title: 'Project board',
          provider: 'docmost-native',
          state: 'orphaned',
          issue: 'database_block_missing',
          recordCount: 3,
          createdAt: new Date('2026-06-21T15:19:07.000Z'),
          hostPageId: '019eeac3-455d-78e1-80a5-90ef33230f2f',
          hostPageTitle: 'Requirements',
          hostPageSlugId: 'page-slug',
          hostPageDeletedAt: null,
          spaceId: '019eeac3-455d-78e1-80a5-90ef33230f30',
          spaceName: 'Engineering',
          spaceSlug: 'engineering',
        },
        {
          id: '019eeac3-98d3-754c-a78a-c23b2bf0e4cb',
        },
      ],
    });
    const executor = {
      transformQuery: (node: unknown) => node,
      compileQuery: (
        node: Parameters<typeof compiler.compileQuery>[0],
        queryId: Parameters<typeof compiler.compileQuery>[1],
      ) => compiler.compileQuery(node, queryId),
      executeQuery,
    };
    const repo = new SystemDiagnosticsRepo({
      getExecutor: () => executor,
    } as any);

    const result = await repo.listDataSources('workspace-1', {
      filter: 'issues',
      limit: 1,
    });

    expect(result).toEqual({
      items: [
        expect.objectContaining({
          id: '019eeac3-98d3-754c-a78a-c23b2bf0e4cc',
          state: 'orphaned',
          issue: 'database_block_missing',
          recordCount: 3,
          hostPage: expect.objectContaining({ slugId: 'page-slug' }),
          space: expect.objectContaining({ slug: 'engineering' }),
        }),
      ],
      nextCursor: '019eeac3-98d3-754c-a78a-c23b2bf0e4cc',
    });
    const compiledQuery = executeQuery.mock.calls[0][0];
    expect(compiledQuery.parameters).toContain('workspace-1');
    expect(compiledQuery.sql).toContain("state = 'orphaned'");
    expect(result.items[0]).not.toHaveProperty('content');
    expect(result.items[0]).not.toHaveProperty('blockId');
  });
});
