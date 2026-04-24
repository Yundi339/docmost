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

```yaml
services:
  docmost:
    build: .
    depends_on:
      - db
      - redis
    environment:
      APP_URL: "http://localhost:3000"
      APP_SECRET: "changeme"
      DATABASE_URL: "postgresql://docmost:docmost@db:5432/docmost"
      REDIS_URL: "redis://redis:6379"
    ports:
      - "3000:3000"
    volumes:
      - docmost_data:/app/data/storage

  db:
    image: postgres:16-alpine
    environment:
      POSTGRES_DB: docmost
      POSTGRES_USER: docmost
      POSTGRES_PASSWORD: docmost
    volumes:
      - db_data:/var/lib/postgresql/data

  redis:
    image: redis:7-alpine
    volumes:
      - redis_data:/data

volumes:
  docmost_data:
  db_data:
  redis_data:
```

## 许可证

Docmost 核心代码基于 [AGPL 3.0](LICENSE) 开源。  
企业版功能受 Docmost 企业许可证约束，详见 `packages/ee/License`。
