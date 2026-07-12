import { Kysely, sql } from 'kysely';

export async function up(db: Kysely<any>): Promise<void> {
  await db.schema
    .alterTable('shares')
    .addColumn('password_hash', 'varchar')
    .addColumn('password_version', 'integer', (col) =>
      col.notNull().defaultTo(0),
    )
    .addColumn('password_updated_at', 'timestamptz')
    .execute();

  await db.schema
    .alterTable('shares')
    .addCheckConstraint(
      'shares_password_version_non_negative',
      sql`password_version >= 0`,
    )
    .execute();
}

export async function down(db: Kysely<any>): Promise<void> {
  await db.schema
    .alterTable('shares')
    .dropConstraint('shares_password_version_non_negative')
    .execute();
  await db.schema
    .alterTable('shares')
    .dropColumn('password_updated_at')
    .dropColumn('password_version')
    .dropColumn('password_hash')
    .execute();
}
