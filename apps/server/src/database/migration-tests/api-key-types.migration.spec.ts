import { readFileSync } from 'node:fs';
import { join } from 'node:path';

describe('api key type migration', () => {
  const source = readFileSync(
    join(
      __dirname,
      '../migrations/20260721T130000-api-key-types.ts',
    ),
    'utf8',
  );

  it('revokes invalid keys without rewriting their scopes and removes grants', () => {
    const revocation = source.slice(
      source.indexOf('WITH revoked_keys'),
      source.indexOf('UPDATE api_keys\n    SET key_type = CASE'),
    );

    expect(revocation).toContain("key_type = 'rest'");
    expect(revocation).toContain('deleted_at = COALESCE(deleted_at, now())');
    expect(revocation).toContain('DELETE FROM api_key_space_grants');
    expect(revocation).not.toMatch(/SET[\s\S]*scopes\s*=/);
  });

  it('only applies the configuration check to active keys', () => {
    expect(source).toContain('deleted_at IS NOT NULL');
    expect(source).toContain("key_type IN ('rest', 'mcp')");
  });

  it('documents that down does not restore revoked keys or grants', () => {
    const down = source.slice(source.indexOf('export async function down'));

    expect(down).toContain('Deliberately irreversible');
    expect(down).not.toContain('UPDATE api_keys');
    expect(down).not.toContain('INSERT INTO api_key_space_grants');
  });
});
