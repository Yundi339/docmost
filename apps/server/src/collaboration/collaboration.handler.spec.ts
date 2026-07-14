import { CollaborationHandler } from './collaboration.handler';

describe('CollaborationHandler', () => {
  it('propagates persistence errors for direct page content updates', async () => {
    const disconnect = jest.fn().mockResolvedValue(undefined);
    const transact = jest.fn().mockRejectedValue(new Error('save rejected'));
    const openDirectConnection = jest.fn().mockResolvedValue({
      transact,
      disconnect,
    });
    const hocuspocus = { openDirectConnection } as any;
    const user = { id: 'user-id' } as any;
    const handler = new CollaborationHandler();

    await expect(
      handler.getHandlers(hocuspocus).updatePageContent('page.page-id', {
        operation: 'replace',
        prosemirrorJson: { type: 'doc', content: [] },
        user,
      }),
    ).rejects.toThrow('save rejected');

    expect(openDirectConnection).toHaveBeenCalledWith('page.page-id', {
      user,
      contentUpdateOrigin: 'direct',
      propagateStoreErrors: true,
    });
    expect(disconnect).toHaveBeenCalledTimes(1);
  });

  it('keeps non-content collaboration events on the default error policy', async () => {
    const transact = jest.fn().mockResolvedValue(undefined);
    const openDirectConnection = jest.fn().mockResolvedValue({
      transact,
      disconnect: jest.fn().mockResolvedValue(undefined),
    });
    const hocuspocus = { openDirectConnection } as any;
    const user = { id: 'user-id' } as any;
    const handler = new CollaborationHandler();

    await handler.getHandlers(hocuspocus).resolveCommentMark('page.page-id', {
      commentId: 'comment-id',
      resolved: true,
      user,
    });

    expect(openDirectConnection).toHaveBeenCalledWith('page.page-id', {
      user,
    });
  });

  it('preserves the transaction error when disconnect persistence also fails', async () => {
    const transactionError = new Error('explicit deletion required');
    const disconnectError = new Error('disconnect save failed');
    const openDirectConnection = jest.fn().mockResolvedValue({
      transact: jest.fn().mockRejectedValue(transactionError),
      disconnect: jest.fn().mockRejectedValue(disconnectError),
    });
    const handler = new CollaborationHandler();
    jest
      .spyOn((handler as any).logger, 'error')
      .mockImplementation(() => undefined);

    await expect(
      handler
        .getHandlers({ openDirectConnection } as any)
        .updatePageContent('page.page-id', {
          operation: 'replace',
          prosemirrorJson: { type: 'doc', content: [] },
          user: { id: 'user-id' } as any,
        }),
    ).rejects.toBe(transactionError);
  });
});
