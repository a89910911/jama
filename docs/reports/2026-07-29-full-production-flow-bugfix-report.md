# JamaAI 全流程测试缺陷与修复记录

- 日期：2026-07-29
- 状态：本次发现的缺陷已全部修复并回归通过
- 未解决 P0/P1：0

## BUG-001：AI 分镜 JSON 因对白内引号导致整批数据丢失

- 级别：P0
- 现象：模型返回 `"dialogue":"林夏："这...不可能。""` 时，解析结果可能从 9/16 条退化为 0 条。
- 根因：宽松 JSON 修复不能识别字符串内部未转义的中文对白引号边界。
- 修复：
  - 在 `backend-node/src/utils/safeJson.js` 增加未转义引号修复；
  - 在常规 JSON 解析和 `jsonrepair` 前统一预处理；
  - 保持文本顺序和内容不丢失。
- 回归：
  - `backend-node/test/safeJson.test.js`；
  - 真实模型响应重放后得到 8 条原始分镜，安全拆分为 15 条并完整入库。

## BUG-002：场景单图开关被后端忽略

- 级别：P1
- 现象：UI 取消“四宫格”后发送 `use_quad_grid:false`，后端仍生成四宫格。
- 根因：`/scenes/generate-image` 无条件调用四视图服务。
- 修复：
  - `backend-node/src/routes/scenes.js` 仅在显式 `true` 时生成四宫格；
  - 默认和显式 `false` 均生成单图；
  - 响应文案按模式返回。
- 回归：`backend-node/test/sceneGenerateImageRoute.test.js`，真实生成单张连续场景图通过。

## BUG-003：单场景生图缺少数据库列

- 级别：P0
- 现象：单图分支报错 `no such column: polished_prompt_single`。
- 根因：代码已使用新字段，但 SQLite/MySQL 迁移未包含该列。
- 修复：
  - 新增 `backend-node/migrations/43_scene_single_image_prompt.sql`；
  - `backend-node/src/db/migrate.js` 增加启动兜底列检查。
- 回归：SQLite 新建/升级、MySQL 8.0.45 升级、桌面首次启动全部通过。

## BUG-004：图片失败重试成功后仍保留旧错误

- 级别：P2
- 现象：首次请求 `ECONNRESET`，重试成功并绑定图片后，分镜仍显示旧错误。
- 根因：成功绑定只更新图片字段，没有清空 `storyboards.error_msg`。
- 修复：`backend-node/src/services/storyboardFrameBinding.js` 在首帧和尾帧成功绑定时清空错误。
- 回归：`backend-node/test/storyboardFrameBinding.test.js`，真实重试后数据库错误为空。

## BUG-005：媒体素材库“上传成功”但列表为空

- 级别：P1
- 现象：
  - 页面允许图片/视频上传；
  - 实际只调用临时图片接口；
  - 文件不写入 `assets`；
  - 视频被后端拒绝；
  - 搜索参数和文件大小显示无效。
- 根因：前端上传与资产登记是两条未连接的链路，后端没有统一媒体上传入库端点。
- 修复：
  - `backend-node/src/routes/upload.js` 增加图片/视频媒体上传与资产登记；
  - `backend-node/src/routes/index.js` 增加 `/assets/upload`；
  - `backend-node/src/services/assetService.js` 增加名称搜索和文件元数据响应；
  - `frontweb/src/api/upload.js` 增加 `uploadMediaAsset`；
  - `frontweb/src/views/MediaLibrary.vue` 改为上传即入库并显示 `file_size`；
  - 非媒体返回 400，超过 500MB 返回 413。
- 回归：
  - `backend-node/test/mediaLibraryUpload.test.js`；
  - `frontweb/test/mediaLibrary.test.js`；
  - 真实图片、真实 MP4 上传、筛选、搜索和大小显示通过。

## BUG-006：TTS 连接成功提示成“文本生成”

- 级别：P2
- 现象：TTS 连接成功后提示“文本生成接口已正常响应”。
- 根因：成功弹窗把 TTS 落入文本服务分支。
- 修复：`frontweb/src/components/AIConfigContent.vue` 增加 TTS 专用提示。
- 回归：`frontweb/test/aiConfigLayoutUi.test.js`。

## BUG-007：转绘导入把首帧 JPG 当作源视频

- 级别：P1
- 现象：从分集导入转绘任务后，“源视频”字段是 `images/*.jpg`。
- 根因：导入逻辑优先使用 `storyboards.local_path`，该字段实际保存首帧图片。
- 修复：
  - `backend-node/src/services/redrawService.js` 关联当前视频生成记录；
  - 优先使用当前完成视频的本地路径；
  - 只有首帧、没有视频时保持为空，让预检正确阻断。
- 回归：
  - `backend-node/test/redrawImportSource.test.js`；
  - 真实导入 15 个镜头：首镜绑定 MP4，第二镜为空，预检错误准确。

## BUG-008：动作迁移任务创建 SQL 参数错位

- 级别：P0
- 现象：真实上传驱动视频和参考图后报错 `25 values for 24 columns`。
- 根因：`action_migration_jobs` INSERT 多了一个占位符。
- 修复：校正 `backend-node/src/services/actionMigrationService.js` INSERT，并把 SQL 提取为可测试常量。
- 回归：动作迁移任务真实创建成功；自动化断言 22 个绑定参数。

## BUG-009：动作迁移提交 SQL 参数错位

- 级别：P0
- 现象：创建和预检通过，提交时报错 `23 values for 22 columns`。
- 根因：`video_generations` INSERT 多了一个占位符。
- 修复：校正 INSERT，并增加 20 个绑定参数的回归断言。
- 回归：真实视频任务创建、供应商提交、轮询、下载和状态回写成功。

## BUG-010：动作迁移状态读取无限递归

- 级别：P0
- 现象：任务提交后 API 返回 `Maximum call stack size exceeded`，但后台视频任务仍在执行。
- 根因：
  - `getJob()` 调用 `reconcileJob()`；
  - `reconcileJob()` 调用 `syncVideoGenerationResult()`；
  - `syncVideoGenerationResult()` 又返回 `getJob()`。
- 修复：同步函数只返回最新数据库行，不再递归加载完整任务。
- 回归：
  - `backend-node/test/actionMigrationService.test.js` 新增 processing 状态回归；
  - 真实完成任务 API 返回 `completed` 和当前结果。

## BUG-011：动作迁移结构视频 FFmpeg 滤镜失败

- 级别：P1
- 现象：有效 2560×1440 驱动视频生成结构源失败，回退使用原视频。
- 根因：低分辨率结构帧的色度平面过小，`boxblur=8:1` 的色度半径超过 FFmpeg 上限。
- 修复：
  - 提取 `buildStructureFilter()`；
  - 显式使用 `boxblur=<luma>:1:2:1`，限制色度模糊半径。
- 回归：
  - identity/balanced/motion 三种模式单测；
  - 真实生成 `structure_balanced.mp4`，48×28、8.04 秒、无降级告警。

## BUG-012：Electron 全新安装因重复迁移版本无法启动

- 级别：P0
- 现象：`JamaAI.exe` 首次启动报 `UNIQUE constraint failed: schema_migrations.version`。
- 根因：
  - `desktop/scripts/copy-backend.js` 复制后端迁移后，又按文件名覆盖/追加旧的 `initial-migrations`；
  - 同时存在两个版本 05 的迁移文件；
  - 部分现有迁移还被旧副本覆盖。
- 修复：
  - 初始迁移按“版本号”补缺，不再按文件名盲目覆盖；
  - 桌面后端最终为 43 个文件、43 个唯一版本；
  - `desktop/main.js` 增加 `JAMAAI_USER_DATA_DIR`，支持可控隔离启动和运维诊断。
- 回归：
  - Electron `npm run pack` 通过；
  - 全新隔离用户目录首次启动通过；
  - 43 个迁移完成、`integrity_check=ok`、管理员登录通过。

## BUG-013：缺失静态资源和非法上传返回错误状态

- 级别：P2
- 现象：
  - 缺失 `/static/*` 被 SPA fallback 返回 200 HTML；
  - 不支持的素材格式返回 500。
- 根因：静态文件中间件后没有 404 截止；Multer 校验错误进入全局 500 处理器。
- 修复：
  - `backend-node/src/app.js` 在静态目录后增加 404；
  - `backend-node/src/routes/upload.js` 对格式错误返回 400、大小错误返回 413。
- 回归：
  - `backend-node/test/staticFallbackContract.test.js`；
  - 真实 HTTP 验证：缺失静态文件 404、文本素材上传 400。

## 修复文件汇总

### 后端

- `backend-node/src/app.js`
- `backend-node/src/db/migrate.js`
- `backend-node/src/routes/index.js`
- `backend-node/src/routes/scenes.js`
- `backend-node/src/routes/upload.js`
- `backend-node/src/services/actionMigrationService.js`
- `backend-node/src/services/assetService.js`
- `backend-node/src/services/redrawService.js`
- `backend-node/src/services/storyboardFrameBinding.js`
- `backend-node/src/utils/safeJson.js`
- `backend-node/migrations/43_scene_single_image_prompt.sql`

### 前端

- `frontweb/src/api/upload.js`
- `frontweb/src/components/AIConfigContent.vue`
- `frontweb/src/views/MediaLibrary.vue`

### 桌面端

- `desktop/main.js`
- `desktop/scripts/copy-backend.js`

### 新增/更新回归测试

- `backend-node/test/actionMigrationService.test.js`
- `backend-node/test/mediaLibraryUpload.test.js`
- `backend-node/test/redrawImportSource.test.js`
- `backend-node/test/safeJson.test.js`
- `backend-node/test/sceneGenerateImageRoute.test.js`
- `backend-node/test/staticFallbackContract.test.js`
- `backend-node/test/storyboardFrameBinding.test.js`
- `backend-node/test/codexChatService.test.js`
- `frontweb/test/aiConfigLayoutUi.test.js`
- `frontweb/test/mediaLibrary.test.js`

## 最终回归结果

- 后端：221/221 通过；
- 前端：60/60 通过；
- 严格生产预检：通过；
- 前后端生产依赖漏洞：0；
- 前端生产构建：通过；
- Electron 打包及首次启动：通过；
- SQLite/MySQL 迁移：通过；
- 真实图片、音频、视频、合并、转绘预检、动作迁移、导出、备份恢复：通过。
