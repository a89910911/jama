# MySQL 启动与迁移

运行环境要求 Node.js 20.6 或更高版本。连接密码只保存在未纳入 Git 的环境文件中。

## 两种启动方式

本地开发连接远程测试库：

```bash
cp .env.mysql.test.example .env.mysql.test
# 填写测试库密码
npm run dev:mysql:test
```

服务器连接本机生产库：

```bash
cp .env.mysql.prod.example .env.mysql.prod
# 填写生产库密码并限制文件权限
chmod 600 .env.mysql.prod
npm run start:mysql:prod
```

普通的 `npm start` 和 `npm run dev` 仍可通过系统环境变量启动 MySQL。需要设置：

```text
JAMA_DB_TYPE=mysql
JAMA_DB_HOST=127.0.0.1
JAMA_DB_PORT=3306
JAMA_DB_USER=...
JAMA_DB_PASSWORD=...
JAMA_DB_NAME=...
```

## 从 SQLite 全量迁移

迁移会保留全部表、主键和数据，并在完成后校验每张表的行数及文本字段字节数：

```bash
npm run db:migrate:mysql:test -- --replace
npm run db:migrate:mysql:prod -- --replace
```

只验证、不写入：

```bash
npm run db:verify:mysql:test
npm run db:verify:mysql:prod
```

`--replace` 会重建目标库中的 Jama 业务表。运行前应先备份已有 MySQL 数据，并在迁移生产库时停止后端写入。
