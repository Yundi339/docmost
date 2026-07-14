import { ConflictException } from '@nestjs/common';
import { DatabasePagePolicyContributor } from './database-page-policy.contributor';
import { DatabasePagePolicyBinding } from './database.repo';

const host = (
  overrides: Partial<DatabasePagePolicyBinding> = {},
): DatabasePagePolicyBinding => ({
  role: 'host',
  pageId: 'board_page_1',
  resourceId: 'database_1',
  databaseId: 'database_1',
  databasePageId: 'board_page_1',
  spaceId: 'space_1',
  workspaceId: 'workspace_1',
  ...overrides,
});

const record = (
  overrides: Partial<DatabasePagePolicyBinding> = {},
): DatabasePagePolicyBinding => ({
  role: 'record',
  pageId: 'record_page_1',
  resourceId: 'record_1',
  databaseId: 'database_1',
  databasePageId: 'board_page_1',
  spaceId: 'space_1',
  workspaceId: 'workspace_1',
  ...overrides,
});

describe('DatabasePagePolicyContributor', () => {
  let bindings: DatabasePagePolicyBinding[];
  let contributor: DatabasePagePolicyContributor;

  beforeEach(() => {
    bindings = [];
    const databaseRepo = {
      listPagePolicyBindings: jest
        .fn()
        .mockImplementation(async (pageIds: string[]) =>
          bindings.filter((binding) => pageIds.includes(binding.pageId)),
        ),
    };
    const registry = { register: jest.fn(), unregister: jest.fn() };
    const pageRepo = {
      findById: jest.fn().mockResolvedValue({
        id: 'board_page_1',
        spaceId: 'space_1',
        workspaceId: 'workspace_1',
        deletedAt: null,
      }),
    };
    contributor = new DatabasePagePolicyContributor(
      databaseRepo as any,
      pageRepo as any,
      registry as any,
    );
  });

  it('adds generic host and record capabilities without changing pages', async () => {
    bindings = [host(), record()];

    const metadata = await contributor.getPageMetadata([
      'board_page_1',
      'record_page_1',
    ]);

    expect(metadata.get('board_page_1')).toEqual({
      extensions: [
        { provider: 'database', role: 'host', resourceId: 'database_1' },
      ],
      capabilities: {
        moveToSpace: false,
        duplicate: false,
      },
    });
    expect(metadata.get('record_page_1')).toEqual({
      extensions: [
        { provider: 'database', role: 'record', resourceId: 'record_1' },
      ],
      capabilities: { reparent: false, moveToSpace: false, duplicate: false },
    });
  });

  it('allows ordinary child pages under a board host', async () => {
    bindings = [host()];

    await expect(
      contributor.assertOperation({
        operation: 'createChild',
        parentPage: { id: 'board_page_1' } as any,
        actorId: 'user_1',
      }),
    ).resolves.toBeUndefined();
  });

  it('allows a work item reorder only inside its owning board', async () => {
    bindings = [host(), record()];

    await expect(
      contributor.assertOperation({
        operation: 'move',
        page: { id: 'record_page_1', spaceId: 'space_1' } as any,
        targetParentPageId: 'board_page_1',
        targetSpaceId: 'space_1',
        affectedPageIds: ['record_page_1'],
        actorId: 'user_1',
      }),
    ).resolves.toBeUndefined();
  });

  it('rejects moving a work item outside its owning board', async () => {
    bindings = [record()];

    await expect(
      contributor.assertOperation({
        operation: 'move',
        page: { id: 'record_page_1', spaceId: 'space_1' } as any,
        targetParentPageId: null,
        targetSpaceId: 'space_1',
        affectedPageIds: ['record_page_1'],
        actorId: 'user_1',
      }),
    ).rejects.toMatchObject({
      response: expect.objectContaining({
        code: 'DATABASE_WORK_ITEM_MOVE_RESTRICTED',
      }),
    });
  });

  it('allows ordinary pages to coexist with board work items', async () => {
    bindings = [host()];

    await expect(
      contributor.assertOperation({
        operation: 'move',
        page: { id: 'ordinary_page', spaceId: 'space_1' } as any,
        targetParentPageId: 'board_page_1',
        targetSpaceId: 'space_1',
        affectedPageIds: ['ordinary_page'],
        actorId: 'user_1',
      }),
    ).resolves.toBeUndefined();
  });

  it('rejects cross-space moves containing a managed descendant', async () => {
    bindings = [
      host({ pageId: 'nested_board', databasePageId: 'nested_board' }),
    ];

    await expect(
      contributor.assertOperation({
        operation: 'move',
        page: { id: 'ancestor_page', spaceId: 'space_1' } as any,
        targetParentPageId: null,
        targetSpaceId: 'space_2',
        affectedPageIds: ['ancestor_page', 'nested_board'],
        actorId: 'user_1',
      }),
    ).rejects.toMatchObject({
      response: expect.objectContaining({
        code: 'DATABASE_SUBTREE_MOVE_RESTRICTED',
      }),
    });
  });

  it('rejects restoring a work item while its board remains in trash', async () => {
    bindings = [record()];
    const pageRepo = (contributor as any).pageRepo;
    pageRepo.findById.mockResolvedValue({
      id: 'board_page_1',
      spaceId: 'space_1',
      workspaceId: 'workspace_1',
      deletedAt: new Date(),
    });

    await expect(
      contributor.assertOperation({
        operation: 'restore',
        page: {
          id: 'record_page_1',
          parentPageId: 'board_page_1',
          spaceId: 'space_1',
          workspaceId: 'workspace_1',
        } as any,
        actorId: 'user_1',
      }),
    ).rejects.toMatchObject({
      response: expect.objectContaining({
        code: 'DATABASE_RESTORE_BOARD_REQUIRED',
      }),
    });
  });
});
