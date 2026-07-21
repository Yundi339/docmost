import { Cache } from 'cache-manager';
import { randomUUID } from 'node:crypto';

export async function withCache<T>(
  cacheManager: Cache,
  key: string,
  ttlMs: number,
  fn: () => Promise<T>,
): Promise<T> {
  try {
    const cached = await cacheManager.get<{ v: T }>(key);
    if (cached !== undefined && cached !== null) {
      return cached.v;
    }
  } catch (err) {
    console.warn(
      `[withCache] get failed for "${key}", falling back to source`,
      err,
    );
  }

  const value = await fn();

  try {
    await cacheManager.set(key, { v: value }, ttlMs);
  } catch (err) {
    console.warn(`[withCache] set failed for "${key}"`, err);
  }

  return value;
}

export async function withVersionedCache<T>(
  cacheManager: Cache,
  key: string,
  versionKey: string,
  ttlMs: number,
  fn: () => Promise<T>,
): Promise<T> {
  let version: string | undefined;
  try {
    version = await cacheManager.get<string>(versionKey);
    if (!version) {
      version = randomUUID();
      await cacheManager.set(versionKey, version);
    }

    const cached = await cacheManager.get<{ v: T }>(`${key}:v:${version}`);
    if (cached !== undefined && cached !== null) return cached.v;
  } catch (err) {
    console.warn(
      `[withVersionedCache] get failed for "${key}", falling back to source`,
      err,
    );
    return fn();
  }

  const value = await fn();

  try {
    const currentVersion = await cacheManager.get<string>(versionKey);
    if (currentVersion === version) {
      await cacheManager.set(`${key}:v:${version}`, { v: value }, ttlMs);
    }
  } catch (err) {
    console.warn(`[withVersionedCache] set failed for "${key}"`, err);
  }

  return value;
}
