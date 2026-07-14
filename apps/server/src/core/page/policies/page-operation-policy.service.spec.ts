import { PageOperationPolicyService } from './page-operation-policy.service';
import { PageOperationPolicyContributor } from './page-operation-policy.types';

describe('PageOperationPolicyService', () => {
  it('runs every registered contributor and propagates restrictions', async () => {
    const service = new PageOperationPolicyService();
    const first: PageOperationPolicyContributor = {
      key: 'first',
      assertOperation: jest.fn().mockResolvedValue(undefined),
    };
    const restriction = new Error('restricted');
    const second: PageOperationPolicyContributor = {
      key: 'second',
      assertOperation: jest.fn().mockRejectedValue(restriction),
    };
    service.register(first);
    service.register(second);

    const operation = {
      operation: 'createChild' as const,
      parentPage: { id: 'page_1' } as any,
      actorId: 'user_1',
    };

    await expect(service.assertOperation(operation)).rejects.toBe(restriction);
    expect(first.assertOperation).toHaveBeenCalledWith(operation);
    expect(second.assertOperation).toHaveBeenCalledWith(operation);
  });

  it('merges metadata with false capabilities taking precedence', async () => {
    const service = new PageOperationPolicyService();
    service.register({
      key: 'calendar',
      getPageMetadata: jest.fn().mockResolvedValue(
        new Map([
          [
            'page_1',
            {
              extensions: [
                {
                  provider: 'calendar',
                  role: 'event',
                  resourceId: 'event_1',
                },
              ],
              capabilities: { move: true, createChild: true },
            },
          ],
        ]),
      ),
    });
    service.register({
      key: 'approval',
      getPageMetadata: jest.fn().mockResolvedValue(
        new Map([
          [
            'page_1',
            {
              extensions: [
                {
                  provider: 'approval',
                  role: 'locked',
                  resourceId: 'approval_1',
                },
              ],
              capabilities: { reparent: false },
            },
          ],
        ]),
      ),
    });

    const result = await service.addMetadata([{ id: 'page_1', title: 'Page' }]);

    expect(result).toEqual([
      {
        id: 'page_1',
        title: 'Page',
        extensions: [
          {
            provider: 'calendar',
            role: 'event',
            resourceId: 'event_1',
          },
          {
            provider: 'approval',
            role: 'locked',
            resourceId: 'approval_1',
          },
        ],
        capabilities: { move: true, reparent: false, createChild: true },
      },
    ]);
  });

  it('rejects duplicate contributor keys and supports owned unregister', () => {
    const service = new PageOperationPolicyService();
    const contributor = { key: 'database' };
    service.register(contributor);

    expect(() => service.register({ key: 'database' })).toThrow(
      'Page operation policy contributor already registered: database',
    );

    service.unregister('database', { key: 'database' });
    expect(() => service.register({ key: 'database' })).toThrow();

    service.unregister('database', contributor);
    expect(() => service.register({ key: 'database' })).not.toThrow();
  });
});
