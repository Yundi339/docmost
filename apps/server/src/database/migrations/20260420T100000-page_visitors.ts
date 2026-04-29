import { type Kysely, sql } from 'kysely';

export async function up(db: Kysely<any>): Promise<void> {
  await db.schema
    .createTable('page_visitors')
    .addColumn('id', 'uuid', (col) =>
      col.primaryKey().defaultTo(sql`gen_uuid_v7()`),
    )
    .addColumn('page_id', 'uuid', (col) =>
      col.references('pages.id').onDelete('cascade').notNull(),
    )
    // No FK on user_id so visits are preserved when a user is deleted.
    .addColumn('user_id', 'uuid', (col) => col.notNull())
    .addColumn('workspace_id', 'uuid', (col) =>
      col.references('workspaces.id').onDelete('cascade').notNull(),
    )
    .addColumn('first_visited_at', 'timestamptz', (col) =>
      col.notNull().defaultTo(sql`now()`),
    )
    .addColumn('last_visited_at', 'timestamptz', (col) =>
      col.notNull().defaultTo(sql`now()`),
    )
    .addColumn('visit_count', 'int4', (col) => col.notNull().defaultTo(1))
    .execute();

  // One row per (page, user) — drives UPSERT on visit recording.
  await db.schema
    .createIndex('uq_page_visitors_page_user')
    .on('page_visitors')
    .columns(['page_id', 'user_id'])
    .unique()
    .execute();

  // Owner's "visitor list" query orders by last_visited_at DESC per page.
  await sql`CREATE INDEX idx_page_visitors_page_last_visited
              ON page_visitors (page_id, last_visited_at DESC)`.execute(db);
}

export async function down(db: Kysely<any>): Promise<void> {
  await db.schema.dropTable('page_visitors').execute();
}
