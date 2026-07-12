import { ShareAccessGuard } from './share-access.guard';

describe('ShareAccessGuard', () => {
  it('forwards only the page identifier and waits for access validation', async () => {
    const shareAccessService = { assertRequestAccess: jest.fn() };
    const guard = new ShareAccessGuard(shareAccessService as any);
    const request = {
      body: {
        pageId: 'page-id',
        password: 'must-not-be-forwarded',
      },
    };
    const context = {
      switchToHttp: () => ({ getRequest: () => request }),
    } as any;

    await expect(guard.canActivate(context)).resolves.toBe(true);
    expect(shareAccessService.assertRequestAccess).toHaveBeenCalledWith(
      request,
      { shareId: undefined, pageId: 'page-id' },
    );
  });

  it('rejects ambiguous share and page locators', async () => {
    const shareAccessService = { assertRequestAccess: jest.fn() };
    const guard = new ShareAccessGuard(shareAccessService as any);
    const context = {
      switchToHttp: () => ({
        getRequest: () => ({
          body: { shareId: 'share-id', pageId: 'page-id' },
        }),
      }),
    } as any;

    await expect(guard.canActivate(context)).rejects.toMatchObject({
      status: 400,
    });
    expect(shareAccessService.assertRequestAccess).not.toHaveBeenCalled();
  });
});
