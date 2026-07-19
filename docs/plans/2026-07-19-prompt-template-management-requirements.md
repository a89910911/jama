# 提示词模板数据库化与系统/项目两级管理需求文档

> 文档状态：需求已确认  
> 编写日期：2026-07-19  
> 核心范围确认日期：2026-07-19  
> 适用项目：LocalMiniDrama（本地短剧助手）

## 1. 需求概述

将当前散落在后端代码中的所有静态提示词模板迁移到 SQLite 数据库，由数据库作为提示词的唯一运行时数据源。

提示词配置分为两个层级：

1. **系统级提示词**：全局默认提示词，在“AI 配置 → 高级设置（提示词）”中统一维护。
2. **项目级提示词**：单个短剧项目的自定义提示词，在项目模块中维护。

执行项目内 AI 任务时，按以下优先级读取：

```text
项目级提示词存在
  → 使用项目级提示词
项目级提示词不存在
  → 使用系统级提示词
系统级提示词也不存在
  → 阻止调用并返回明确的配置缺失错误
```

本需求同时补全“高级设置（提示词）”中的提示词目录，使所有已接入 AI 调用的静态提示词模板都能被查询、查看和编辑，不再只显示目前的 9 条。

## 2. 背景与现状问题

当前提示词来源不统一：

- 9 条核心提示词通过 `promptI18n.js` 暴露给“高级设置（提示词）”。
- 用户修改的 9 条提示词只作为覆盖值保存在 `prompt_overrides` 表。
- 大量其他提示词仍硬编码在 `promptI18n.js`、`aiClient.js`、业务 Service、Route 和图片/视频 Client 中。
- 页面展示的默认提示词来自代码，不是数据库，所以数据库可以为空但页面仍显示数据。
- 部分提示词由多个隐藏片段拼接，用户无法看到最终实际发送给模型的完整规则。
- 当前只有全局覆盖，不支持单项目定制。
- “高级设置（业务场景）”只决定使用哪个 AI 配置和模型，不能解决提示词内容分项目管理的问题。

这些现状导致：

- 提示词无法统一盘点和维护。
- 修改提示词需要改代码、重启或发布。
- 不同项目无法采用不同的创作规则。
- 页面展示内容和实际运行内容可能产生偏差。
- 新增提示词时容易遗漏配置页面和持久化逻辑。

## 3. 目标

### 3.1 核心目标

- 所有发送给 AI 模型的静态提示词模板均存储在数据库。
- “所有提示词”明确包含文本、视觉、图片、视频、负向提示词、格式协议和技术约束模板。
- 数据库初始化时写入当前代码中已有的默认提示词。
- 运行时只通过统一的提示词服务从数据库读取，不再以代码常量作为隐式回退。
- 系统级提示词全部出现在“高级设置（提示词）”列表中并可编辑。
- 项目模块提供“项目提示词”入口，支持单项目覆盖。
- 项目任务优先使用项目提示词，没有项目覆盖时自动继承系统提示词。
- 明确区分“提示词内容选择”和“业务场景模型路由”。
- 支持提示词中的动态变量，并在保存前校验变量合法性。
- 保证旧版本中已自定义的 `prompt_overrides` 数据不丢失。

### 3.2 非目标

以下内容不属于本需求中的“提示词模板”：

- 用户在页面输入的故事梗概、剧本正文、对白等业务内容。
- AI 已经生成并保存到业务表中的结果，例如：
  - `storyboards.image_prompt`
  - `storyboards.video_prompt`
  - `storyboards.universal_segment_text`
  - `characters.polished_prompt`
  - `scenes.prompt`
  - `props.prompt`
  - `frame_prompts.prompt`
  - `image_generations.prompt`
  - `video_generations.prompt`
- 模型 API Key、Base URL、模型列表等 AI 服务配置。
- “高级设置（业务场景）”现有的模型路由配置。

这些业务数据继续保存在各自原有表中。本需求管理的是生成这些内容时使用的**静态指令模板**。

## 4. 术语定义

### 4.1 配置层级

- **系统级**：全局生效，作为所有项目的默认值。
- **项目级**：只对一个 `drama_id` 生效，覆盖同 key 的系统值。

### 4.2 消息角色

为避免“系统级提示词”和大模型消息中的 `system` 角色混淆，数据库中分别使用：

- `scope`：配置层级，值为 `system` 或 `project`。
- `message_role`：AI 消息角色，只允许 `system`、`user`、`assistant`。
- `content_type`：模板内容用途，例如 `system`、`user_template`、`suffix`、`format_contract`、`image_prompt`、`video_prompt`、`negative_prompt`。

当前 94 条模板实际只需要 `system` 和 `user`；暂时没有需要预填模型回复的 `assistant` 模板，但目录校验允许以后按标准 AI 消息协议增加。

### 4.3 提示词键 `prompt_key`

唯一标识一类提示词模板，例如：

```text
story.generation.system
character.extraction.system
storyboard.generation.user
frame.first.system
```

`prompt_key` 用于查找提示词内容，不能与模型路由使用的 `scene_key` 混用。

### 4.4 业务场景键 `scene_key`

用于决定本次调用使用哪个 AI 配置和模型，例如：

```text
story_generation
role_extraction
storyboard_extraction
image_polish
```

同一次 AI 调用可同时包含：

```text
prompt_key  → 决定发送什么提示词
scene_key   → 决定由哪个模型执行
drama_id    → 决定优先读取哪个项目级提示词
```

## 5. 核心使用流程

### 5.1 系统管理员维护系统提示词

1. 进入“AI 配置 → 高级设置（提示词）”。
2. 查看完整提示词目录。
3. 按分类、业务场景、消息角色或关键字筛选。
4. 选择一条提示词，查看系统当前内容、变量和使用位置。
5. 编辑并保存。
6. 所有未设置项目覆盖的项目，在下一次 AI 调用时自动使用新的系统内容。

### 5.2 项目用户维护项目提示词

1. 进入某个短剧项目。
2. 点击项目模块中的“项目提示词”按钮。
3. 列表默认显示所有可用于该项目的提示词，以及当前来源：
   - `继承系统`
   - `项目自定义`
4. 点击“创建项目覆盖”或“编辑项目提示词”。
5. 编辑器初始内容为当前系统提示词副本。
6. 保存后只影响当前项目。
7. 点击“恢复使用系统提示词”时，删除项目级记录，立即恢复继承系统值。

### 5.3 项目内 AI 调用

以“提取角色”为例：

```text
用户在项目 A 点击“提取角色”
→ 后端确定 drama_id = 项目 A
→ 使用 prompt_key = character.extraction.system
→ 先查项目 A 的项目提示词
→ 若不存在，读取系统提示词
→ 使用 scene_key = role_extraction 查模型路由
→ 由选中的模型执行最终提示词
```

项目 B 的提示词和项目 A 相互隔离。

## 6. 功能需求

### 6.1 提示词目录

系统必须维护完整的提示词定义目录。每个定义至少包含：

- 提示词键 `prompt_key`
- 中文名称
- 功能描述
- 分类
- 消息角色
- 关联业务场景 `scene_key`
- 适用服务类型
- 支持的语言
- 允许使用的动态变量
- 必填动态变量
- 风险级别
- 是否允许项目级覆盖
- 排序值
- 启用状态

新增 AI 调用时，如果使用了新的静态提示词，必须先注册 `prompt_key` 并写入数据库种子，不能直接在业务代码中新增大段提示词。

### 6.2 系统级提示词列表

“AI 配置 → 高级设置（提示词）”必须展示完整目录，不再使用当前固定的 9 条元数据数组。

列表至少显示：

- 提示词名称
- `prompt_key`
- 分类
- 消息角色
- 关联业务场景
- 当前状态
- 更新时间

支持：

- 关键字搜索。
- 按分类筛选。
- 按 `scene_key` 筛选。
- 按消息角色筛选。
- 查看使用说明和代码接入位置。
- 编辑全部提示词正文。
- 预览变量替换后的最终内容。
- 恢复数据库中保存的出厂默认内容。

#### 6.2.1 用户可读名称

每个提示词名称必须让非开发人员直接看出实际用途，统一采用“动作 + 业务对象 + 结果/使用阶段 + 模板类型”的表达方式：

- 系统消息使用“（系统规则）”结尾。
- 业务资料输入使用“（输入模板）”结尾。
- 运行时追加条件使用“（附加约束）”结尾。
- JSON、固定行或字段协议使用“（输出格式）”结尾。
- 直接发送给图片模型的模板使用“（生图模板）”结尾。
- 直接发送给视频模型的模板使用“（视频模板）”结尾。
- 负向提示词使用“（负向词）”结尾。

禁止只使用“系统提示词”“通用规则”“合同”“处理模板”等无法说明业务对象和结果的名称。最终 94 个提示词的用户可读名称必须完整、唯一，并与正文实际作用一致。新增提示词没有配置用户可读名称、名称类型与消息角色不一致、名称重复或正文为空时，目录初始化必须报错。

### 6.3 全部内容可编辑

当前页面中“锁定的 JSON 格式要求”也必须纳入数据库并允许编辑。

为降低误操作风险：

- JSON、字段约束、负向提示词、接口协议提示词标记为“高风险”。
- 编辑任意提示词时，编辑器顶部都持续显示醒目警告：`高风险配置，非专业人员请勿编辑。修改 JSON 协议、变量、负向词或技术模板可能导致生成失败。`
- 保存前执行变量校验和基础格式校验。
- 不再采用不可编辑锁定区。
- 高风险内容直接开放编辑和保存，不显示“确认风险后进入编辑”或保存二次确认弹窗。

格式校验只用于提示风险，不应偷偷恢复代码默认值。

### 6.4 项目级提示词入口

在项目模块顶部操作区或“项目设置”中增加“项目提示词”按钮。

项目提示词页面/抽屉至少包含：

- 与系统提示词一致的完整分类目录。
- 系统提示词内容。
- 项目自定义内容。
- 当前实际生效内容。
- 来源标记：`继承系统` / `项目自定义`。
- “创建项目覆盖”按钮。
- “编辑项目提示词”按钮。
- “恢复使用系统提示词”按钮。
- “查看系统版本”按钮。

项目级编辑规则：

- 所有能够确定 `drama_id` 的提示词均允许创建项目级覆盖。
- 首次编辑时，将当前系统内容复制到编辑框，但在点击保存前不创建项目记录。
- 保存后创建或更新项目级记录。
- 项目级内容不能为空；需要继承系统时使用“恢复使用系统提示词”删除项目记录。
- 系统提示词后续修改时：
  - 仍在继承的项目立即使用新系统内容。
  - 已有项目覆盖的项目不受影响。

### 6.5 有效提示词解析

新增统一服务，例如：

```js
resolvePrompt({
  promptKey,
  dramaId,
  variables
})
```

解析顺序：

1. `dramaId + promptKey` 对应的项目级提示词。
2. `promptKey` 对应的系统级提示词。
3. 均不存在时返回 `PROMPT_TEMPLATE_NOT_FOUND`，停止 AI 调用。

不得回退到代码中写死的提示词。

项目上下文解析规则：

- 请求直接带 `drama_id`：直接使用。
- 只有 `episode_id`：通过 `episodes.drama_id` 获取。
- 只有 `storyboard_id`：通过 `storyboards → episodes → dramas` 获取。
- 只有角色、场景或道具 ID：通过对应实体的 `drama_id` 获取。
- 后台异步任务：创建任务时保存 `drama_id`。
- 无法确定项目的全局操作：只使用系统提示词。

### 6.6 异步任务一致性

为了保证同一次任务可复现：

- 创建异步任务时解析有效提示词。
- 保存本次使用的 `prompt_key`、来源、版本号和必要的内容快照。
- 任务排队期间即使用户修改提示词，本次任务仍使用创建时的快照。
- 后续新任务使用更新后的提示词。

提示词内容快照可以存放在 `async_tasks.result` 的任务元数据中，或增加专用快照字段/表。

### 6.7 模板变量

数据库提示词统一使用明确的模板变量语法：

```text
{{episode_count}}
{{story_premise}}
{{script_content}}
{{style_prompt}}
{{image_ratio}}
{{storyboard_context}}
{{dialogue}}
```

每个提示词定义必须记录：

- 可用变量。
- 必填变量。
- 变量说明。
- 示例值。

保存时校验：

- 不允许出现未注册变量。
- 必填变量缺失时阻止保存。
- 变量括号不完整时阻止保存。

执行时校验：

- 必填变量没有值时返回明确错误。
- 可选变量没有值时替换为空字符串。
- 用户业务内容必须作为变量值注入，不能再次通过字符串拼接形成隐藏提示词。

为防止项目内容破坏模板，变量渲染器不得执行 JavaScript、表达式或任意代码。

### 6.8 单一中文模板

- 每个 `prompt_key` 在系统级和每个项目级各只允许一份有效模板。
- 全系统不再提供 `language=en` 配置，不区分 `zh`、`en` 或 `universal`，界面和接口均不暴露语言维度。
- 初始化统一采用当前中文模板；模板正文中因模型协议需要保留的英文关键词不代表英文模板。
- 历史多语言数据升级时按 `zh → universal → en` 的顺序选择一份内容迁移为单一模板；迁移完成后物理删除所有非 `default` 的旧语言行。
- 运行时只执行“项目模板 → 系统模板”的两级解析。

### 6.8.1 第一批简单合并

对结构、变量和用途相同，仅因调用分支不同而重复的模板先执行简单合并：

| 被替换的旧定义 | 合并后的定义 |
|---|---|
| `frame.first.user`、`frame.key.user`、`frame.last.user` | `frame.input.user` |
| `scene.image_four_view.user`、`scene.image_single.user` | `scene.image.user` |
| `scene.image_four_view.compose`、`scene.image_single.compose` | `scene.image.compose` |

合并要求：

- 首帧、关键帧、尾帧各自的系统规则继续独立，只有结构相同的上下文输入模板合并。
- 场景四视图和单图的系统规则、布局规则继续独立；通用输入和最终拼装通过各分支传入的布局变量保持差异。
- 目录由 102 个定义减少为 98 个定义。
- 升级时先创建新的通用定义，再迁移旧系统自定义和项目覆盖，最后物理删除 7 个旧定义关联的全部模板记录及 7 个旧定义，不保留兼容别名。
- 同一合并组存在多份旧系统自定义时，按表中旧定义顺序选择第一份合法内容；同一项目存在多份旧覆盖时也采用相同顺序。新定义已经存在用户自定义或项目覆盖时，不覆盖新内容。

### 6.8.2 第二批技术模板合理收敛

技术补充仅在“固定随主模板发送、没有独立条件、没有复用价值”时物理合并；条件分支、供应商差异、负向词和跨流程复用规则继续独立：

| 被吸收的旧定义 | 合并后的定义 |
|---|---|
| `storyboard.generation.requirements`、`storyboard.generation.output_contract` | `storyboard.generation.system` |
| `frame.output_contract` | `frame.first.system`、`frame.key.system`、`frame.last.system` 已有输出协议 |
| `character.image_layout` | `character.image_compose` |
| `scene.image.compose` + `scene.image_four_view.layout` | `scene.image_four_view.final` |
| `scene.image.compose` + `scene.image_single.layout` | `scene.image_single.final` |

合并要求：

- 目录由 98 个定义减少为 93 个定义。
- `storyboard.generation.narration`、`storyboard.generation.universal_mode`、数量/时长约束、Omni 条件片段、参考图规则、负向词等仍保留独立编辑，因为它们按运行条件注入或被多个流程复用。
- 升级时先创建最终定义，再迁移系统自定义和逐项目覆盖，最后物理删除 7 个被吸收定义及其全部模板记录。
- 未修改的旧片段不得因空行或格式标准化导致最终模板被误标为“已修改”。
- 本阶段完成后目录为 93 条；后续用途类型重构见 6.8.3。

### 6.8.3 模板用途类型重构

模板的“用途类型”、AI `message_role` 和 `content_type` 分开。`message_role` 只表达 AI 的 `system`、`user`、`assistant` 角色；图片正向、视频正向、负向参数、格式协议或后缀由 `content_type` 和“注入位置”说明。用途类型只允许以下三种：

| `template_kind` | 页面名称 | 定义 |
|---|---|---|
| `main` | 主模板 | 一次业务调用的主体模板，或者拥有自己条件模板的主流程模板 |
| `conditional_child` | 条件子模板 | 仅在固定条件和注入位置使用；回退逻辑属于该类型的特殊子类型 |
| `independent_technical` | 独立技术模板 | 不依赖主模板，可以被业务代码直接解析和使用 |

整理要求：

- 不设置“共享技术模板”类型。
- 普通条件子模板必须只有一个 `parent_prompt_key`，由该主模板独立管理。
- `image.reference_generation.user` 提升为独立技术模板，清除其 `parent_prompt_key`。
- 独立技术模板固定为 `image.quad_grid.layout`、`image.nine_grid.layout`、`image.reference_generation.user`。
- 回退逻辑统一设置为 `template_kind=conditional_child`、`template_subtype=fallback`。
- 回退子模板固定为 `frame.first.fallback`、`frame.key.fallback`、`frame.last.fallback`、`frame.character_anchor.fallback`、`omni.segment.fallback`、`image.default_cinematic_style`。
- `omni.segment.fallback` 归属 `omni.segment.user`；`image.default_cinematic_style` 会被多个图片流程在“未配置画风”条件下使用，没有唯一父模板，作为唯一允许无 `parent_prompt_key` 的特殊回退子模板。
- 原 `image.realistic_scale_contract` 不再由首帧和尾帧共享，拆为 `frame.first.realistic_scale_contract`、`frame.last.realistic_scale_contract`，分别归属 `frame.first.system`、`frame.last.system`；出厂正文分别限定为仅用于首帧、仅用于尾帧。
- 拆分迁移必须把旧系统自定义和每个项目覆盖各复制到两条新模板，再物理删除旧定义和旧模板记录；新模板已有内容时不得覆盖。
- 最终目录为 94 条：52 个主模板、39 个条件子模板（其中 6 个回退子类型）、3 个独立技术模板。

### 6.9 最终提示词预览

系统级和项目级编辑器都提供“最终提示词预览”：

- 显示当前选择的提示词来源。
- 使用示例变量进行渲染。
- 展示最终发送给模型的完整内容。
- 如果一次调用由多个模板组成，按实际组合顺序展示，并分别标明 AI 消息角色、内容用途和注入位置。
- 标出尚未赋值的变量。

预览不得发起真实 AI 请求。

### 6.10 提示词与业务场景模型路由的关系

提示词管理和模型路由保持独立：

```text
prompt_key 负责内容
scene_key 负责模型
```

示例：

```text
项目级 character.extraction.system
  → 指定当前项目的角色提取规则

业务场景 role_extraction
  → 指定角色提取使用 Claude Sonnet
```

两者共同生效，但互不覆盖。

提示词列表中展示关联 `scene_key`，帮助用户理解模型路由关系，但编辑提示词不能修改 `ai_model_map`。

### 6.11 业务场景路由同步改造

本需求同步补齐未接入的业务场景路由，并拆分当前复用范围过大的路由键。

调整后的路由至少包括：

| `scene_key` | 对应业务操作 | 调整方式 |
|---|---|---|
| `story_generation` | 故事/剧本生成 | 保留 |
| `storyboard_extraction` | 分镜生成与分镜续写 | 保留 |
| `role_extraction` | 从剧本提取角色 | 保留 |
| `scene_extraction` | 从剧本提取场景 | 保留 |
| `prop_extraction` | 从剧本提取道具 | 保留 |
| `role_image_polish` | 角色生图提示词润色 | 保留 |
| `scene_image_polish` | 场景单图/四视图提示词润色 | 补齐后端调用接入 |
| `prop_image_polish` | 道具生图提示词润色 | 保留 |
| `image_polish` | 仅用于分镜图片提示词润色 | 收窄现有职责 |
| `frame_prompt` | 首帧、关键帧、尾帧提示词生成 | 补齐后端调用接入 |
| `layout_regenerate` | 分镜布局描述重生成 | 新增 |
| `identity_anchors` | 角色视觉锚点提炼 | 保留 |
| `novel_import` | 小说章节短剧化改写 | 保留 |
| `omni_segment_generation` | 全能片段提示词生成 | 从 `image_polish` 拆分 |
| `omni_segment_polish` | 全能片段提示词润色 | 从 `image_polish` 拆分 |
| `classic_video_prompt_polish` | 经典分镜视频提示词润色 | 从 `image_polish` 拆分 |
| `continuity_snapshot` | 连戏状态摘要 | 从 `image_polish` 拆分 |
| `vision_character_extract` | 从参考图提取角色外貌 | 新增 |
| `vision_scene_extract` | 从参考图提取场景描述 | 新增 |
| `vision_prop_extract` | 从参考图提取道具描述 | 新增 |

路由整理要求：

- 所有调用 `generateText`、`streamGenerateText` 或 `generateTextWithVision` 的业务入口都必须传入一个已注册的 `scene_key`。
- 同一个 `scene_key` 只承担语义相同、模型能力要求相近的任务。
- “高级设置（业务场景）”中的场景键列表必须来自后端统一注册表，不再仅由前端维护。
- 普通用户只能选择已注册场景键；不再允许创建没有后端调用方的任意 key。
- 页面提示改为：`为不同功能指定 AI 模型。保存后，执行对应功能时系统会自动使用该模型；无需在生成页面手动选择。`
- 场景键说明改为：`场景键由程序绑定到具体功能，执行对应功能时自动生效。`
- 增加自动化检查：每个已注册场景键至少有一个调用方，每个声明需要路由的 AI 调用必须使用已注册场景键。

兼容迁移规则：

- 保留原 `image_polish` 映射，并将其职责收窄为“分镜图片提示词润色”。
- 数据库升级时，如果旧库存在 `image_polish` 映射，则将其 AI 配置和模型覆盖复制到新拆分出的：
  - `omni_segment_generation`
  - `omni_segment_polish`
  - `classic_video_prompt_polish`
  - `continuity_snapshot`
- 仅在目标新 key 尚未配置时执行复制，不能覆盖用户已经配置的新路由。
- 迁移完成后，用户可以分别调整这些场景使用的模型。

## 7. 初始提示词目录

以下为根据当前代码盘点得到的首批必须迁移内容。实现阶段必须继续通过静态扫描补齐遗漏项，最终以“AI 调用链中不存在未注册静态提示词”为准，而不是仅以本表数量为准。

### 7.1 故事与小说

| 建议 `prompt_key` | 名称 | 消息角色 | 关联 `scene_key` |
|---|---|---|---|
| `story.generation.system` | 故事生成系统提示词 | system | `story_generation` |
| `story.generation.user` | 故事生成用户模板 | user_template | `story_generation` |
| `novel.import.user` | 小说章节短剧化改写 | user_template | `novel_import` |

### 7.2 角色、场景、道具提取

| 建议 `prompt_key` | 名称 | 消息角色 | 关联 `scene_key` |
|---|---|---|---|
| `character.extraction.system` | 剧本角色提取规则 | system | `role_extraction` |
| `character.extraction.user` | 剧本角色提取输入模板 | user_template | `role_extraction` |
| `scene.extraction.system` | 剧本场景提取规则 | system | `scene_extraction` |
| `scene.extraction.user` | 剧本场景提取输入模板 | user_template | `scene_extraction` |
| `prop.extraction.system` | 剧本道具提取规则 | system | `prop_extraction` |
| `prop.extraction.user` | 剧本道具提取输入模板 | user_template | `prop_extraction` |

### 7.3 参考图视觉识别

| 建议 `prompt_key` | 名称 | 消息角色 | 关联 `scene_key` |
|---|---|---|---|
| `vision.character.extract.system` | 从参考图提取角色外貌 | system | `vision_character_extract` |
| `vision.character.extract.user` | 角色参考图输入模板 | user_template | `vision_character_extract` |
| `vision.scene.extract.system` | 从参考图提取场景描述 | system | `vision_scene_extract` |
| `vision.scene.extract.user` | 场景参考图输入模板 | user_template | `vision_scene_extract` |
| `vision.prop.extract.system` | 从参考图提取道具描述 | system | `vision_prop_extract` |
| `vision.prop.extract.user` | 道具参考图输入模板 | user_template | `vision_prop_extract` |
| `character.identity_anchors.system` | 角色视觉锚点提炼 | system | `identity_anchors` |
| `character.identity_anchors.user` | 角色视觉锚点输入模板 | user_template | `identity_anchors` |

### 7.4 分镜生成

| 建议 `prompt_key` | 名称 | 消息角色 | 关联 `scene_key` |
|---|---|---|---|
| `storyboard.generation.system` | 分镜生成系统规则 | system | `storyboard_extraction` |
| `storyboard.generation.user` | 分镜生成用户模板 | user_template | `storyboard_extraction` |
| `storyboard.generation.continuation` | 分镜截断续写模板 | user_template | `storyboard_extraction` |
| `storyboard.generation.narration` | 分镜旁白附加规则 | suffix | `storyboard_extraction` |
| `storyboard.generation.universal_mode` | 全能模式分镜附加规则 | suffix | `storyboard_extraction` |
| `storyboard.generation.count_constraint` | 分镜数量约束模板 | suffix | `storyboard_extraction` |
| `storyboard.generation.duration_constraint` | 总时长约束模板 | suffix | `storyboard_extraction` |

### 7.5 分镜帧和布局

| 建议 `prompt_key` | 名称 | 消息角色 | 关联 `scene_key` |
|---|---|---|---|
| `frame.first.system` | 首帧提示词生成规则 | system | `frame_prompt` |
| `frame.key.system` | 关键帧提示词生成规则 | system | `frame_prompt` |
| `frame.last.system` | 尾帧提示词生成规则 | system | `frame_prompt` |
| `frame.first.realistic_scale_contract` | 首帧真实物理尺度约束 | suffix | `frame_prompt` |
| `frame.last.realistic_scale_contract` | 尾帧真实物理尺度约束 | suffix | `frame_prompt` |
| `frame.input.user` | 帧提示词通用输入模板 | user_template | `frame_prompt` |
| `storyboard.layout.regenerate.system` | 画面布局重生成规则 | system | `layout_regenerate` |
| `storyboard.layout.regenerate.user` | 画面布局重生成输入模板 | user_template | `layout_regenerate` |
| `storyboard.continuity_snapshot.system` | 连戏状态摘要规则 | system | `continuity_snapshot` |
| `storyboard.continuity_snapshot.user` | 连戏状态摘要输入模板 | user_template | `continuity_snapshot` |

### 7.6 角色、场景、道具生图提示词

| 建议 `prompt_key` | 名称 | 消息角色 | 关联 `scene_key` |
|---|---|---|---|
| `character.image_polish.system` | 角色生图提示词润色 | system | `role_image_polish` |
| `character.image_polish.user` | 角色生图提示词输入模板 | user_template | `role_image_polish` |
| `character.image_compose` | 角色四视图最终生图提示词 | image_prompt | `role_image_polish` |
| `scene.image_four_view.system` | 场景四视图提示词润色 | system | `scene_image_polish` |
| `scene.image_single.system` | 场景单图提示词润色 | system | `scene_image_polish` |
| `scene.image.user` | 场景生图通用输入模板 | user_template | `scene_image_polish` |
| `scene.image_four_view.final` | 场景四视图最终生图提示词 | image_prompt | `scene_image_polish` |
| `scene.image_single.final` | 场景单图最终生图提示词 | image_prompt | `scene_image_polish` |
| `scene.prompt.translate_zh.user` | 场景提示词翻译中文 | user_template | `scene_extraction` |
| `prop.image_polish.system` | 道具生图提示词润色 | system | `prop_image_polish` |
| `prop.image_polish.user` | 道具生图提示词输入模板 | user_template | `prop_image_polish` |

### 7.7 分镜图片、全能模式和视频

| 建议 `prompt_key` | 名称 | 消息角色 | 关联 `scene_key` |
|---|---|---|---|
| `storyboard.image_polish.system` | 分镜图片提示词润色 | system | `image_polish` |
| `storyboard.image_polish.user` | 分镜图片提示词输入模板 | user_template | `image_polish` |
| `omni.segment.system` | 全能片段生成规则 | system | `omni_segment_generation` |
| `omni.segment.user` | 全能片段输入模板 | user_template | `omni_segment_generation` |
| `omni.segment.polish.system` | 全能片段润色规则 | system | `omni_segment_polish` |
| `omni.segment.polish.user` | 全能片段润色输入模板 | user_template | `omni_segment_polish` |
| `video.classic_polish.system` | 经典分镜视频提示词润色 | system | `classic_video_prompt_polish` |
| `video.classic_polish.user` | 经典分镜视频提示词输入模板 | user_template | `classic_video_prompt_polish` |
| `storyboard.image_prompt.compose` | 分镜图片提示词拼装模板 | image_prompt | 无文本模型路由 |
| `storyboard.video_prompt.compose` | 分镜视频提示词拼装模板 | video_prompt | 无文本模型路由 |

### 7.8 图片/视频技术约束

| 建议 `prompt_key` | 名称 | 消息角色 | 关联 `scene_key` |
|---|---|---|---|
| `image.quad_grid.layout` | 四宫格图片布局要求 | image_prompt | 无 |
| `image.nine_grid.layout` | 九宫格图片布局要求 | image_prompt | 无 |
| `image.reference_context.system` | 参考图上下文说明 | system | 无 |
| `image.reference_generation.user` | 非 Gemini 参考图生图拼装 | image_prompt | 无 |
| `image.negative.anti_split` | 防分屏负向提示词 | negative_prompt | 无 |
| `video.aspect_ratio_mismatch_suffix` | 视频画幅不匹配补充规则 | suffix | 无 |

### 7.9 当前代码缺口

实现本需求时需要同步处理以下已发现问题：

- `scene_image_polish` 已出现在业务场景配置页面，但场景提示词生成调用尚未传入该 `scene_key`。
- `frame_prompt` 已出现在业务场景配置页面，但帧提示词生成调用尚未传入该 `scene_key`。
- `storyboards.js` 调用了 `getClassicVideoPromptPolishPrompt()`，当前 `promptI18n.js` 中没有对应实现或导出。数据库初始化时必须补齐 `video.classic_polish.system`，并改为统一解析。
- `image_polish` 当前同时承载图片润色、全能片段和部分视频提示词润色，本需求已确认拆分为独立 `scene_key`。

## 8. 数据模型建议

建议使用“提示词定义 + 分层内容”两部分。

### 8.1 `prompt_definitions`

```sql
CREATE TABLE prompt_definitions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  prompt_key TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  category TEXT NOT NULL,
  message_role TEXT NOT NULL,
  content_type TEXT NOT NULL DEFAULT 'user_template',
  service_type TEXT NOT NULL DEFAULT 'text',
  scene_key TEXT,
  variable_schema TEXT NOT NULL DEFAULT '{}',
  risk_level TEXT NOT NULL DEFAULT 'normal',
  allow_project_override INTEGER NOT NULL DEFAULT 1,
  sort_order INTEGER NOT NULL DEFAULT 0,
  is_active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
```

### 8.2 `prompt_templates`

```sql
CREATE TABLE prompt_templates (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  definition_id INTEGER NOT NULL,
  scope TEXT NOT NULL,
  drama_id INTEGER,
  locale TEXT NOT NULL DEFAULT 'default',
  content TEXT NOT NULL,
  seed_content TEXT,
  seed_version INTEGER NOT NULL DEFAULT 1,
  version INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  deleted_at TEXT,
  FOREIGN KEY (definition_id) REFERENCES prompt_definitions(id),
  FOREIGN KEY (drama_id) REFERENCES dramas(id)
);
```

约束：

```sql
CREATE UNIQUE INDEX uq_prompt_system
ON prompt_templates(definition_id, locale)
WHERE scope = 'system' AND deleted_at IS NULL;

CREATE UNIQUE INDEX uq_prompt_project
ON prompt_templates(definition_id, drama_id, locale)
WHERE scope = 'project' AND deleted_at IS NULL;
```

数据规则：

- 系统级记录：`scope = system`，`drama_id = NULL`。
- 项目级记录：`scope = project`，`drama_id` 必填。
- `locale` 是旧数据库兼容字段，固定为内部值 `default`，不在 API 或界面暴露。
- `seed_content` 只用于系统级“恢复出厂默认”。
- 项目级“恢复系统值”通过删除项目记录实现，不复制系统值。
- `version` 每次保存加 1，用于并发控制和任务快照。

## 9. API 需求

### 9.1 系统提示词

```text
GET    /settings/prompts
GET    /settings/prompts/:prompt_key
PUT    /settings/prompts/:prompt_key
POST   /settings/prompts/:prompt_key/reset-seed
POST   /settings/prompts/:prompt_key/preview
```

### 9.2 项目提示词

```text
GET    /dramas/:drama_id/prompts
GET    /dramas/:drama_id/prompts/:prompt_key
PUT    /dramas/:drama_id/prompts/:prompt_key
DELETE /dramas/:drama_id/prompts/:prompt_key
POST   /dramas/:drama_id/prompts/:prompt_key/preview
```

项目列表接口返回：

```json
{
  "prompt_key": "character.extraction.system",
  "system_content": "...",
  "project_content": null,
  "effective_content": "...",
  "effective_source": "system",
  "system_version": 3,
  "project_version": null
}
```

保存接口必须携带客户端读取到的 `version`。版本不一致时返回冲突，避免多个页面互相覆盖。

## 10. 初始化与迁移

### 10.1 新数据库

数据库迁移必须：

1. 创建提示词定义和模板表。
2. 写入完整提示词目录。
3. 将当前代码中的默认中文、英文或通用提示词写入系统级记录。
4. 写入变量定义、分类、业务场景和风险级别。
5. 启动后检查所有启用的定义是否存在系统级模板。

初始化完成后，运行时不得再读取代码默认提示词。

### 10.2 已有数据库

迁移顺序：

1. 先写入当前代码默认值作为系统级模板。
2. 读取旧 `prompt_overrides`。
3. 将旧 key 映射到新 `prompt_key`。
4. 使用旧覆盖内容更新对应的系统级模板。
5. 保留更新时间。
6. 迁移成功后停止写入 `prompt_overrides`。
7. 经过一个兼容版本后删除旧表和内存覆盖缓存。

旧 key 映射示例：

| 旧 key | 新 `prompt_key` |
|---|---|
| `story_expansion_system` | `story.generation.system` |
| `storyboard_system` | `storyboard.generation.system` |
| `storyboard_user_suffix` | 追加到 `storyboard.generation.system` |
| `character_extraction` | `character.extraction.system` |
| `scene_extraction` | `scene.extraction.system` |
| `prop_extraction` | `prop.extraction.system` |
| `first_frame_prompt` | `frame.first.system` |
| `key_frame_prompt` | `frame.key.system` |
| `last_frame_prompt` | `frame.last.system` |

### 10.3 版本升级新增提示词

后续版本新增提示词时：

- 通过新数据库迁移插入新的定义和系统模板。
- 对已存在的系统记录使用 `ON CONFLICT DO NOTHING`，不得覆盖用户已编辑内容。
- 新默认版本写入 `seed_content` 和 `seed_version`。
- 是否升级到新版默认值由用户主动确认。

## 11. 兼容性与异常处理

- 系统模板缺失：阻止对应 AI 调用，返回缺失的 `prompt_key`。
- 项目模板缺失：正常回退系统模板。
- 项目已删除：项目模板同步软删除或级联删除。
- 项目模板内容为空：不允许保存。
- 未解析必填变量：阻止 AI 调用并记录变量名。
- 数据库读取失败：返回数据库错误，不使用代码硬编码提示词静默兜底。
- 缓存只能作为性能优化，数据库始终是唯一真实来源。
- 保存、删除或恢复后必须立即失效对应缓存。
- 系统级修改不得覆盖项目级记录。

## 12. 日志与可观测性

每次 AI 调用记录以下信息：

```text
drama_id
prompt_key
prompt_scope
prompt_version
scene_key
ai_config_id
model
```

默认日志不记录完整剧本和完整提示词，避免日志体积过大。调试模式可记录截断后的预览。

## 13. 验收标准

### 13.1 数据初始化

- 全新数据库启动后，提示词表存在完整系统级默认数据。
- “高级设置（提示词）”展示的数量与启用的提示词定义数量一致。
- 页面不再依赖固定 9 条数组。
- 服务重启后修改内容保持不变。

### 13.2 系统级提示词

- 任意系统提示词均可编辑。
- JSON 输出协议等原锁定内容可以编辑，并显示风险提示。
- 保存后，未设置项目覆盖的新任务使用更新内容。
- 恢复出厂默认后，内容回到数据库保存的 `seed_content`。

### 13.3 项目级提示词

- 项目模块中存在明确的“项目提示词”入口。
- 项目 A 可以创建提示词覆盖。
- 项目 A 使用项目提示词。
- 项目 B 未配置覆盖时使用系统提示词。
- 删除项目 A 的覆盖后立即恢复系统提示词。
- 修改系统提示词不会改变项目 A 已保存的覆盖内容。

### 13.4 路由配合

- `role_extraction` 可以使用 Claude，同时读取当前项目的 `character.extraction.system`。
- 未配置 `role_extraction` 路由时，继续使用默认文本模型，但提示词继承规则不变。
- 修改 `scene_key` 模型路由不会修改提示词内容。
- 修改提示词不会修改 AI 模型配置。

### 13.5 完整性

- 代码扫描不得发现直接传给 AI 调用的未注册大段静态提示词。
- 所有静态 system/user/suffix/format/image/video/negative 模板都能在系统提示词列表中找到。
- 最终提示词预览与实际发送内容一致。
- 当前 9 条自定义覆盖数据可以无损迁移。

### 13.6 异步任务

- 任务创建后修改提示词，不影响已经排队的任务。
- 新建任务使用修改后的版本。
- 任务日志可确认使用的提示词来源和版本。

## 14. 测试要求

后端至少覆盖：

- 系统提示词读取。
- 项目提示词优先级。
- 项目缺失时系统回退。
- 系统也缺失时明确报错。
- 中英文和通用模板解析。
- 模板变量校验与渲染。
- 并发版本冲突。
- 项目隔离。
- 异步任务快照。
- 旧 `prompt_overrides` 迁移。
- 缓存失效。
- 模型路由与提示词解析互不干扰。

前端至少覆盖：

- 完整列表加载与分类筛选。
- 系统级编辑、预览、保存、恢复默认。
- 项目级创建覆盖、编辑、恢复继承。
- 来源状态展示。
- 高风险提示。
- 未保存内容提醒。
- 接口错误和版本冲突提示。

## 15. 建议实施顺序

### 第一阶段：数据库与兼容层

- 新建提示词定义和模板表。
- 完成全量提示词盘点和种子数据。
- 迁移旧 `prompt_overrides`。
- 实现统一解析、变量渲染和版本控制服务。

### 第二阶段：系统级管理

- 重构“高级设置（提示词）”。
- 展示完整目录。
- 支持编辑、筛选、预览和恢复出厂默认。

### 第三阶段：项目级管理

- 在项目模块增加入口。
- 实现项目覆盖、继承和恢复。
- 打通 `drama_id` 解析和异步任务快照。

### 第四阶段：清理与补全

- 将所有 AI 调用迁移到统一提示词服务。
- 补齐 `frame_prompt`、`scene_image_polish` 等路由。
- 拆分过度复用的 `image_polish`。
- 删除代码硬编码默认值、旧覆盖表和旧内存缓存。
- 增加静态扫描测试，禁止新增未注册提示词。

## 16. 已确认的产品决策

1. **“所有提示词”的范围**  
   包含所有发送给文本、视觉、图片和视频模型的静态模板、负向提示词、格式协议和技术约束；不包含用户输入和 AI 已生成的业务数据。

2. **原锁定格式完全开放编辑**  
   JSON 格式要求等原锁定内容全部可以直接编辑和保存。编辑任意模板时，编辑器都持续显示“高风险配置，非专业人员请勿编辑。修改 JSON 协议、变量、负向词或技术模板可能导致生成失败。”，不设置进入编辑确认或保存二次确认弹窗。

3. **项目级覆盖范围**  
   所有具备项目上下文、能够解析 `drama_id` 的提示词都允许项目覆盖。

4. **业务场景路由同步整理**  
   本需求同步补齐 `frame_prompt`、`scene_image_polish` 等未接入路由，并拆分当前过度复用的 `image_polish`。

5. **单一中文模板策略**
   全系统移除 `language=en` 配置，每个提示词只管理一份中文模板，不再区分中文、英文和通用。运行时按“项目模板 → 系统模板 → 报错”解析；历史语言模板由迁移合并为内部 `default` 模板，随后硬删除所有旧语言行。

6. **异步任务提示词快照**  
   创建任务时固定有效提示词的 key、层级、版本和内容快照。提示词修改不影响已经创建或排队的任务，只影响修改后创建的新任务。

7. **系统级恢复出厂默认**  
   数据库同时保存当前内容 `content`、出厂内容 `seed_content` 和出厂版本 `seed_version`。系统提示词只能由用户主动恢复出厂默认；软件升级不得自动覆盖用户已修改内容。新版默认值与当前内容不同时，向用户提示并允许查看差异、主动采用。
