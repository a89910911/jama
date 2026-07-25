# 数据库建表与版本迁移方案

本文档说明后端启动时如何自动检查并更新 SQLite/MySQL 表结构。SQL 源文件统一放在 `backend-node/migrations/`，按文件名前缀数字作为版本号执行。

## 启动流程

1. 后端启动后根据配置连接数据库：`sqlite` 使用 `better-sqlite3`，`mysql` 使用 `MysqlDatabase` 方言适配层。
2. 执行 `runMigrationsAndEnsure(db)`：
   - 自动创建 `schema_migrations` 版本表；
   - 扫描 `backend-node/migrations/*.sql`；
   - 只执行 `schema_migrations` 中不存在的版本；
   - 每个版本执行成功后写入版本号、文件名、SQL 校验值、执行时间；
   - 对历史库中已经存在的字段/索引/表，兼容跳过并补记版本。
3. 执行 `ensureAllColumns(db)` 做兜底结构检查，避免旧库漏字段导致运行时报 `no such column`。

## 版本表

```sql
CREATE TABLE IF NOT EXISTS schema_migrations (
  version INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  checksum TEXT NOT NULL,
  applied_at TEXT NOT NULL
);
```

MySQL 启动时同样走这套流程。SQLite 语法会通过 `src/db/sqlDialect.js` 转换成 MySQL 可执行语法，例如 `AUTOINCREMENT`、`INSERT OR IGNORE`、`ON CONFLICT`、`PRAGMA table_info` 等。

## 当前建表 SQL

初始建表集中在：

- `backend-node/migrations/01_init.sql`

该文件创建核心业务表：`dramas`、`episodes`、`storyboards`、`characters`、`episode_characters`、`scenes`、`props`、`storyboard_props`、`frame_prompts`、`ai_service_configs`、`async_tasks`、`image_generations`、`video_generations`、`video_merges`、`character_libraries`、`scene_libraries`、`prop_libraries`、`assets`。

## 当前更新 SQL

| 版本 | 文件 | 主要内容 |
| --- | --- | --- |
| 01 | `01_init.sql` | 初始建表 |
| 02 | `02_add_default_model.sql` | `ai_service_configs.default_model` |
| 03 | `03_add_props_episode_id.sql` | `props.episode_id` |
| 04 | `04_async_tasks_columns.sql` | `async_tasks.completed_at/error/result` |
| 05 | `05_add_image_generations_completed_at.sql` | `image_generations.completed_at/error_msg` |
| 06 | `06_add_characters_local_path.sql` | `characters.local_path` |
| 07 | `07_add_scenes_image_columns.sql` | `scenes.image_url/local_path` |
| 08 | `08_add_video_generations_completed_at.sql` | `video_generations.completed_at/error_msg` |
| 09 | `09_scene_prop_libraries.sql` | 场景/道具素材库表 |
| 10 | `10_prompt_overrides.sql` | 提示词覆盖表 |
| 11 | `11_add_api_protocol.sql` | `ai_service_configs.api_protocol` |
| 12 | `12_image_proxy_cache.sql` | 图片代理缓存表 |
| 13 | `13_character_identity_anchors.sql` | 角色视觉锚点字段 |
| 14 | `14_storyboard_segments_and_model_map.sql` | 分镜段落字段、模型映射表 |
| 15 | `15_storyboard_angle_structured.sql` | 分镜结构化镜头角度字段 |
| 16 | `16_character_polished_prompt.sql` | `characters.polished_prompt` |
| 17 | `17_character_stages.sql` | `characters.stages` |
| 18 | `18_storyboard_narration.sql` | `storyboards.narration` |
| 19 | `19_storyboard_universal_mode.sql` | 万能片段模式字段 |
| 20 | `20_character_seedance2_asset.sql` | 即梦/Seedance 素材认证字段 |
| 21 | `21_asset_negative_prompt.sql` | 角色/场景/道具负向提示词 |
| 22 | `22_library_source_id.sql` | 素材库来源 ID 字段及历史数据回填 |
| 23 | `23_prompt_templates.sql` | 提示词定义/模板表及索引 |
| 24 | `24_prompt_single_template.sql` | 提示词模板语言维度合并 |
| 25 | `25_prompt_definition_content_type.sql` | 提示词内容类型 |
| 26 | `26_prompt_workflow_classification.sql` | 提示词工作流分类字段 |
| 27 | `27_prompt_detail_category.sql` | 提示词细分类字段 |
| 28 | `28_performance_indexes.sql` | 常用查询性能索引 |
| 29 | `29_user_accounts.sql` | 用户账号表 |
| 30 | `30_ai_request_logs.sql` | AI 请求日志表及索引 |
| 31 | `31_codex_chat.sql` | Codex 对话会话/消息表 |
| 32 | `32_async_task_recovery.sql` | 异步任务恢复字段 |
| 33 | `33_ai_assistant_engine.sql` | 对话引擎字段及历史数据回填 |
| 34 | `34_storyboard_per_shot_first_last_frame.sql` | 单分镜首尾帧开关 |
| 35 | `35_redraw_workbench.sql` | 视频重绘工作台表、结果表、事件表及字段 |
| 36 | `36_action_migration.sql` | 动作迁移任务/结果/事件表及字段 |

## 新增迁移规范

1. 新增表、字段、索引或数据修复时，只新增一个递增 SQL 文件，例如 `37_add_xxx.sql`。
2. SQL 尽量写成可重复执行的形式：`CREATE TABLE IF NOT EXISTS`、`CREATE INDEX IF NOT EXISTS`；字段新增由启动器兼容重复字段错误。
3. 已发布的迁移文件不要修改内容。启动器会记录校验值，如果已执行版本的 SQL 被改动，会输出警告。
4. 不再要求部署人员手动执行 ALTER。启动服务即可自动补齐表结构。
