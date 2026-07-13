import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { DirectoryQueryService } from './directory-query.service';

describe('DirectoryQueryService', () => {
  const user = { id: 'user-id', role: 'member' } as any;
  const workspace = {
    id: 'workspace-id',
    settings: { directory: { visibility: 'context' } },
  } as any;

  function createService(overrides: Record<string, any> = {}) {
    const query = fluentQuery();
    const db: Record<string, jest.Mock> = {
      selectFrom: jest.fn().mockReturnValue(query),
      withRecursive: jest.fn(),
      with: jest.fn(),
    };
    db.withRecursive.mockImplementation((_name, callback) => {
      callback(db);
      return db;
    });
    db.with.mockImplementation((_name, callback) => {
      callback(db);
      return db;
    });
    const pageRepo = { findById: jest.fn() };
    const spaceRepo = { findById: jest.fn() };
    const pageAccess = {
      validateCanView: jest.fn(),
      validateCanEdit: jest.fn(),
    };
    const spaceAbility = { createForUser: jest.fn() };
    const visibilityPolicy = {
      resolveVisibility: jest.fn().mockReturnValue('context'),
      resolveScope: jest.fn().mockReturnValue('workspace'),
    };
    const service = new DirectoryQueryService(
      overrides.db ?? (db as any),
      overrides.pageRepo ?? (pageRepo as any),
      overrides.spaceRepo ?? (spaceRepo as any),
      overrides.pageAccess ?? (pageAccess as any),
      overrides.spaceAbility ?? (spaceAbility as any),
      overrides.visibilityPolicy ?? (visibilityPolicy as any),
    );
    return {
      service,
      query,
      pageRepo,
      spaceRepo,
      pageAccess,
      spaceAbility,
      visibilityPolicy,
    };
  }

  it('selects only minimal active user fields', async () => {
    const { service, query } = createService();
    query.execute.mockResolvedValue([
      { id: 'candidate-id', name: 'Candidate', avatarUrl: null },
    ]);

    await expect(
      service.search(
        {
          query: 'Candidate',
          limit: 10,
          includeUsers: true,
          includeGroups: false,
          context: 'generic',
        },
        user,
        workspace,
      ),
    ).resolves.toEqual({
      users: [{ id: 'candidate-id', name: 'Candidate', avatarUrl: null }],
      groups: [],
    });

    expect(query.select).toHaveBeenCalledWith([
      'users.id',
      'users.name',
      'users.avatarUrl',
    ]);
    expect(query.select.mock.calls.flat().join(' ')).not.toContain('email');
    expect(rawWhereSql(query)).not.toContain('users.email');
    expect(query.where).toHaveBeenCalledWith('users.deactivatedAt', 'is', null);
  });

  it('uses email only for a policy-restricted exact lookup', async () => {
    const { service, query, visibilityPolicy } = createService();
    visibilityPolicy.resolveScope.mockReturnValue('exact');
    query.execute.mockResolvedValue([]);

    await service.search(
      {
        query: 'known@example.test',
        limit: 10,
        includeUsers: true,
        includeGroups: false,
        context: 'generic',
      },
      user,
      workspace,
    );

    expect(rawWhereSql(query)).toContain('users.email');
  });

  it('requires a page id for mention context', async () => {
    const { service } = createService();
    await expect(
      service.search(
        {
          query: '',
          limit: 5,
          includeUsers: true,
          includeGroups: false,
          context: 'mention',
        },
        user,
        workspace,
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('validates page access before searching mention candidates', async () => {
    const { service, pageRepo, pageAccess, query, visibilityPolicy } =
      createService();
    pageRepo.findById.mockResolvedValue({
      id: 'page-id',
      spaceId: 'space-id',
      workspaceId: workspace.id,
      deletedAt: null,
    });
    visibilityPolicy.resolveScope.mockReturnValue('target-page');
    query.execute.mockResolvedValue([]);

    await service.search(
      {
        query: '',
        limit: 5,
        includeUsers: true,
        includeGroups: false,
        context: 'mention',
        pageId: 'page-id',
      },
      user,
      workspace,
    );

    expect(pageAccess.validateCanView).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'page-id' }),
      user,
    );
  });

  it('rejects a forged space-member context without manage permission', async () => {
    const { service, spaceRepo, spaceAbility } = createService();
    spaceRepo.findById.mockResolvedValue({
      id: 'space-id',
      deletedAt: null,
    });
    spaceAbility.createForUser.mockResolvedValue({
      cannot: jest.fn().mockReturnValue(true),
    });

    await expect(
      service.search(
        {
          query: 'known@example.test',
          limit: 5,
          includeUsers: true,
          includeGroups: false,
          context: 'space-member',
          spaceId: 'space-id',
        },
        user,
        workspace,
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });
});

function fluentQuery() {
  const query: Record<string, jest.Mock> = {};
  for (const method of [
    'select',
    'where',
    'orderBy',
    'limit',
    'unionAll',
    'innerJoin',
  ]) {
    query[method] = jest.fn().mockReturnValue(query);
  }
  query.execute = jest.fn();
  return query;
}

function rawWhereSql(query: Record<string, jest.Mock>): string {
  return query.where.mock.calls
    .flat()
    .filter((value) => typeof value?.toOperationNode === 'function')
    .flatMap((value) => value.toOperationNode().sqlFragments ?? [])
    .join(' ');
}
