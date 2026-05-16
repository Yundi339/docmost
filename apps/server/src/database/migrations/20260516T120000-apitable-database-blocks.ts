import { Kysely, sql } from 'kysely';

export async function up(db: Kysely<any>): Promise<void> {
  await db.schema
    .createTable('database_blocks')
    .addColumn('id', 'uuid', (col) =>
      col.primaryKey().defaultTo(sql`gen_uuid_v7()`),
    )
    .addColumn('block_id', 'varchar', (col) => col.notNull())
    .addColumn('page_id', 'uuid', (col) =>
      col.references('pages.id').onDelete('cascade').notNull(),
    )
    .addColumn('space_id', 'uuid', (col) =>
      col.references('spaces.id').onDelete('cascade').notNull(),
    )
    .addColumn('workspace_id', 'uuid', (col) =>
      col.references('workspaces.id').onDelete('cascade').notNull(),
    )
    .addColumn('created_by_id', 'uuid', (col) => col.references('users.id'))
    .addColumn('updated_by_id', 'uuid', (col) => col.references('users.id'))
    .addColumn('title', 'varchar', (col) => col.notNull())
    .addColumn('template', 'varchar', (col) => col.notNull())
    .addColumn('active_view_id', 'varchar', (col) => col.notNull())
    .addColumn('apitable_datasheet_id', 'varchar')
    .addColumn('apitable_view_id', 'varchar')
    .addColumn('fields', 'jsonb', (col) => col.notNull().defaultTo(sql`'[]'::jsonb`))
    .addColumn('views', 'jsonb', (col) => col.notNull().defaultTo(sql`'[]'::jsonb`))
    .addColumn('metadata', 'jsonb', (col) => col.notNull().defaultTo(sql`'{}'::jsonb`))
    .addColumn('created_at', 'timestamptz', (col) =>
      col.notNull().defaultTo(sql`now()`),
    )
    .addColumn('updated_at', 'timestamptz', (col) =>
      col.notNull().defaultTo(sql`now()`),
    )
    .addColumn('deleted_at', 'timestamptz')
    .addUniqueConstraint('database_blocks_page_block_unique', [
      'page_id',
      'block_id',
    ])
    .execute();

  await db.schema
    .createIndex('database_blocks_page_id_idx')
    .on('database_blocks')
    .column('page_id')
    .execute();

  await db.schema
    .createIndex('database_blocks_workspace_id_idx')
    .on('database_blocks')
    .column('workspace_id')
    .execute();

  await db.schema
    .createTable('database_user_mappings')
    .addColumn('id', 'uuid', (col) =>
      col.primaryKey().defaultTo(sql`gen_uuid_v7()`),
    )
    .addColumn('workspace_id', 'uuid', (col) =>
      col.references('workspaces.id').onDelete('cascade').notNull(),
    )
    .addColumn('docmost_user_id', 'uuid', (col) =>
      col.references('users.id').onDelete('cascade').notNull(),
    )
    .addColumn('apitable_unit_id', 'varchar')
    .addColumn('metadata', 'jsonb', (col) => col.notNull().defaultTo(sql`'{}'::jsonb`))
    .addColumn('created_at', 'timestamptz', (col) =>
      col.notNull().defaultTo(sql`now()`),
    )
    .addColumn('updated_at', 'timestamptz', (col) =>
      col.notNull().defaultTo(sql`now()`),
    )
    .addUniqueConstraint('database_user_mappings_docmost_user_unique', [
      'workspace_id',
      'docmost_user_id',
    ])
    .execute();
}

export async function down(db: Kysely<any>): Promise<void> {
  await db.schema.dropTable('database_user_mappings').ifExists().execute();
  await db.schema.dropTable('database_blocks').ifExists().execute();
}
