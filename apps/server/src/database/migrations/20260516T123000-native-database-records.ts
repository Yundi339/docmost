import { Kysely, sql } from 'kysely';

export async function up(db: Kysely<any>): Promise<void> {
  await db.schema
    .createTable('database_records')
    .addColumn('id', 'uuid', (col) =>
      col.primaryKey().defaultTo(sql`gen_uuid_v7()`),
    )
    .addColumn('database_id', 'uuid', (col) =>
      col.references('database_blocks.id').onDelete('cascade').notNull(),
    )
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
    .addColumn('apitable_record_id', 'varchar')
    .addColumn('fields', 'jsonb', (col) => col.notNull().defaultTo(sql`'{}'::jsonb`))
    .addColumn('sort_order', 'varchar')
    .addColumn('created_at', 'timestamptz', (col) =>
      col.notNull().defaultTo(sql`now()`),
    )
    .addColumn('updated_at', 'timestamptz', (col) =>
      col.notNull().defaultTo(sql`now()`),
    )
    .addColumn('deleted_at', 'timestamptz')
    .execute();

  await db.schema
    .createIndex('database_records_database_id_idx')
    .on('database_records')
    .column('database_id')
    .execute();

  await db.schema
    .createIndex('database_records_workspace_id_idx')
    .on('database_records')
    .column('workspace_id')
    .execute();

  await db.schema
    .createIndex('database_records_page_id_idx')
    .on('database_records')
    .column('page_id')
    .execute();
}

export async function down(db: Kysely<any>): Promise<void> {
  await db.schema.dropTable('database_records').ifExists().execute();
}
