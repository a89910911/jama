# 一键更新服务器

在项目根目录打开 PowerShell，运行：

```powershell
.\deploy.ps1
```

脚本会依次执行：

1. 运行前后端测试；
2. 构建最新前端；
3. 打包并通过 SSH 上传前后端；
4. 保留服务器上的 MySQL 环境文件、运行配置和 `data/` 资源目录；
5. 安装后端生产依赖；
6. 备份当前版本并切换到新版本；
7. 重启 `jama.service`，检查本机及 HTTPS 健康状态；
8. 健康检查失败时自动恢复上一个版本。

默认使用 `root@101.35.214.179`，运行时只提示输入一次 SSH 密码。密码不会写入文件或命令行。

使用 SSH 私钥：

```powershell
.\deploy.ps1 -IdentityFile C:\Users\你的用户名\.ssh\id_ed25519
```

代码已经自行测试过时，可以跳过测试，但仍会重新构建前端：

```powershell
.\deploy.ps1 -SkipTests
```

服务器版本备份保存在：

```text
/www/wwwroot/jama.artisoul.top/.deploy/backups/
```

默认保留最近 5 个由该脚本生成的版本，可通过 `-KeepBackups` 调整。

生产数据库、图片、音频、视频资源和宝塔 Nginx/SSL 配置不包含在发布包中，因此部署代码时不会被覆盖。
