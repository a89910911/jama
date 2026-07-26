# 一键更新服务器

在项目根目录打开 PowerShell，运行：

```powershell
.\deploy.ps1
```

脚本会依次执行：

1. 运行前后端测试；
2. 审计后端生产依赖；
3. 构建最新前端并检查 JavaScript 包体积；
4. 打包并通过 SSH 上传前后端；
5. 保留服务器上的 MySQL 环境文件、运行配置和 `data/` 资源目录；
6. 安装后端生产依赖；
7. 备份当前版本并切换到新版本；
8. 重启 `jama.service`，安静重试本机健康检查并验证 HTTPS；
9. 健康检查失败时自动恢复上一个版本。

默认使用 `root@101.35.214.179`，运行时只提示输入一次 SSH 密码。密码不会写入文件或命令行。

使用 SSH 私钥：

```powershell
.\deploy.ps1 -IdentityFile C:\Users\你的用户名\.ssh\id_ed25519
```

代码已经自行测试过时，可以跳过测试，但仍会重新构建前端：

```powershell
.\deploy.ps1 -SkipTests
```

只执行测试、依赖审计、构建和包体积检查，不连接服务器：

```powershell
.\deploy.ps1 -PreflightOnly
```

默认依赖审计会报告风险但不阻断现有发布；需要把高危或严重漏洞作为强制门禁时使用 `-StrictAudit`。仅在审计服务临时不可用且风险已另行确认时使用 `-SkipAudit`。

前端单个 JavaScript 文件默认超过 500 KiB 时警告，超过 2048 KiB 时阻止发布。可通过 `-BundleWarningKb` 和 `-BundleLimitKb` 调整。

服务器版本备份保存在：

```text
/www/wwwroot/jama.artisoul.top/.deploy/backups/
```

默认保留最近 5 个由该脚本生成的版本，可通过 `-KeepBackups` 调整。

生产数据库、图片、音频、视频资源和宝塔 Nginx/SSL 配置不包含在发布包中，因此部署代码时不会被覆盖。
