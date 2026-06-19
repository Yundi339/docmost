import { type Kysely, sql } from 'kysely';

export async function up(db: Kysely<any>): Promise<void> {
  await db.schema
    .alterTable('api_keys')
    .addColumn('scopes', sql`text[]`, (col) =>
      col.notNull().defaultTo(sql`ARRAY['rest:read','rest:write']::text[]`),
    )
    .addColumn('last_used_ip', 'text')
    .addColumn('last_used_user_agent', 'text')
    .execute();

  await sql`
    UPDATE workspaces
    SET settings = jsonb_set(
      jsonb_set(COALESCE(settings, '{}'::jsonb), '{ai}', COALESCE(settings->'ai', '{}'::jsonb), true),
      '{ai,mcpMode}',
      to_jsonb(
        CASE
          WHEN settings->'ai'->>'mcp' = 'true' THEN 'read-write'
          ELSE 'off'
        END
      ),
      true
    )
  `.execute(db);
}

export async function down(db: Kysely<any>): Promise<void> {
  await db.schema
    .alterTable('api_keys')
    .dropColumn('last_used_user_agent')
    .dropColumn('last_used_ip')
    .dropColumn('scopes')
    .execute();

  await sql`
    UPDATE workspaces
    SET settings = jsonb_set(
      settings,
      '{ai}',
      COALESCE(settings->'ai', '{}'::jsonb) - 'mcpMode',
      true
    )
    WHERE settings ? 'ai'
  `.execute(db);
}
