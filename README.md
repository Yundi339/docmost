<div align="center">
    <h1><b>Docmost</b></h1>
    <p>
        Open-source collaborative wiki and documentation software.<br />
        <a href="README.zh-CN.md">中文</a> | <a href="README.md">English</a>
    </p>
</div>

---

## Features

- Real-time collaboration
- Diagrams (Draw.io, Excalidraw, Mermaid)
- Spaces & permissions management
- Groups and comments
- Page history & search
- File attachments
- Embeds (Airtable, Loom, Miro and more)
- Translations (10+ languages)

## Quick Start (Docker)

### Using Docker Compose (recommended)

Save the following as `docker-compose.yml`, fill in the placeholder values, then run `docker compose up -d`.

```yaml
services:
  docmost:
    image: docmost/docmost:latest
    depends_on:
      - db
      - redis
    environment:
      APP_URL: "http://localhost:3000"         # Change to your actual domain or IP
      APP_SECRET: "REPLACE_WITH_LONG_SECRET"    # Min 32 chars: openssl rand -hex 32
      DATABASE_URL: "postgresql://docmost:STRONG_DB_PASSWORD@db:5432/docmost?schema=public"
      REDIS_URL: "redis://redis:6379"
      # DRAWIO_URL: "https://embed.diagrams.net" # Uncomment to enable Draw.io (requires internet access)
      DISABLE_TELEMETRY: "true"
    ports:
      - "3000:3000"
    restart: unless-stopped
    volumes:
      - docmost_data:/app/data/storage

  db:
    image: postgres:16-alpine
    environment:
      POSTGRES_DB: docmost
      POSTGRES_USER: docmost
      POSTGRES_PASSWORD: STRONG_DB_PASSWORD     # Must match DATABASE_URL above
    restart: unless-stopped
    volumes:
      - db_data:/var/lib/postgresql/data

  redis:
    image: redis:7-alpine
    command: ["redis-server", "--appendonly", "yes", "--maxmemory-policy", "noeviction"]
    restart: unless-stopped
    volumes:
      - redis_data:/data

volumes:
  docmost_data:
  db_data:
  redis_data:
```

### Using Docker Run (existing database)

If you already have PostgreSQL and Redis running:

```bash
docker run -d \
  --name docmost \
  -p 3000:3000 \
  -e APP_URL="http://your-ip:3000" \
  -e APP_SECRET="your-secret-min-32-chars" \
  -e DATABASE_URL="postgresql://user:password@db-host:5432/dbname?schema=public" \
  -e REDIS_URL="redis://redis-host:6379" \
  -e DISABLE_TELEMETRY="true" \
  -v docmost_storage:/app/data/storage \
  --restart unless-stopped \
  docmost/docmost:latest
```

### Key environment variables

| Variable | Required | Description |
|---|---|---|
| `APP_URL` | ✅ | Public URL used for CORS and links |
| `APP_SECRET` | ✅ | Secret key ≥ 32 characters |
| `DATABASE_URL` | ✅ | PostgreSQL connection string |
| `REDIS_URL` | ✅ | Redis connection string |
| `JWT_TOKEN_EXPIRES_IN` | — | Session expiry (default: `30d`) |
| `DRAWIO_URL` | — | Enable Draw.io diagrams. Unset by default (disabled). Set to `https://embed.diagrams.net` for the official hosted editor, or a self-hosted URL for air-gapped environments |
| `DISABLE_TELEMETRY` | — | Set `true` to opt out of telemetry |
| `STORAGE_DRIVER` | — | `local` (default) or `s3` |
| `FILE_UPLOAD_SIZE_LIMIT` | — | Max upload size (default: `50mb`) |

## License

Docmost core is licensed under [AGPL 3.0](LICENSE).  
Enterprise features are under the Docmost Enterprise license — see `packages/ee/License`.

