import * as Y from 'yjs';
import { PersistenceExtension } from './persistence.extension';

describe('PersistenceExtension', () => {
  const createExtension = (saveError: Error) => {
    const db = {
      transaction: () => ({
        execute: async () => {
          throw saveError;
        },
      }),
    };

    return new PersistenceExtension(
      {} as any,
      db as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
      {} as any,
    );
  };

  const createPayload = (propagateStoreErrors: boolean) => {
    const document = new Y.Doc() as any;
    document.broadcastStateless = jest.fn();

    return {
      documentName: 'page.019f0000-0000-7000-8000-000000000001',
      document,
      context: {
        user: { id: 'user-id' },
        propagateStoreErrors,
      },
    } as any;
  };

  it('rethrows failed direct writes so REST and MCP callers see the failure', async () => {
    const saveError = new Error('save rejected');
    const extension = createExtension(saveError);

    await expect(extension.onStoreDocument(createPayload(true))).rejects.toBe(
      saveError,
    );
  });

  it('retains websocket persistence error isolation by default', async () => {
    const extension = createExtension(new Error('save rejected'));

    await expect(
      extension.onStoreDocument(createPayload(false)),
    ).resolves.toBeUndefined();
  });
});
