import { Kysely, sql } from 'kysely';

export async function up(db: Kysely<any>): Promise<void> {
  await sql`
    update database_records as record
    set deleted_at = now(), updated_at = now()
    from database_blocks as database, pages as page, pages as host_page
    where record.database_id = database.id
      and record.page_id = page.id
      and host_page.id = database.page_id
      and record.deleted_at is null
      and (
        database.deleted_at is not null
        or record.page_id = database.page_id
        or record.workspace_id <> database.workspace_id
        or record.space_id <> database.space_id
        or page.workspace_id <> database.workspace_id
        or page.space_id <> database.space_id
        or host_page.workspace_id <> database.workspace_id
        or host_page.space_id <> database.space_id
      )
  `.execute(db);

  await sql`
    with recursive membership_ancestors as (
      select
        record.id as record_id,
        database.page_id as page_id,
        page.parent_page_id,
        array[database.page_id]::uuid[] as path
      from database_records as record
      inner join database_blocks as database
        on database.id = record.database_id
       and database.deleted_at is null
      inner join pages as page on page.id = database.page_id
      where record.deleted_at is null

      union all

      select
        ancestor.record_id,
        parent.id,
        parent.parent_page_id,
        ancestor.path || parent.id
      from membership_ancestors as ancestor
      inner join pages as parent on parent.id = ancestor.parent_page_id
      where not parent.id = any(ancestor.path)
    ), cyclic_memberships as (
      select distinct record.id
      from database_records as record
      inner join membership_ancestors as ancestor
        on ancestor.record_id = record.id
       and ancestor.page_id = record.page_id
      where record.deleted_at is null
    )
    update database_records as record
    set deleted_at = now(), updated_at = now()
    from cyclic_memberships
    where record.id = cyclic_memberships.id
  `.execute(db);

  await sql`
    with ranked_memberships as (
      select
        id,
        row_number() over (
          partition by page_id
          order by updated_at desc, created_at desc, id desc
        ) as row_number
      from database_records
      where deleted_at is null
    )
    update database_records as record
    set deleted_at = now(), updated_at = now()
    from ranked_memberships
    where ranked_memberships.id = record.id
      and ranked_memberships.row_number > 1
  `.execute(db);

  await sql`
    update pages as page
    set parent_page_id = database.page_id,
        updated_at = now()
    from database_records as record
    inner join database_blocks as database
      on database.id = record.database_id
     and database.deleted_at is null
    where page.id = record.page_id
      and record.deleted_at is null
      and page.workspace_id = database.workspace_id
      and page.space_id = database.space_id
      and page.parent_page_id is distinct from database.page_id
  `.execute(db);

  await db.schema
    .createIndex('idx_database_records_active_page_unique')
    .on('database_records')
    .column('page_id')
    .unique()
    .where(sql.ref('deleted_at'), 'is', null)
    .execute();
}

export async function down(db: Kysely<any>): Promise<void> {
  await db.schema
    .dropIndex('idx_database_records_active_page_unique')
    .ifExists()
    .execute();
}
