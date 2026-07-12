import { Kysely, sql } from 'kysely';

export async function up(db: Kysely<any>): Promise<void> {
  await db.schema
    .createTable('passkey_accounts')
    .addColumn('id', 'uuid', (col) =>
      col.primaryKey().defaultTo(sql`gen_uuid_v7()`),
    )
    .addColumn('workspace_id', 'uuid', (col) =>
      col.notNull().references('workspaces.id').onDelete('cascade'),
    )
    .addColumn('user_id', 'uuid', (col) =>
      col.notNull().references('users.id').onDelete('cascade').unique(),
    )
    .addColumn('user_handle', 'bytea', (col) => col.notNull().unique())
    .addColumn('created_at', 'timestamptz', (col) =>
      col.notNull().defaultTo(sql`now()`),
    )
    .addCheckConstraint(
      'passkey_accounts_user_handle_length_check',
      sql`octet_length(user_handle) = 64`,
    )
    .execute();

  await db.schema
    .createIndex('idx_passkey_accounts_workspace_user')
    .on('passkey_accounts')
    .columns(['workspace_id', 'user_id'])
    .execute();

  await db.schema
    .createTable('user_passkeys')
    .addColumn('id', 'uuid', (col) =>
      col.primaryKey().defaultTo(sql`gen_uuid_v7()`),
    )
    .addColumn('workspace_id', 'uuid', (col) =>
      col.notNull().references('workspaces.id').onDelete('cascade'),
    )
    .addColumn('user_id', 'uuid', (col) =>
      col.notNull().references('users.id').onDelete('cascade'),
    )
    .addColumn('credential_id', 'text', (col) => col.notNull().unique())
    .addColumn('public_key', 'bytea', (col) => col.notNull())
    .addColumn('counter', 'bigint', (col) => col.notNull().defaultTo(0))
    .addColumn('transports', sql`text[]`, (col) =>
      col.notNull().defaultTo(sql`ARRAY[]::text[]`),
    )
    .addColumn('device_type', 'varchar', (col) => col.notNull())
    .addColumn('backed_up', 'boolean', (col) => col.notNull())
    .addColumn('name', 'varchar(80)', (col) => col.notNull())
    .addColumn('disabled_at', 'timestamptz')
    .addColumn('disabled_reason', 'varchar(80)')
    .addColumn('last_used_at', 'timestamptz')
    .addColumn('created_at', 'timestamptz', (col) =>
      col.notNull().defaultTo(sql`now()`),
    )
    .addColumn('updated_at', 'timestamptz', (col) =>
      col.notNull().defaultTo(sql`now()`),
    )
    .addCheckConstraint(
      'user_passkeys_credential_id_length_check',
      sql`char_length(credential_id) BETWEEN 1 AND 2048`,
    )
    .addCheckConstraint('user_passkeys_counter_check', sql`counter >= 0`)
    .addCheckConstraint(
      'user_passkeys_device_type_check',
      sql`device_type IN ('singleDevice', 'multiDevice')`,
    )
    .addCheckConstraint(
      'user_passkeys_name_length_check',
      sql`char_length(btrim(name)) BETWEEN 1 AND 80`,
    )
    .execute();

  await db.schema
    .createIndex('idx_user_passkeys_workspace_user_created')
    .on('user_passkeys')
    .columns(['workspace_id', 'user_id', 'created_at'])
    .execute();

  await db.schema
    .createIndex('idx_user_passkeys_active_credential')
    .on('user_passkeys')
    .column('credential_id')
    .where(sql.ref('disabled_at'), 'is', null)
    .execute();

  await db.schema
    .createTable('passkey_challenges')
    .addColumn('id', 'text', (col) => col.primaryKey())
    .addColumn('workspace_id', 'uuid', (col) =>
      col.notNull().references('workspaces.id').onDelete('cascade'),
    )
    .addColumn('user_id', 'uuid', (col) =>
      col.references('users.id').onDelete('cascade'),
    )
    .addColumn('session_id', 'uuid', (col) =>
      col.references('user_sessions.id').onDelete('cascade'),
    )
    .addColumn('type', 'varchar', (col) => col.notNull())
    .addColumn('challenge', 'text', (col) => col.notNull().unique())
    .addColumn('expected_origin', 'text', (col) => col.notNull())
    .addColumn('rp_id', 'text', (col) => col.notNull())
    .addColumn('expires_at', 'timestamptz', (col) => col.notNull())
    .addColumn('created_at', 'timestamptz', (col) =>
      col.notNull().defaultTo(sql`now()`),
    )
    .addCheckConstraint(
      'passkey_challenges_type_check',
      sql`type IN ('registration', 'authentication', 'management')`,
    )
    .addCheckConstraint(
      'passkey_challenges_id_length_check',
      sql`char_length(id) BETWEEN 32 AND 128`,
    )
    .execute();

  await db.schema
    .createIndex('idx_passkey_challenges_expires_at')
    .on('passkey_challenges')
    .column('expires_at')
    .execute();

  await db.schema
    .createIndex('idx_passkey_challenges_session_type_unique')
    .on('passkey_challenges')
    .columns(['session_id', 'type'])
    .unique()
    .where('session_id', 'is not', null)
    .execute();

  await db.schema
    .createTable('auth_login_counters')
    .addColumn('id', 'uuid', (col) =>
      col.primaryKey().defaultTo(sql`gen_uuid_v7()`),
    )
    .addColumn('workspace_id', 'uuid', (col) =>
      col.notNull().references('workspaces.id').onDelete('cascade'),
    )
    .addColumn('user_id', 'uuid', (col) =>
      col.notNull().references('users.id').onDelete('cascade'),
    )
    .addColumn('method', 'varchar', (col) => col.notNull())
    .addColumn('failure_count', 'integer', (col) => col.notNull().defaultTo(0))
    .addColumn('window_started_at', 'timestamptz', (col) =>
      col.notNull().defaultTo(sql`now()`),
    )
    .addColumn('last_failed_at', 'timestamptz')
    .addColumn('locked_until', 'timestamptz')
    .addColumn('updated_at', 'timestamptz', (col) =>
      col.notNull().defaultTo(sql`now()`),
    )
    .addUniqueConstraint('auth_login_counters_user_method_unique', [
      'workspace_id',
      'user_id',
      'method',
    ])
    .addCheckConstraint(
      'auth_login_counters_method_check',
      sql`method IN ('password', 'passkey', 'mfa')`,
    )
    .addCheckConstraint(
      'auth_login_counters_failure_count_check',
      sql`failure_count >= 0`,
    )
    .execute();

  await db.schema
    .createIndex('idx_auth_login_counters_locked_until')
    .on('auth_login_counters')
    .column('locked_until')
    .where('locked_until', 'is not', null)
    .execute();
}

export async function down(db: Kysely<any>): Promise<void> {
  await db.schema.dropTable('auth_login_counters').execute();
  await db.schema.dropTable('passkey_challenges').execute();
  await db.schema.dropTable('user_passkeys').execute();
  await db.schema.dropTable('passkey_accounts').execute();
}
