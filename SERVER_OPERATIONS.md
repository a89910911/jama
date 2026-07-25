# Jama 云服务器部署与运维手册

本文档适用于 `jama.artisoul.top` 生产环境，配置状态核对日期为 2026-07-25。

> 安全要求：本文档不保存 SSH、MySQL 或宝塔密码。执行包含 `-p` 的 MySQL 命令时，应在提示后交互输入密码，不要把密码直接写进命令或脚本。

## 1. 生产环境信息

| 项目 | 配置 |
| --- | --- |
| 域名 | `https://jama.artisoul.top` |
| 服务器 | `101.35.214.179` |
| 项目根目录 | `/www/wwwroot/jama.artisoul.top` |
| 后端目录 | `/www/wwwroot/jama.artisoul.top/backend-node` |
| 前端构建目录 | `/www/wwwroot/jama.artisoul.top/frontweb/dist` |
| 持久化资源目录 | `/www/wwwroot/jama.artisoul.top/.deploy/shared/data` |
| 后端服务 | `jama.service` |
| 后端监听地址 | `127.0.0.1:5679` |
| 运行用户 | `jama:jama` |
| Node.js | `v20.20.2` |
| MySQL | `127.0.0.1:3306`，数据库 `jama-prod` |
| Nginx 配置 | `/www/server/panel/vhost/nginx/jama.artisoul.top.conf` |
| SSL 证书目录 | `/www/server/panel/vhost/cert/jama.artisoul.top/` |

### 1.1 开发与生产端口的区别

`frontweb` 的 `3013` 端口只用于本地开发：

```bash
cd frontweb
npm run dev
```

该命令启动 Vite 开发服务器，并将 `/api` 和 `/static` 请求代理到本地后端。开发环境通常同时运行：

| 服务 | 端口 | 用途 |
| --- | --- | --- |
| Vite 前端开发服务器 | `3013` | 热更新和前端源码调试 |
| Node.js 后端 | `5679` | API、数据库和资源处理 |

生产服务器不运行 Vite，也不需要监听或放行 `3013`。部署脚本会执行：

```bash
cd frontweb
npm run build
```

构建结果写入：

```text
/www/wwwroot/jama.artisoul.top/frontweb/dist
```

生产环境由 `jama.service` 启动 `127.0.0.1:5679` 上的 Node.js 后端，后端同时提供 API 和 `frontweb/dist` 中的前端页面。Nginx 负责对外提供 `80/443` 端口，并把普通请求转发给后端。

生产服务器的端口关系：

| 端口 | 是否对外 | 用途 |
| --- | --- | --- |
| `80` | 是 | HTTP 请求并跳转 HTTPS |
| `443` | 是 | 用户访问网站 |
| `5679` | 否，仅监听 `127.0.0.1` | Nginx 转发到 Node.js |
| `3013` | 不使用 | 只供本地 Vite 开发 |
| `3306` | 按安全组和 MySQL 权限控制 | MySQL；生产后端使用 `127.0.0.1` 连接 |

生产链路如下：

```text
浏览器
  -> 宝塔 Nginx（80/443）
     -> /static/*：Nginx 直接读取资源文件
     -> 其他请求：反向代理到 127.0.0.1:5679
        -> Node.js 后端 API
        -> Node.js 提供 frontweb/dist 前端页面
        -> Node.js 连接本机 MySQL
```

## 2. 登录服务器

在本地终端执行：

```bash
ssh root@101.35.214.179
```

登录后进入项目目录：

```bash
cd /www/wwwroot/jama.artisoul.top
```

## 3. 正常启动顺序

### 3.1 启动并检查 MySQL

宝塔 MySQL 使用 init 脚本管理：

```bash
/etc/init.d/mysqld start
/etc/init.d/mysqld status
```

正常状态应包含：

```text
SUCCESS! MySQL running
```

确认 3306 端口：

```bash
ss -lntp | grep ':3306'
```

### 3.2 启动后端

```bash
systemctl start jama.service
systemctl status jama.service --no-pager
```

服务已设置开机自启。如需重新启用：

```bash
systemctl enable jama.service
```

正常状态应为：

```text
Active: active (running)
```

确认后端端口：

```bash
ss -lntp | grep ':5679'
```

端口应只监听在 `127.0.0.1:5679`。

### 3.3 启动并检查 Nginx

宝塔 Nginx 使用 init 脚本管理：

```bash
/etc/init.d/nginx start
/etc/init.d/nginx status
```

修改 Nginx 配置后，必须先检查语法再平滑重载：

```bash
/www/server/nginx/sbin/nginx -t &&
/etc/init.d/nginx reload
```

不要根据 `systemctl status nginx` 判断宝塔 Nginx 是否运行；当前生产环境应使用 `/etc/init.d/nginx status`。

## 4. 一组完整的启动检查命令

服务器重启后可以依次执行：

```bash
/etc/init.d/mysqld start
systemctl start jama.service
/etc/init.d/nginx start

/etc/init.d/mysqld status
systemctl is-active jama.service
/etc/init.d/nginx status

curl -fsS http://127.0.0.1:5679/health
curl -fsS https://jama.artisoul.top/health
```

健康接口的正常响应：

```json
{"status":"ok","app":"JamaAI API","version":"1.0.0"}
```

## 5. 后端服务管理

`jama.service` 不是项目目录内的文件，其 systemd 主配置位于：

```text
/etc/systemd/system/jama.service
```

加载生产 MySQL 环境文件的附加配置位于：

```text
/etc/systemd/system/jama.service.d/mysql.conf
```

当前服务关键配置：

```ini
[Service]
User=jama
Group=jama
WorkingDirectory=/www/wwwroot/jama.artisoul.top/backend-node
ExecStart=/usr/bin/node src/server.js
Restart=always
RestartSec=5
```

MySQL 附加配置：

```ini
[Service]
EnvironmentFile=/www/wwwroot/jama.artisoul.top/backend-node/.env.mysql.prod
```

启动：

```bash
systemctl start jama.service
```

停止：

```bash
systemctl stop jama.service
```

重启：

```bash
systemctl restart jama.service
```

查看状态：

```bash
systemctl status jama.service --no-pager
```

查看是否开机自启：

```bash
systemctl is-enabled jama.service
```

查看 systemd 实际配置：

```bash
systemctl cat jama.service
```

当前主要配置文件：

```text
/etc/systemd/system/jama.service
/etc/systemd/system/jama.service.d/mysql.conf
```

修改以上文件后执行：

```bash
systemctl daemon-reload
systemctl restart jama.service
```

服务异常退出后会等待 5 秒自动重启。

## 6. 更新本地代码到远程服务器

### 6.1 发布工具

发布入口位于本地项目根目录：

```text
C:\Github\jama\deploy.ps1
```

SSH 上传和服务器切换逻辑位于：

```text
C:\Github\jama\tools\deploy_jama.py
```

发布目标默认为：

```text
root@101.35.214.179
/www/wwwroot/jama.artisoul.top
```

推荐始终从保存完整源码的 Windows 开发电脑执行脚本，不要通过宝塔文件管理器直接覆盖线上目录。

### 6.2 更新前检查

在 PowerShell 中进入项目目录：

```powershell
cd C:\Github\jama
```

检查本地修改：

```powershell
git status --short
```

脚本会发布当前工作目录中的实际文件，包括尚未提交的修改。未提交修改发布出的版本号会包含 `-dirty`。为了便于追溯，正式发布前建议先提交 Git。

确认本机工具可用：

```powershell
node --version
npm --version
python --version
```

首次运行时，如果本机没有脚本所需的 SSH Python 组件，脚本会自动安装到：

```text
%LOCALAPPDATA%\JamaDeploy\python
```

### 6.3 执行标准发布

运行：

```powershell
.\deploy.ps1
```

没有配置 SSH 私钥时，终端会提示：

```text
SSH password for root@101.35.214.179
```

交互输入服务器 SSH 密码即可。密码不会写入发布文件或命令行。

标准发布会自动完成：

1. 运行后端测试；
2. 运行前端测试；
3. 执行 `frontweb` 的生产构建；
4. 打包最新后端代码和 `frontweb/dist`；
5. 通过 SSH 上传发布包；
6. 保留服务器上的生产配置和 MySQL 环境文件；
7. 执行后端 `npm ci --omit=dev`；
8. 把当前线上前后端备份到 `.deploy/backups`；
9. 原子切换到新版本；
10. 重启 `jama.service`；
11. 检查本机后端和 HTTPS 域名；
12. 发布失败时自动恢复旧版本。

### 6.4 使用 SSH 私钥发布

如果已经配置 SSH 私钥：

```powershell
.\deploy.ps1 -IdentityFile C:\Users\你的用户名\.ssh\id_ed25519
```

脚本会校验服务器 SSH 主机指纹，指纹不一致时会拒绝继续，避免把代码上传到错误服务器。

### 6.5 跳过测试发布

只有在当前代码已经完整测试过时才使用：

```powershell
.\deploy.ps1 -SkipTests
```

该参数只跳过测试，仍会执行前端构建、上传、依赖安装、版本切换、服务重启和健康检查。

生产环境日常发布优先使用：

```powershell
.\deploy.ps1
```

### 6.6 发布成功标志

服务器发布成功时会输出类似：

```text
DEPLOYMENT_SUCCESS release=20260725-110321-2630247c31-dirty backup=/www/wwwroot/jama.artisoul.top/.deploy/backups/20260725-110321-2630247c31-dirty
Deployment completed successfully: https://jama.artisoul.top
```

其中：

- `release` 是本次发布编号；
- `backup` 是发布前线上版本的备份目录；
- `-dirty` 表示发布时本地存在未提交修改，不代表发布失败。

后端启动后的最初几次健康探测可能短暂出现连接失败；脚本会持续重试。最终出现 `DEPLOYMENT_SUCCESS` 才表示发布完成。

### 6.7 发布后服务器检查

登录服务器：

```bash
ssh root@101.35.214.179
```

检查后端：

```bash
systemctl is-active jama.service
systemctl status jama.service --no-pager
curl -fsS http://127.0.0.1:5679/health
```

检查公网访问：

```bash
curl -I https://jama.artisoul.top/
curl -fsS https://jama.artisoul.top/health
```

检查 MySQL 运行方式：

```bash
pid="$(systemctl show -p MainPID --value jama.service)"
tr '\0' '\n' < "/proc/$pid/environ" |
  grep -E '^(JAMA_DB_TYPE|JAMA_DB_HOST|JAMA_DB_PORT|JAMA_DB_NAME)='
```

生产环境预期为：

```text
JAMA_DB_TYPE=mysql
JAMA_DB_HOST=127.0.0.1
JAMA_DB_PORT=3306
JAMA_DB_NAME=jama-prod
```

检查资源目录没有被替换：

```bash
readlink -f /www/wwwroot/jama.artisoul.top/backend-node/data
```

预期输出：

```text
/www/wwwroot/jama.artisoul.top/.deploy/shared/data
```

### 6.8 发布时保留的服务器数据

以下内容不会被本地发布包覆盖：

| 内容 | 服务器位置 |
| --- | --- |
| MySQL 生产环境文件 | `backend-node/.env.mysql.prod` |
| 后端运行配置 | `backend-node/configs/` |
| 图片、音频和视频 | `.deploy/shared/data/storage/` |
| MySQL 业务数据 | 本机 MySQL 的 `jama-prod` 数据库 |
| 宝塔 Nginx 配置 | `/www/server/panel/vhost/nginx/jama.artisoul.top.conf` |
| 宝塔 SSL 证书 | `/www/server/panel/vhost/cert/jama.artisoul.top/` |

不要把 `.env.mysql.prod`、`.deploy/shared/data` 或 MySQL 数据目录加入发布包。

### 6.9 失败处理与自动回滚

- 测试或前端构建失败：不会连接或修改服务器；
- 上传或依赖安装失败：不会切换线上版本，原服务继续运行；
- 切换后启动或健康检查失败：脚本自动恢复上一个前后端版本；
- 同一时间已有发布任务：新任务会因部署锁而停止，避免两个版本同时切换。

失败时先查看终端中的第一条明确错误。确认问题已修复后重新运行：

```powershell
.\deploy.ps1
```

服务器后端日志：

```bash
journalctl -u jama.service -n 200 --no-pager
```

历史版本备份：

```text
/www/wwwroot/jama.artisoul.top/.deploy/backups/
```

脚本默认保留最近 5 个版本。可以在发布时调整：

```powershell
.\deploy.ps1 -KeepBackups 10
```

### 6.10 发布操作禁止事项

- 不要在生产服务器运行 `frontweb` 的 `npm run dev`；
- 不要为生产环境开放 `3013`；
- 不要直接删除或覆盖 `.deploy/shared/data`；
- 不要把数据库密码写进 Git、运维文档或命令行；
- 不要在 `jama.service` 运行时再手工启动另一个 Node.js 后端；
- 不要用宝塔文件管理器直接覆盖整个 `backend-node`；
- 不要在没有数据库备份的情况下执行带 `--replace` 的生产迁移。

## 7. MySQL 运行配置

MySQL 环境文件：

```text
/www/wwwroot/jama.artisoul.top/backend-node/.env.mysql.prod
```

systemd 通过以下文件加载它：

```text
/etc/systemd/system/jama.service.d/mysql.conf
```

生产环境变量结构：

```dotenv
JAMA_DB_TYPE=mysql
JAMA_DB_HOST=127.0.0.1
JAMA_DB_PORT=3306
JAMA_DB_USER=jama-prod
JAMA_DB_PASSWORD=请填写生产密码
JAMA_DB_NAME=jama-prod
JAMA_DB_CHARSET=utf8mb4
```

检查文件权限，不要直接输出文件内容：

```bash
stat -c '%a %U:%G %n' \
  /www/wwwroot/jama.artisoul.top/backend-node/.env.mysql.prod
```

正确权限应为：

```text
600 jama:jama
```

修复权限：

```bash
chown jama:jama \
  /www/wwwroot/jama.artisoul.top/backend-node/.env.mysql.prod
chmod 600 \
  /www/wwwroot/jama.artisoul.top/backend-node/.env.mysql.prod
systemctl restart jama.service
```

交互式检查 MySQL 是否响应：

```bash
/www/server/mysql/bin/mysqladmin \
  -h 127.0.0.1 -P 3306 -u jama-prod -p ping
```

不要随意执行带有 `--replace` 的迁移命令，它可能重建生产业务表。

## 8. 健康检查

后端本机检查：

```bash
curl -i http://127.0.0.1:5679/health
```

域名检查：

```bash
curl -I https://jama.artisoul.top/
curl -i https://jama.artisoul.top/health
```

静态资源检查：

```bash
curl -sS -o /dev/null -w 'HTTP %{http_code}\n' \
  -H 'Range: bytes=0-31' \
  'https://jama.artisoul.top/static/实际资源路径'
```

预期结果：

- 首页返回 HTTP `200`；
- `/health` 返回 HTTP `200` 和 `status: ok`；
- 视频等大文件的 Range 请求返回 HTTP `206`。

## 9. 日志查看

实时查看后端日志：

```bash
journalctl -u jama.service -f
```

查看最近 200 行：

```bash
journalctl -u jama.service -n 200 --no-pager
```

查看本次开机后的错误：

```bash
journalctl -u jama.service -b -p warning --no-pager
```

Nginx 访问日志：

```bash
tail -f /www/wwwlogs/jama.artisoul.top.log
```

Nginx 错误日志：

```bash
tail -f /www/wwwlogs/jama.artisoul.top.error.log
```

## 10. 资源文件与版本备份

后端中的 `data` 是持久化目录的软链接：

```text
/www/wwwroot/jama.artisoul.top/backend-node/data
  -> /www/wwwroot/jama.artisoul.top/.deploy/shared/data
```

检查链接：

```bash
readlink -f /www/wwwroot/jama.artisoul.top/backend-node/data
```

图片、音频和视频实际存放在：

```text
/www/wwwroot/jama.artisoul.top/.deploy/shared/data/storage
```

不要删除或覆盖 `.deploy/shared/data`。升级脚本只更换程序代码，不会把资源文件放进发布包。

历史版本备份：

```text
/www/wwwroot/jama.artisoul.top/.deploy/backups/
```

查看最近版本：

```bash
find /www/wwwroot/jama.artisoul.top/.deploy/backups \
  -mindepth 1 -maxdepth 1 -type d -printf '%T@ %f\n' |
  sort -nr |
  head
```

部署期间健康检查失败会自动回滚。需要手工回滚历史版本时，应先备份当前 MySQL，再由熟悉目录切换流程的维护人员操作，避免误删共享资源目录。

## 11. 临时前台启动

仅用于故障诊断。必须先停止 systemd 服务，避免 5679 端口冲突：

```bash
systemctl stop jama.service
cd /www/wwwroot/jama.artisoul.top/backend-node
runuser -u jama -- \
  /usr/bin/node --env-file=.env.mysql.prod src/server.js
```

观察完日志后按 `Ctrl+C` 结束，再恢复 systemd：

```bash
systemctl start jama.service
```

生产环境不要长期使用 `node`、`nohup` 或 `npm run dev` 手工驻留进程，应始终交给 `jama.service` 管理。

## 12. 常见故障处理

### 域名返回 502

通常是后端未启动或 5679 端口未监听：

```bash
systemctl status jama.service --no-pager
journalctl -u jama.service -n 200 --no-pager
ss -lntp | grep ':5679'
curl -i http://127.0.0.1:5679/health
```

### 后端提示 MySQL 连接失败

```bash
/etc/init.d/mysqld status
ss -lntp | grep ':3306'
stat -c '%a %U:%G %n' \
  /www/wwwroot/jama.artisoul.top/backend-node/.env.mysql.prod
journalctl -u jama.service -n 200 --no-pager
```

确认 MySQL 启动、环境文件权限为 `600 jama:jama`，然后重启后端。

### 图片、音频或视频返回 404

```bash
readlink -f /www/wwwroot/jama.artisoul.top/backend-node/data
ls -ld /www/wwwroot/jama.artisoul.top/.deploy/shared/data
/www/server/nginx/sbin/nginx -t
tail -n 100 /www/wwwlogs/jama.artisoul.top.error.log
```

资源链接必须解析到：

```text
/www/wwwroot/jama.artisoul.top/.deploy/shared/data
```

### 修改 Nginx 后无法访问

```bash
/www/server/nginx/sbin/nginx -t
/etc/init.d/nginx status
tail -n 100 /www/wwwlogs/jama.artisoul.top.error.log
```

只有在 `nginx -t` 成功后才能执行：

```bash
/etc/init.d/nginx reload
```

### 5679 端口被占用

```bash
ss -lntp | grep ':5679'
systemctl status jama.service --no-pager
```

不要同时运行 systemd 后端和手工启动的 Node.js 后端。

## 13. 运维完成后的检查清单

- [ ] `/etc/init.d/mysqld status` 显示 MySQL 正常；
- [ ] `systemctl is-active jama.service` 输出 `active`；
- [ ] `/etc/init.d/nginx status` 显示 Nginx 正常；
- [ ] 本机 `/health` 返回 `200`；
- [ ] 域名 `/health` 返回 `200`；
- [ ] 首页可以正常加载；
- [ ] 生产环境变量仍为 `JAMA_DB_TYPE=mysql`；
- [ ] MySQL 使用 `127.0.0.1:3306/jama-prod`；
- [ ] 资源目录链接仍指向 `.deploy/shared/data`；
- [ ] 日志没有持续出现新的错误。
