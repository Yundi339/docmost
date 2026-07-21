import { type Kysely, sql } from 'kysely';

const validRestConfiguration = sql`
  cardinality(scopes) > 0
  AND scopes <@ ARRAY['rest:read', 'rest:write']::text[]
  AND space_access_mode = 'all'
`;

const validMcpConfiguration = sql`
  cardinality(scopes) > 0
  AND scopes <@ ARRAY['mcp:read', 'mcp:write', 'mcp:destructive']::text[]
  AND space_access_mode IN ('all', 'selected')
`;

export async function up(db: Kysely<any>): Promise<void> {
  await db.schema
    .alterTable('api_keys')
    .addColumn('key_type', 'varchar')
    .execute();

  // Before scopes existed, API keys had the effective legacy REST read/write access.
  await sql`
    UPDATE api_keys
    SET scopes = ARRAY['rest:read', 'rest:write']::text[]
    WHERE scopes IS NULL
  `.execute(db);

  // Invalid keys keep their original scopes for audit history. The key type is a
  // deterministic placeholder because deleted rows are excluded from authentication.
  await sql`
    WITH revoked_keys AS (
      UPDATE api_keys
      SET
        key_type = 'rest',
        deleted_at = COALESCE(deleted_at, now()),
        updated_at = CASE WHEN deleted_at IS NULL THEN now() ELSE updated_at END
      WHERE NOT (
        COALESCE((${validRestConfiguration}), false)
        OR COALESCE((${validMcpConfiguration}), false)
      )
      RETURNING id
    )
    DELETE FROM api_key_space_grants AS grants
    USING revoked_keys
    WHERE grants.api_key_id = revoked_keys.id
  `.execute(db);

  await sql`
    UPDATE api_keys
    SET key_type = CASE
      WHEN ${validRestConfiguration} THEN 'rest'
      ELSE 'mcp'
    END
    WHERE key_type IS NULL
  `.execute(db);

  await db.schema
    .alterTable('api_keys')
    .alterColumn('key_type', (col) => col.setNotNull())
    .alterColumn('scopes', (col) => col.dropDefault())
    .execute();

  await db.schema
    .alterTable('api_keys')
    .addCheckConstraint(
      'api_keys_key_type_check',
      sql`key_type IN ('rest', 'mcp')`,
    )
    .execute();

  await db.schema
    .alterTable('api_keys')
    .addCheckConstraint(
      'api_keys_active_configuration_check',
      sql`
        deleted_at IS NOT NULL
        OR (
          (key_type = 'rest' AND ${validRestConfiguration})
          OR (key_type = 'mcp' AND ${validMcpConfiguration})
        )
      `,
    )
    .execute();
}

export async function down(db: Kysely<any>): Promise<void> {
  await db.schema
    .alterTable('api_keys')
    .dropConstraint('api_keys_active_configuration_check')
    .execute();
  await db.schema
    .alterTable('api_keys')
    .dropConstraint('api_keys_key_type_check')
    .execute();

  await db.schema
    .alterTable('api_keys')
    .alterColumn('scopes', (col) =>
      col.setDefault(sql`ARRAY['rest:read', 'rest:write']::text[]`),
    )
    .dropColumn('key_type')
    .execute();

  // Deliberately irreversible: revoked keys and deleted space grants are not restored.
}
