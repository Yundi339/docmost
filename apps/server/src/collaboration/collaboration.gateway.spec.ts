import { CollaborationGateway } from './collaboration.gateway';

jest.mock(
  'src/collaboration/collaboration.util',
  () => ({
    jsonToNode: jest.fn(),
  }),
  { virtual: true },
);

jest.mock('./extensions/redis-sync', () => ({
  RedisSyncExtension: jest.fn(),
}));

describe('CollaborationGateway.handleYjsEvent', () => {
  it('runs collaboration events locally when Redis sync is disabled', async () => {
    const localHandler = jest.fn().mockResolvedValue('updated');
    const gateway = Object.create(
      CollaborationGateway.prototype,
    ) as CollaborationGateway;

    Object.assign(gateway as any, {
      hocuspocus: {},
      redisSync: null,
      collabEventsService: {
        getHandlers: jest.fn().mockReturnValue({
          updatePageContent: localHandler,
        }),
      },
    });

    await expect(
      gateway.handleYjsEvent('updatePageContent', 'page.page-id', {
        operation: 'replace',
        prosemirrorJson: { type: 'doc' },
        user: { id: 'user-id' } as any,
      }),
    ).resolves.toBe('updated');
    expect(localHandler).toHaveBeenCalledWith(
      'page.page-id',
      expect.objectContaining({ operation: 'replace' }),
    );
  });

  it('uses Redis sync when it is enabled', async () => {
    const handleEvent = jest.fn().mockResolvedValue('updated');
    const gateway = Object.create(
      CollaborationGateway.prototype,
    ) as CollaborationGateway;

    Object.assign(gateway as any, {
      redisSync: { handleEvent },
    });

    await gateway.handleYjsEvent('updatePageContent', 'page.page-id', {
      operation: 'replace',
      prosemirrorJson: { type: 'doc' },
      user: { id: 'user-id' } as any,
    });

    expect(handleEvent).toHaveBeenCalledWith(
      'updatePageContent',
      'page.page-id',
      expect.objectContaining({ operation: 'replace' }),
    );
  });
});
