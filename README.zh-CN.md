<div align="center">
    <h1><b>Docmost</b></h1>
    <p>
        开源协作 Wiki 与文档软件<br />
        <a href="README.zh-CN.md">中文</a> | <a href="README.md">English</a>
    </p>
</div>

---

## 功能

- 实时多人协作
- 图表支持（Draw.io、Excalidraw、Mermaid）
- 空间与权限管理
- 用户组与评论
- 页面历史记录与全文搜索
- 文件附件
- 嵌入内容（Airtable、Loom、Miro 等）
- 多语言界面（10+ 种语言）

## 快速启动（Docker）

### 使用 Docker Compose（推荐）

将以下内容保存为 `docker-compose.yml`，填写占位符后执行 `docker compose up -d`。

```yaml
services:
  docmost:
    image: docmost/docmost:latest
    depends_on:
      - db
      - redis
    environment:
      APP_URL: "http://localhost:3000"         # 改为实际的域名或 IP
      APP_SECRET: "REPLACE_WITH_LONG_SECRET"    # 至少 32 位：openssl rand -hex 32
      DATABASE_URL: "postgresql://docmost:STRONG_DB_PASSWORD@db:5432/docmost?schema=public"
      REDIS_URL: "redis://redis:6379"
      # DRAWIO_URL: "https://embed.diagrams.net" # 取消注释以启用 Draw.io（需要访问外网）
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
      POSTGRES_PASSWORD: STRONG_DB_PASSWORD     # 须与 DATABASE_URL 中一致
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

### 使用 Docker Run（已有数据库）

如果 PostgreSQL 和 Redis 已单独部署：

```bash
docker run -d \
  --name docmost \
  -p 3000:3000 \
  -e APP_URL="http://你的IP:3000" \
  -e APP_SECRET="至少32位的随机字符串" \
  -e DATABASE_URL="postgresql://用户名:密码@数据库主机:5432/数据库名?schema=public" \
  -e REDIS_URL="redis://redis主机:6379" \
  -e DISABLE_TELEMETRY="true" \
  -v docmost_storage:/app/data/storage \
  --restart unless-stopped \
  docmost/docmost:latest
```

### 关键环境变量

| 变量 | 必填 | 说明 |
|---|---|---|
| `APP_URL` | ✅ | 对外访问地址，用于 CORS 和链接生成 |
| `APP_SECRET` | ✅ | 签名密钥，至少 32 位字符 |
| `DATABASE_URL` | ✅ | PostgreSQL 连接字符串 |
| `REDIS_URL` | ✅ | Redis 连接字符串 |
| `JWT_TOKEN_EXPIRES_IN` | — | 登录会话有效期（默认 `30d`）|
| `DRAWIO_URL` | — | 启用 Draw.io 图表功能。默认不设置（禁用）。设为 `https://embed.diagrams.net` 使用官方在线版，或填写自建地址以支持离线环境 |
| `DISABLE_TELEMETRY` | — | 设为 `true` 关闭遥测数据上报 |
| `STORAGE_DRIVER` | — | `local`（默认）或 `s3` |
| `FILE_UPLOAD_SIZE_LIMIT` | — | 文件上传大小限制（默认 `50mb`）|

## 许可证

Docmost 核心代码基于 [AGPL 3.0](LICENSE) 开源。  
企业版功能受 Docmost 企业许可证约束，详见 `packages/ee/License`。
