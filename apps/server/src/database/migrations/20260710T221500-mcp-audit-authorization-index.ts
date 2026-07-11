import { type Kysely, sql } from 'kysely';

export async function up(db: Kysely<any>): Promise<void> {
  await sql`
    CREATE INDEX IF NOT EXISTS idx_audit_mcp_authorization_user_id
    ON audit ((metadata ->> 'authorizationUserId'))
    WHERE resource_type = 'mcp_oauth_authorization'
  `.execute(db);
}

export async function down(db: Kysely<any>): Promise<void> {
  await sql`DROP INDEX IF EXISTS idx_audit_mcp_authorization_user_id`.execute(db);
}
