import { createHash } from 'crypto';
import { type Kysely, sql } from 'kysely';

const authorizationKey = (clientId: string, resource: string) =>
  createHash('sha256')
    .update(`${clientId.length}:${clientId}${resource}`)
    .digest('hex');

export async function up(db: Kysely<any>): Promise<void> {
  await db.schema
    .createTable('oauth_registered_clients')
    .addColumn('id', 'uuid', (col) =>
      col.primaryKey().defaultTo(sql`gen_uuid_v7()`),
    )
    .addColumn('oauth_client_id', 'uuid', (col) =>
      col.references('oauth_clients.id').onDelete('cascade').notNull(),
    )
    .addColumn('client_id', 'text', (col) => col.notNull().unique())
    .addColumn('client_name', 'varchar', (col) => col.notNull())
    .addColumn('client_uri', 'text')
    .addColumn('redirect_uris', sql`text[]`, (col) => col.notNull())
    .addColumn('grant_types', sql`text[]`, (col) => col.notNull())
    .addColumn('response_types', sql`text[]`, (col) => col.notNull())
    .addColumn('token_endpoint_auth_method', 'varchar', (col) =>
      col.notNull().defaultTo('none'),
    )
    .addColumn('scopes', sql`text[]`, (col) => col.notNull())
    .addColumn('created_at', 'timestamptz', (col) =>
      col.notNull().defaultTo(sql`now()`),
    )
    .addColumn('updated_at', 'timestamptz', (col) =>
      col.notNull().defaultTo(sql`now()`),
    )
    .addCheckConstraint(
      'oauth_registered_clients_redirect_uris_count_check',
      sql`cardinality(redirect_uris) between 1 and 10`,
    )
    .addCheckConstraint(
      'oauth_registered_clients_token_auth_method_check',
      sql`token_endpoint_auth_method = 'none'`,
    )
    .execute();

  await db.schema
    .createIndex('idx_oauth_registered_clients_oauth_client_id')
    .on('oauth_registered_clients')
    .column('oauth_client_id')
    .execute();

  await sql`
    insert into oauth_registered_clients (
      oauth_client_id,
      client_id,
      client_name,
      client_uri,
      redirect_uris,
      grant_types,
      response_types,
      token_endpoint_auth_method,
      scopes,
      created_at,
      updated_at
    )
    select
      oc.id,
      registration ->> 'clientId',
      registration ->> 'clientName',
      nullif(registration ->> 'clientUri', ''),
      array(
        select jsonb_array_elements_text(registration -> 'redirectUris')
      ),
      case
        when jsonb_typeof(registration -> 'grantTypes') = 'array'
          and jsonb_array_length(registration -> 'grantTypes') > 0
        then array(
          select jsonb_array_elements_text(registration -> 'grantTypes')
        )
        else array['authorization_code', 'refresh_token']::text[]
      end,
      case
        when jsonb_typeof(registration -> 'responseTypes') = 'array'
          and jsonb_array_length(registration -> 'responseTypes') > 0
        then array(
          select jsonb_array_elements_text(registration -> 'responseTypes')
        )
        else array['code']::text[]
      end,
      'none',
      array(
        select jsonb_array_elements_text(registration -> 'scopes')
      ),
      oc.created_at,
      oc.updated_at
    from oauth_clients oc
    cross join lateral jsonb_array_elements(
      case
        when jsonb_typeof(oc.settings -> 'dcrClients') = 'array'
        then oc.settings -> 'dcrClients'
        else '[]'::jsonb
      end
    ) registration
    where nullif(registration ->> 'clientId', '') is not null
      and nullif(registration ->> 'clientName', '') is not null
      and jsonb_typeof(registration -> 'redirectUris') = 'array'
      and jsonb_array_length(registration -> 'redirectUris') between 1 and 10
      and jsonb_typeof(registration -> 'scopes') = 'array'
      and jsonb_array_length(registration -> 'scopes') > 0
    on conflict (client_id) do nothing
  `.execute(db);

  await db.schema
    .alterTable('oauth_authorizations')
    .addColumn('authorization_key', 'varchar(64)')
    .execute();

  const authorizations = await db
    .selectFrom('oauth_authorizations')
    .select(['id', 'client_id', 'resource'])
    .execute();

  for (const authorization of authorizations) {
    await db
      .updateTable('oauth_authorizations')
      .set({
        authorization_key: authorizationKey(
          authorization.client_id,
          authorization.resource,
        ),
      })
      .where('id', '=', authorization.id)
      .execute();
  }

  await db.schema
    .alterTable('oauth_authorizations')
    .alterColumn('authorization_key', (col) => col.setNotNull())
    .execute();

  await sql`
    with ranked as (
      select
        id,
        row_number() over (
          partition by workspace_id, user_id, authorization_key
          order by updated_at desc, created_at desc, id desc
        ) as row_number
      from oauth_authorizations
      where revoked_at is null
    )
    update oauth_refresh_tokens as refresh_token
    set revoked_at = coalesce(refresh_token.revoked_at, now())
    from ranked
    where ranked.row_number > 1
      and refresh_token.authorization_id = ranked.id
      and refresh_token.revoked_at is null
  `.execute(db);

  await sql`
    with ranked as (
      select
        id,
        row_number() over (
          partition by workspace_id, user_id, authorization_key
          order by updated_at desc, created_at desc, id desc
        ) as row_number
      from oauth_authorizations
      where revoked_at is null
    )
    update oauth_authorizations as active_authorization
    set revoked_at = now(), updated_at = now()
    from ranked
    where ranked.row_number > 1
      and active_authorization.id = ranked.id
  `.execute(db);

  await db.schema
    .createIndex('idx_oauth_authorizations_active_identity_unique')
    .on('oauth_authorizations')
    .columns(['workspace_id', 'user_id', 'authorization_key'])
    .unique()
    .where(sql.ref('revoked_at'), 'is', null)
    .execute();
}

export async function down(db: Kysely<any>): Promise<void> {
  await sql`
    update oauth_clients as oauth_client
    set settings = jsonb_set(
      coalesce(oauth_client.settings, '{}'::jsonb),
      '{dcrClients}',
      registrations.items,
      true
    )
    from (
      select
        oauth_client_id,
        jsonb_agg(
          jsonb_build_object(
            'clientId', client_id,
            'clientName', client_name,
            'clientUri', client_uri,
            'redirectUris', to_jsonb(redirect_uris),
            'grantTypes', to_jsonb(grant_types),
            'responseTypes', to_jsonb(response_types),
            'tokenEndpointAuthMethod', token_endpoint_auth_method,
            'scopes', to_jsonb(scopes),
            'createdAt', created_at,
            'updatedAt', updated_at
          ) order by created_at desc
        ) as items
      from oauth_registered_clients
      group by oauth_client_id
    ) registrations
    where oauth_client.id = registrations.oauth_client_id
  `.execute(db);

  await db.schema
    .dropIndex('idx_oauth_authorizations_active_identity_unique')
    .execute();
  await db.schema
    .alterTable('oauth_authorizations')
    .dropColumn('authorization_key')
    .execute();
  await db.schema.dropTable('oauth_registered_clients').execute();
}
