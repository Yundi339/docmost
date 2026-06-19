import { type Kysely, sql } from 'kysely';

export async function up(db: Kysely<any>): Promise<void> {
  await db.schema
    .createTable('oauth_clients')
    .addColumn('id', 'uuid', (col) =>
      col.primaryKey().defaultTo(sql`gen_uuid_v7()`),
    )
    .addColumn('workspace_id', 'uuid', (col) =>
      col.references('workspaces.id').onDelete('cascade').notNull(),
    )
    .addColumn('creator_id', 'uuid', (col) =>
      col.references('users.id').onDelete('set null'),
    )
    .addColumn('provider', 'varchar', (col) => col.notNull())
    .addColumn('name', 'varchar', (col) => col.notNull())
    .addColumn('client_id', 'text')
    .addColumn('trusted_client_id_host', 'varchar', (col) =>
      col.notNull().defaultTo('chatgpt.com'),
    )
    .addColumn('allow_client_id_metadata_documents', 'boolean', (col) =>
      col.notNull().defaultTo(true),
    )
    .addColumn('allowed_scopes', sql`text[]`, (col) =>
      col.notNull().defaultTo(sql`ARRAY['mcp:read']::text[]`),
    )
    .addColumn('is_enabled', 'boolean', (col) => col.notNull().defaultTo(false))
    .addColumn('settings', 'jsonb', (col) => col.defaultTo(sql`'{}'::jsonb`))
    .addColumn('created_at', 'timestamptz', (col) =>
      col.notNull().defaultTo(sql`now()`),
    )
    .addColumn('updated_at', 'timestamptz', (col) =>
      col.notNull().defaultTo(sql`now()`),
    )
    .addColumn('deleted_at', 'timestamptz')
    .execute();

  await db.schema
    .createIndex('idx_oauth_clients_workspace_id')
    .on('oauth_clients')
    .column('workspace_id')
    .execute();

  await db.schema
    .createIndex('idx_oauth_clients_workspace_provider_unique')
    .on('oauth_clients')
    .columns(['workspace_id', 'provider'])
    .unique()
    .where(sql.ref('deleted_at'), 'is', null)
    .execute();

  await db.schema
    .createTable('oauth_authorizations')
    .addColumn('id', 'uuid', (col) =>
      col.primaryKey().defaultTo(sql`gen_uuid_v7()`),
    )
    .addColumn('workspace_id', 'uuid', (col) =>
      col.references('workspaces.id').onDelete('cascade').notNull(),
    )
    .addColumn('user_id', 'uuid', (col) =>
      col.references('users.id').onDelete('cascade').notNull(),
    )
    .addColumn('oauth_client_id', 'uuid', (col) =>
      col.references('oauth_clients.id').onDelete('set null'),
    )
    .addColumn('provider', 'varchar', (col) => col.notNull())
    .addColumn('client_id', 'text', (col) => col.notNull())
    .addColumn('client_name', 'varchar', (col) => col.notNull())
    .addColumn('client_uri', 'text')
    .addColumn('redirect_uri', 'text', (col) => col.notNull())
    .addColumn('resource', 'text', (col) => col.notNull())
    .addColumn('scopes', sql`text[]`, (col) => col.notNull())
    .addColumn('last_used_at', 'timestamptz')
    .addColumn('revoked_at', 'timestamptz')
    .addColumn('created_at', 'timestamptz', (col) =>
      col.notNull().defaultTo(sql`now()`),
    )
    .addColumn('updated_at', 'timestamptz', (col) =>
      col.notNull().defaultTo(sql`now()`),
    )
    .execute();

  await db.schema
    .createIndex('idx_oauth_authorizations_workspace_id')
    .on('oauth_authorizations')
    .column('workspace_id')
    .execute();

  await db.schema
    .createIndex('idx_oauth_authorizations_user_id')
    .on('oauth_authorizations')
    .column('user_id')
    .execute();

  await db.schema
    .createTable('oauth_authorization_codes')
    .addColumn('id', 'uuid', (col) =>
      col.primaryKey().defaultTo(sql`gen_uuid_v7()`),
    )
    .addColumn('code_hash', 'text', (col) => col.notNull().unique())
    .addColumn('workspace_id', 'uuid', (col) =>
      col.references('workspaces.id').onDelete('cascade').notNull(),
    )
    .addColumn('user_id', 'uuid', (col) =>
      col.references('users.id').onDelete('cascade').notNull(),
    )
    .addColumn('oauth_client_id', 'uuid', (col) =>
      col.references('oauth_clients.id').onDelete('set null'),
    )
    .addColumn('authorization_id', 'uuid', (col) =>
      col.references('oauth_authorizations.id').onDelete('cascade').notNull(),
    )
    .addColumn('client_id', 'text', (col) => col.notNull())
    .addColumn('redirect_uri', 'text', (col) => col.notNull())
    .addColumn('resource', 'text', (col) => col.notNull())
    .addColumn('scopes', sql`text[]`, (col) => col.notNull())
    .addColumn('code_challenge', 'text', (col) => col.notNull())
    .addColumn('code_challenge_method', 'varchar', (col) => col.notNull())
    .addColumn('expires_at', 'timestamptz', (col) => col.notNull())
    .addColumn('consumed_at', 'timestamptz')
    .addColumn('created_at', 'timestamptz', (col) =>
      col.notNull().defaultTo(sql`now()`),
    )
    .execute();

  await db.schema
    .createIndex('idx_oauth_authorization_codes_expires_at')
    .on('oauth_authorization_codes')
    .column('expires_at')
    .execute();

  await db.schema
    .createTable('oauth_refresh_tokens')
    .addColumn('id', 'uuid', (col) =>
      col.primaryKey().defaultTo(sql`gen_uuid_v7()`),
    )
    .addColumn('token_hash', 'text', (col) => col.notNull().unique())
    .addColumn('workspace_id', 'uuid', (col) =>
      col.references('workspaces.id').onDelete('cascade').notNull(),
    )
    .addColumn('user_id', 'uuid', (col) =>
      col.references('users.id').onDelete('cascade').notNull(),
    )
    .addColumn('oauth_client_id', 'uuid', (col) =>
      col.references('oauth_clients.id').onDelete('set null'),
    )
    .addColumn('authorization_id', 'uuid', (col) =>
      col.references('oauth_authorizations.id').onDelete('cascade').notNull(),
    )
    .addColumn('client_id', 'text', (col) => col.notNull())
    .addColumn('resource', 'text', (col) => col.notNull())
    .addColumn('scopes', sql`text[]`, (col) => col.notNull())
    .addColumn('expires_at', 'timestamptz', (col) => col.notNull())
    .addColumn('last_used_at', 'timestamptz')
    .addColumn('revoked_at', 'timestamptz')
    .addColumn('replaced_by_id', 'uuid')
    .addColumn('created_at', 'timestamptz', (col) =>
      col.notNull().defaultTo(sql`now()`),
    )
    .execute();

  await db.schema
    .createIndex('idx_oauth_refresh_tokens_authorization_id')
    .on('oauth_refresh_tokens')
    .column('authorization_id')
    .execute();
}

export async function down(db: Kysely<any>): Promise<void> {
  await db.schema.dropTable('oauth_refresh_tokens').execute();
  await db.schema.dropTable('oauth_authorization_codes').execute();
  await db.schema.dropTable('oauth_authorizations').execute();
  await db.schema.dropTable('oauth_clients').execute();
}
