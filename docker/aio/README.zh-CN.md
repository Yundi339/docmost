# Docmost All-in-One (AIO) 容器

将 **Docmost + PostgreSQL + Redis** 打包进单个容器，由 `supervisord` 统一管理进程。
适用于不希望单独运维数据库与缓存的小型 / 单机部署场景。

## 安全模型

- **PostgreSQL** 仅在容器内监听 `127.0.0.1:5432`：**不**对宿主机发布端口，
  也不可从其他 Docker 网络访问。
- **Redis** 仅在容器内监听 `127.0.0.1:6379`，同上。
- 数据库密码与 `APP_SECRET` 在容器**首次启动时**由 `openssl rand` 生成，
  以 `0600` 权限持久化到 `/app/data/aio/secrets.env`。
  这些密钥**不会**出现在宿主命令行或 `docker inspect` 中。
- 所有持久化状态（数据库、Redis AOF、上传文件、密钥）都在 `/app/data` 下，
  挂一个 Docker 卷即可。

## 持久化布局

容器重启需要保留的内容全部位于 `/app/data`：

| 路径                          | 内容                                   |
| ----------------------------- | -------------------------------------- |
| `/app/data/postgres`          | PostgreSQL 数据目录（`PGDATA`）        |
| `/app/data/redis`             | Redis AOF（`appendonly yes`）          |
| `/app/data/storage`           | Docmost 上传 / 附件                    |
| `/app/data/aio/secrets.env`   | 自动生成的 DB 密码与 APP_SECRET（0600）|

只要挂载 `-v docmost-aio-data:/app/data` 即可覆盖全部状态。

## 优雅关闭

`tini`（PID 1）将 `SIGTERM` 转发给 `supervisord`，`supervisord` 按反向启动顺序停止进程：

1. **docmost**（`SIGTERM`，最多 30s）— 排空 HTTP 请求，关闭数据库 / Redis 连接池。
2. **redis**（`SIGTERM`，最多 30s）— 刷新 AOF 后退出。
3. **postgres**（`SIGINT`，最多 60s）— *fast shutdown*：取消活动查询，
   执行最后一次 checkpoint，刷 WAL，干净退出。

最坏情况合计约 120s。Docker 的 `docker stop` 默认超时只有 **10s**，
请使用提供的脚本（已设置 `--stop-timeout 120`）或手动指定超时：

```bash
docker stop -t 120 docmost
```

如果 Docker 在 postgres 完成 checkpoint 之前就发了 `SIGKILL`，你**可能丢失**
最近未刷盘的事务。（PostgreSQL 是崩溃安全的，下次启动会通过 WAL 自动恢复，
但留出时间做 checkpoint 可以避免恢复开销。）

## 快速开始

```bash
# 拉取（或本地构建）镜像后，使用脚本启动：
./scripts/docmost-aio-run.sh
```

通过环境变量自定义常用参数：

```bash
APP_URL=https://docs.example.com PORT=8080 ./scripts/docmost-aio-run.sh
```

只打印 `docker run` 命令而不执行：

```bash
./scripts/docmost-aio-run.sh --print
```

支持的环境变量：

| 变量          | 默认值                        | 说明                              |
| ------------- | ----------------------------- | --------------------------------- |
| `IMAGE`       | `docmost-aio:latest`          | 要运行的镜像                      |
| `CONTAINER`   | `docmost`                     | 容器名                            |
| `PORT`        | `3000`                        | 宿主机发布端口                    |
| `APP_URL`     | `http://localhost:${PORT}`    | 实例的对外 URL                    |
| `VOLUME`      | `docmost-aio-data`            | 持久化数据使用的命名卷            |
| `RESTART`     | `unless-stopped`              | 重启策略                          |
| `EXTRA_ARGS`  | *(空)*                        | 追加给 `docker run` 的额外参数    |

## 本地构建

```bash
docker build -f docker/aio/Dockerfile -t docmost-aio:local .
IMAGE=docmost-aio:local ./scripts/docmost-aio-run.sh
```

## 通过 GitHub Actions 构建

使用 **AIO (All-in-One) Image** 工作流（手动 dispatch）。可选输入：

- `ref`：要构建的 branch / tag / SHA（默认当前 ref）。
- `tag`：镜像 tag 后缀（默认 branch 名）。
- `push`：为 `true` 时推送到 `ghcr.io/<owner>/docmost-aio`。

每次运行会上传镜像 `.tar.gz`（amd64 与 arm64）以及启动脚本作为构件。

## 找回 / 查看自动生成的密钥

如果你需要从宿主机查看自动生成的 DB 密码：

```bash
docker exec docmost cat /app/data/aio/secrets.env
```

⚠️ 不要随意修改或删除该文件——它是 PostgreSQL 角色密码的唯一真源，
丢失后将无法连接到数据库。

## 文件清单

```
docker/aio/
  Dockerfile          # 打包 app + postgres + redis + supervisord
  supervisord.conf    # 进程管理配置（含关闭顺序与信号）
  entrypoint.sh       # 生成密钥、初始化 postgres
  init-postgres.sh    # 仅首次启动：initdb + 创建角色 / 数据库
  start-app.sh        # 等待依赖就绪后启动 docmost
  redis.conf          # 仅监听 127.0.0.1 的 Redis 配置
  README.md           # 英文文档
  README.zh-CN.md     # 本文档
scripts/
  docmost-aio-run.sh  # 宿主机辅助脚本：构造并执行 docker run 命令
```
