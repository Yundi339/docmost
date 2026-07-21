import { type Kysely, sql } from 'kysely';

export async function up(db: Kysely<any>): Promise<void> {
  await db.schema
    .createTable('queue_outbox')
    .addColumn('id', 'uuid', (col) =>
      col.primaryKey().defaultTo(sql`gen_uuid_v7()`),
    )
    .addColumn('queue_name', 'varchar', (col) => col.notNull())
    .addColumn('job_name', 'varchar', (col) => col.notNull())
    .addColumn('job_id', 'varchar', (col) => col.notNull())
    .addColumn('payload', 'jsonb', (col) => col.notNull())
    .addColumn('attempts', 'integer', (col) => col.notNull().defaultTo(0))
    .addColumn('available_at', 'timestamptz', (col) =>
      col.notNull().defaultTo(sql`now()`),
    )
    .addColumn('dispatched_at', 'timestamptz')
    .addColumn('last_error', 'text')
    .addColumn('created_at', 'timestamptz', (col) =>
      col.notNull().defaultTo(sql`now()`),
    )
    .addColumn('updated_at', 'timestamptz', (col) =>
      col.notNull().defaultTo(sql`now()`),
    )
    .addUniqueConstraint('queue_outbox_queue_job_unique', [
      'queue_name',
      'job_id',
    ])
    .execute();

  await db.schema
    .createIndex('idx_queue_outbox_pending')
    .on('queue_outbox')
    .columns(['dispatched_at', 'available_at'])
    .execute();
}

export async function down(db: Kysely<any>): Promise<void> {
  await db.schema.dropTable('queue_outbox').ifExists().execute();
}
