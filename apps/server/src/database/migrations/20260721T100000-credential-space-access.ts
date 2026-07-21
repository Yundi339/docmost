import { type Kysely, sql } from 'kysely';

export async function up(db: Kysely<any>): Promise<void> {
  await db.schema
    .alterTable('api_keys')
    .addColumn('space_access_mode', 'varchar', (col) =>
      col.notNull().defaultTo('all'),
    )
    .execute();
  await db.schema
    .alterTable('api_keys')
    .addCheckConstraint(
      'api_keys_space_access_mode_check',
      sql`space_access_mode in ('all', 'selected')`,
    )
    .execute();

  await db.schema
    .alterTable('oauth_authorizations')
    .addColumn('space_access_mode', 'varchar', (col) =>
      col.notNull().defaultTo('all'),
    )
    .execute();
  await db.schema
    .alterTable('oauth_authorizations')
    .addCheckConstraint(
      'oauth_authorizations_space_access_mode_check',
      sql`space_access_mode in ('all', 'selected')`,
    )
    .execute();

  await db.schema
    .createTable('api_key_space_grants')
    .addColumn('api_key_id', 'uuid', (col) =>
      col.references('api_keys.id').onDelete('cascade').notNull(),
    )
    .addColumn('space_id', 'uuid', (col) =>
      col.references('spaces.id').onDelete('cascade').notNull(),
    )
    .addColumn('created_at', 'timestamptz', (col) =>
      col.notNull().defaultTo(sql`now()`),
    )
    .addPrimaryKeyConstraint('api_key_space_grants_pkey', [
      'api_key_id',
      'space_id',
    ])
    .execute();

  await db.schema
    .createIndex('idx_api_key_space_grants_space_id')
    .on('api_key_space_grants')
    .column('space_id')
    .execute();

  await db.schema
    .createTable('oauth_authorization_space_grants')
    .addColumn('authorization_id', 'uuid', (col) =>
      col.references('oauth_authorizations.id').onDelete('cascade').notNull(),
    )
    .addColumn('space_id', 'uuid', (col) =>
      col.references('spaces.id').onDelete('cascade').notNull(),
    )
    .addColumn('created_at', 'timestamptz', (col) =>
      col.notNull().defaultTo(sql`now()`),
    )
    .addPrimaryKeyConstraint('oauth_authorization_space_grants_pkey', [
      'authorization_id',
      'space_id',
    ])
    .execute();

  await db.schema
    .createIndex('idx_oauth_authorization_space_grants_space_id')
    .on('oauth_authorization_space_grants')
    .column('space_id')
    .execute();
}

export async function down(db: Kysely<any>): Promise<void> {
  await db.schema
    .dropTable('oauth_authorization_space_grants')
    .ifExists()
    .execute();
  await db.schema.dropTable('api_key_space_grants').ifExists().execute();

  await db.schema
    .alterTable('oauth_authorizations')
    .dropConstraint('oauth_authorizations_space_access_mode_check')
    .execute();
  await db.schema
    .alterTable('oauth_authorizations')
    .dropColumn('space_access_mode')
    .execute();

  await db.schema
    .alterTable('api_keys')
    .dropConstraint('api_keys_space_access_mode_check')
    .execute();
  await db.schema
    .alterTable('api_keys')
    .dropColumn('space_access_mode')
    .execute();
}
