import { withVersionedCache } from './with-cache';

describe('withVersionedCache', () => {
  it('does not repopulate a stale version after concurrent invalidation', async () => {
    let version = 'version-1';
    const cache = {
      get: jest.fn(async (key: string) => {
        if (key === 'permission-version') return version;
        return undefined;
      }),
      set: jest.fn(),
    };
    const source = jest.fn(async () => {
      version = 'version-2';
      return 'stale-result';
    });

    await expect(
      withVersionedCache(
        cache as any,
        'permission',
        'permission-version',
        5_000,
        source,
      ),
    ).resolves.toBe('stale-result');

    expect(cache.set).not.toHaveBeenCalled();
  });

  it('initializes a version and caches when no version exists', async () => {
    const values = new Map<string, unknown>();
    const cache = {
      get: jest.fn(async (key: string) => values.get(key)),
      set: jest.fn(async (key: string, value: unknown) => {
        values.set(key, value);
      }),
    };
    const source = jest.fn().mockResolvedValue('fresh-result');

    await expect(
      withVersionedCache(
        cache as any,
        'permission',
        'permission-version',
        5_000,
        source,
      ),
    ).resolves.toBe('fresh-result');

    expect(source).toHaveBeenCalledTimes(1);
    expect(cache.set).toHaveBeenCalledTimes(2);
    const version = values.get('permission-version');
    expect(version).toEqual(expect.any(String));
    expect(values.get(`permission:v:${version}`)).toEqual({
      v: 'fresh-result',
    });
  });
});
