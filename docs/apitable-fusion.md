# Docmost Fusion Databases

This branch adds a Docmost-native database block with an APITable-compatible adapter boundary.

## Recommended storage model

The default and recommended mode is now **Docmost-native storage**:

- database block bindings live in `database_blocks`;
- records/cards/tasks live in `database_records` inside Docmost PostgreSQL;
- fields and views are stored on the database block as JSON schema metadata;
- Docmost page/space permissions are checked before every database operation;
- APITable remains an optional compatibility provider for import/sync/advanced view fallback.

This keeps the collaborator-friendly deployment model where all primary Docmost data stays in the Docmost database, while preserving a clean APITable adapter surface.

## Local Docmost compose

The regular compose starts Docmost, PostgreSQL, and Redis:

```bash
docker compose up -d --build
```

With `APITABLE_ENABLED=false` or unset, `/tasks`, `/kanban`, and `/database` create native Docmost records in PostgreSQL.

## Optional APITable sidecar

If you want to validate against APITable as an external compatibility provider, run the overlay:

```bash
docker compose -f docker-compose.yml -f docker-compose.apitable.yml up -d --build
```

Then create an APITable API token and space id in APITable and set:

- `APITABLE_ENABLED=true`
- `APITABLE_PUBLIC_URL=http://localhost:8081`
- `APITABLE_INTERNAL_URL=http://apitable`
- `APITABLE_API_TOKEN=<token>`
- `APITABLE_SPACE_ID=<space id>`

The APITable token is only used by the Docmost server and is never exposed to the browser.

## Production APITable deployment

For production-grade APITable, prefer the upstream multi-service Docker Compose package rather than the lightweight all-in-one/demo image:

```bash
curl -fsSL https://apitable.github.io/install.sh | bash
```

Point Docmost to that APITable instance with the `APITABLE_*` variables above. Keep Docmost-native storage as the primary source of truth unless you explicitly choose APITable-backed datasheets for a workspace.
