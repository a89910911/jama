# 提示词模板数据库化实施计划

> 状态：已完成  
> 开始日期：2026-07-19  
> 完成日期：2026-07-19  
> 需求依据：[2026-07-19-prompt-template-management-requirements.md](./2026-07-19-prompt-template-management-requirements.md)  
> 测试报告：[2026-07-19-prompt-template-management-test-report.md](../reports/2026-07-19-prompt-template-management-test-report.md)

## 1. 中断续接规则

如果后续需要继续优化或修复：

1. 先阅读本文件的“最终检查点”和测试报告。
2. 执行 `git status --short`，保留用户原有改动。
3. 不要覆盖或回退实施前已经修改的 `backend-node/package-lock.json`。
4. 从“后续可选项”选择新任务；本计划内所有必做阶段均已完成。
5. 任何代码调整后重新执行本文件第 6 节的验证命令，并更新测试报告。

## 2. 阶段状态

| 阶段 | 状态 | 完成结果 |
|---|---|---|
| 0. 基线与设计落地 | 已完成 | 固化需求、键规范、变量契约、迁移和回退策略 |
| 1. 数据库与统一服务 | 已完成 | 两张核心表、种子、旧数据迁移、解析、校验、版本、快照 |
| 2. 后端调用迁移 | 已完成 | 文本、视觉、图片、视频及负向/技术模板统一从数据库解析 |
| 3. 业务场景路由整理 | 已完成 | 后端统一注册表，共 20 个业务场景 |
| 4. 系统/项目 API | 已完成 | 列表、详情、编辑、预览、恢复/继承与冲突控制 |
| 5. 前端页面 | 已完成 | 系统 146 条完整列表、项目入口、风险提示、草稿保护 |
| 6. 自动化与全流程测试 | 已完成 | 后端、前端、构建、真实 HTTP、浏览器交互全部通过 |
| 7. 报告与交付 | 已完成 | 本计划归档并生成独立测试报告 |

## 3. 已完成的实施内容

### 3.1 数据库和统一提示词服务

- 新增 `prompt_definitions` 和 `prompt_templates`，并为异步任务增加 `prompt_snapshot`。
- 当前目录包含 102 个提示词定义、146 条 `zh` / `en` / `universal` 系统模板。
- 模板包含文本、视觉识别、图片、视频、负向提示词、JSON/格式合同和技术拼装片段。
- 实现解析顺序：项目同语言 → 系统同语言 → 系统 `universal` → 明确报错，不跨中英文回退。
- 实现变量白名单、必填变量、括号完整性、乐观版本冲突校验。
- 实现项目覆盖、系统继承、系统恢复出厂默认。
- 系统种子升级时只自动更新未被用户修改的内容；用户自定义内容保持不变。
- 保留用户编辑过的旧模板行；只自动停用未编辑的废弃种子行。
- 迁移旧 `prompt_overrides` 数据并停止旧接口和旧服务的运行时使用。

### 3.2 运行时调用迁移

- 故事生成、小说导入。
- 角色、场景、道具提取。
- 角色、场景、道具参考图识别和角色视觉锚点。
- 分镜生成、续写、数量/时长约束、旁白和全能模式。
- 首帧、关键帧、尾帧、布局重生成和连戏摘要。
- 角色/场景/道具生图及最终拼装。
- 分镜图片润色、全能片段生成/润色、经典视频提示词润色。
- 四宫格、九宫格、参考图上下文、负向词、画幅与首尾帧技术约束。
- 删除旧的未使用硬编码分镜帧上下文函数，运行时统一走数据库模板。

### 3.3 异步任务一致性

- 创建异步任务时记录提示词 key、来源层级、语言、版本、渲染内容和捕获时间。
- 分镜异步流程在任务创建阶段固定需要的生成、续写和图片/视频拼装模板。
- 后续修改系统或项目提示词不会改变已创建任务的提示词快照。

### 3.4 业务场景模型路由

- 后端提供统一业务场景注册表，前端只能选择已注册场景。
- 共注册 20 个场景，包含 `role_extraction`、`scene_image_polish`、`frame_prompt`、视觉识别、全能片段、经典视频润色和连戏摘要等。
- 所有需要模型路由的 AI 调用均通过已注册 `scene_key`。
- 兼容迁移把旧 `image_polish` 配置复制到拆分后的目标场景，且不覆盖用户已有配置。
- 页面明确说明 `scene_key` 由具体功能自动传入，用户无需在创作页面填写。

### 3.5 系统级和项目级界面

- “AI 配置 → 高级设置（提示词）”展示全部 146 条语言模板和 102 个定义。
- 支持关键词、分类、场景、角色和语言筛选。
- 支持系统编辑、草稿预览、恢复出厂默认、变量说明和来源/版本展示。
- JSON、负向词和技术合同等高风险内容允许编辑，但需进入编辑确认和保存二次确认。
- 项目模块增加“项目提示词”入口，展示项目覆盖或系统继承来源。
- 项目可以创建/编辑覆盖，也可以删除覆盖并立即恢复系统继承。
- 切换提示词或刷新时提示未保存修改；预览使用当前编辑草稿，不会提前写库。

## 4. 主要文件索引

| 模块 | 文件 |
|---|---|
| 数据库迁移 | `backend-node/migrations/23_prompt_templates.sql` |
| 提示词完整目录 | `backend-node/src/services/promptCatalog.js` |
| 解析、校验、版本、快照 | `backend-node/src/services/promptTemplateService.js` |
| 业务场景注册表 | `backend-node/src/services/businessSceneRegistry.js` |
| 系统/项目 API | `backend-node/src/routes/prompts.js` |
| 业务场景 API | `backend-node/src/routes/sceneModelMap.js` |
| 系统/项目编辑器 | `frontweb/src/components/PromptEditor.vue` |
| 业务场景配置 | `frontweb/src/components/SceneModelMap.vue` |
| 项目提示词入口 | `frontweb/src/views/FilmCreate.vue` |
| 后端专项测试 | `backend-node/test/promptTemplateService.test.js` |
| 前端专项测试 | `frontweb/test/promptTemplateUi.test.js` |

## 5. 数据与接口验收基线

- 提示词定义：102。
- 系统语言模板行：146。
- 项目列表行：146；无覆盖时 146 条全部继承系统。
- 业务场景：20。
- 系统接口：
  - `GET /api/v1/settings/prompts`
  - `GET /api/v1/settings/prompts/:key`
  - `PUT /api/v1/settings/prompts/:key`
  - `POST /api/v1/settings/prompts/:key/reset-seed`
  - `POST /api/v1/settings/prompts/:key/preview`
- 项目接口：
  - `GET /api/v1/dramas/:drama_id/prompts`
  - `GET /api/v1/dramas/:drama_id/prompts/:key`
  - `PUT /api/v1/dramas/:drama_id/prompts/:key`
  - `DELETE /api/v1/dramas/:drama_id/prompts/:key`
  - `POST /api/v1/dramas/:drama_id/prompts/:key/preview`

## 6. 最终验证命令

```bash
cd backend-node
node --test test/*.test.js

cd ../frontweb
node --test test/*.test.js
npm run build
```

最终结果：

- 后端：44/44 通过。
- 前端：5/5 通过。
- 生产构建：通过。
- 真实 HTTP 内存数据库全流程：通过。
- 实际浏览器页面交互：通过。
- `git diff --check`：通过。

详细证据见测试报告。

## 7. 最终检查点

本计划范围已全部完成，没有阻塞项。当前工作区包含本需求代码和文档，但没有执行 Git 暂存、提交或推送。`backend-node/package-lock.json` 是实施前已有改动，本次没有修改或回退。

若程序或会话中断，下次无需重复实施；先运行第 6 节命令确认环境，再从新的缺陷或优化需求开始。

## 8. 后续可选项

这些项目不影响本次验收：

- 对 Vite 报告的大于 500 kB 主包做代码拆分。
- 在具备真实供应商 API Key 的环境中执行一次外部模型冒烟生成，并核对供应商响应质量。
- 增加前端组件级 DOM 自动化，把浏览器手工交互场景纳入持续集成。
