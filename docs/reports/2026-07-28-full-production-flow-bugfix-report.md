# JamaAI 全流程测试 Bug 修复文档

## 1. 修复摘要

本轮共修复 10 类问题，覆盖分镜时长、数据库兼容、异步任务、TLS、管理员初始化、依赖安全、Express 5、fal 媒体协议、视频合成真实性和部署门禁。所有已列代码缺陷均已修复并通过自动化或真实链路回归。

| 编号 | 级别 | 问题 | 状态 |
| --- | --- | --- | --- |
| BUG-001 | P1 | 分镜目标时长可被模型结果静默突破 | 已修复 |
| BUG-002 | P1 | MySQL/SQLite 插入返回值差异导致记录关联异常 | 已修复 |
| BUG-003 | P1 | 图像/视频异常路径可能遗留处理中任务 | 已修复 |
| BUG-004 | P1 | 默认允许不安全 TLS，调试模式默认开启 | 已修复 |
| BUG-005 | P1 | 初始管理员密码可预测 | 已修复 |
| BUG-006 | P1 | 生产依赖存在已知漏洞及多余高风险 SDK | 已修复 |
| BUG-007 | P1 | Express 5 不接受旧通配路由，生产启动失败 | 已修复 |
| BUG-008 | P2 | 项目列表头部遮挡，浏览器导入入口误触其他动作 | 已修复 |
| BUG-009 | P1 | fal 本地参考素材不可达，供应商错误信息被覆盖 | 已修复 |
| BUG-010 | P0 | 多片段合成失败时返回第一片段并标记成功 | 已修复 |

## 2. 详细修复

### BUG-001：目标时长约束失效

**现象**

用户设置剧集目标时长后，AI 返回的分镜内容可能明显超过预算，服务仍直接持久化，造成镜头数量、台词长度和成片时长失控。

**根因**

时长规划只做软提示，没有对台词/旁白的最低可读时长和镜头最低时长进行可行性判断；部分记录在完整预算校验前已写入数据库。

**修复**

- 增加对白和旁白最低时长估算。
- 将总时长作为硬约束；内容在给定预算内不可行时明确失败。
- 预算验证成功后再持久化，失败时保留旧分镜。
- 返回实际需要的最小时长范围，便于用户调整。

**主要文件**

- `backend-node/src/services/storyboardDurationPlanner.js`
- `backend-node/src/services/episodeStoryboardService.js`
- `backend-node/test/storyboardDurationPlanner.test.js`

**回归**

目标 25 秒、模型内容最低需 121 秒的真实调用被明确拒绝，原 10 个分镜和 97 秒数据保持不变。

### BUG-002：跨数据库插入结果不一致

**现象**

部分写入逻辑直接依赖 SQLite 风格的 `lastInsertRowid`，MySQL 下可能无法正确获得新记录 ID，后续任务或资源关联异常。

**根因**

数据库适配层没有统一 MySQL `insertId` 和 SQLite `lastInsertRowid`。

**修复**

- 在便携 SQL 层增加统一的插入 ID 读取能力。
- 业务写入统一通过适配方法获取新 ID。
- 增加 MySQL/SQLite 返回结构单元测试。

**主要文件**

- `backend-node/src/db/portableSql.js`
- `backend-node/src/routes/videos.js`
- `backend-node/test/portableSql.test.js`

### BUG-003：异常路径遗留异步任务

**现象**

图像或视频提交在记录创建、供应商调用或保存结果之间失败时，任务可能长期停留在 pending/processing，用户无法判断真实状态。

**根因**

部分异常分支没有同步更新业务记录和统一任务表。

**修复**

- 图像和视频失败路径统一写入失败状态及可读错误。
- 供应商任务、资源记录和任务表保持同步。
- 启动恢复继续负责清理真正失联的旧任务，不误杀可恢复的供应商任务。

**主要文件**

- `backend-node/src/services/imageService.js`
- `backend-node/src/routes/videos.js`
- `backend-node/src/services/taskService.js`

### BUG-004：不安全 TLS 和调试配置

**现象**

默认配置开启 `debug` 和 `insecure_tls`，生产环境可能跳过上游证书校验。

**根因**

开发配置被作为仓库默认值，且缺少明确的环境变量解析规则。

**修复**

- 默认 `debug: false`。
- 默认 `insecure_tls: false`。
- 仅允许隔离测试通过 `JAMA_INSECURE_TLS=1` 显式开启。
- 增加配置策略测试。

**主要文件**

- `backend-node/configs/config.yaml`
- `backend-node/src/config/index.js`
- `backend-node/test/databasePolicy.test.js`

### BUG-005：初始管理员密码可预测

**现象**

首次启动时超级管理员可能使用用户名等可预测默认密码。

**根因**

初始化逻辑缺少随机密码和生产强度校验。

**修复**

- 未显式配置时生成不可预测的一次性密码。
- `JAMA_ADMIN_INITIAL_PASSWORD` 至少需要 12 位。
- 一次性密码仅在首次创建时输出，并提示立即修改。
- 增加生成、校验、登录和账号管理回归测试。

**主要文件**

- `backend-node/src/services/authService.js`
- `backend-node/src/app.js`
- `backend-node/test/authService.test.js`

### BUG-006：生产依赖安全风险

**现象**

前后端生产依赖审计存在漏洞；后端的 Volcengine SDK 引入了额外依赖面。

**根因**

依赖版本长期未升级，签名功能依赖完整 SDK。

**修复**

- 更新 Express、adm-zip、js-yaml、sharp、axios、Element Plus 等依赖。
- 使用前端 overrides 修复传递依赖。
- 移除 `@volcengine/openapi` 和未使用的 UUID 包。
- 使用 Node `crypto.randomUUID()`。
- 增加最小原生 Volcengine 签名实现及官方固定向量测试。
- 发布预检同时审计前端和后端生产依赖。

**主要文件**

- `backend-node/package.json`
- `backend-node/src/utils/volcSigner.js`
- `backend-node/test/volcSigner.test.js`
- `frontweb/package.json`
- `deploy.ps1`

**回归**

前后端生产依赖审计均为 critical=0、high=0、moderate=0、low=0。

### BUG-007：Express 5 生产通配路由不兼容

**现象**

升级 Express 5 后，旧的 `app.get('*')` 路由会在启动时抛错，后端无法提供生产前端。

**根因**

Express 5 的路由匹配规则不再接受旧式裸星号路径。

**修复**

改为无路径中间件，并只处理 GET/HEAD 且排除 `/api`，兼容 Express 4/5 的单页应用回退。

**主要文件**

- `backend-node/src/app.js`

**回归**

后端 5679 成功同源提供生产构建，页面加载和 API 请求正常。

### BUG-008：项目列表头部遮挡

**现象**

项目列表的头部操作区发生重叠，导入按钮区域可能被其他入口覆盖或误触。

**根因**

固定宽度和弹性布局约束不足。

**修复**

调整头部布局、收缩策略和按钮区域层级，确保不同窗口宽度下标题与操作区不重叠。

**主要文件**

- `frontweb/src/views/FilmList.vue`

**回归**

浏览器中项目标题、导入、创建和管理入口均可独立点击，导入按钮不再触发微信入口。

### BUG-009：fal 本地参考素材与错误信息

**现象**

向 fal 提交 `/static` 或 localhost 图片时，外部供应商无法访问；任务轮询还可能用通用 HTTP 错误覆盖供应商返回的具体原因。

**根因**

本地素材 URL 被原样提交给云端，且错误提取优先级不正确。

**修复**

- 仅从受控存储根目录读取本地素材。
- 校验路径、文件类型和大小，转换为供应商支持的数据 URI。
- 禁止目录穿越和任意文件读取。
- 轮询保留供应商返回的具体策略或参数错误。
- 增加本地素材、越界路径、大小限制和错误保留测试。

**主要文件**

- `backend-node/src/services/videoClient.js`
- `backend-node/src/services/modelArkAssetProxyService.js`
- `backend-node/test/falProtocol.test.js`

**回归**

请求成功到达 fal；后续人物相似度 422 策略拒绝被完整返回，证明本地媒体协议问题已排除。

### BUG-010：视频合成伪成功

**现象**

多片段合成遇到缺文件、缺 FFmpeg 或合并失败时，服务可能返回第一个视频 URL，并将任务标记 completed。用户看到“合成成功”，实际结果只有第一段。

**根因**

旧实现将第一片段作为所有失败场景的 fallback，没有区分单片段直通和多片段合成。

**修复**

- 只有单片段且不需要字幕、配音、水印时允许直通。
- 多片段必须全部解析成功且 FFmpeg 可用。
- 合并失败时清理输出、标记失败并同步任务错误。
- 不完整片段、超过限制和编码失败均返回明确错误。
- 发布预检验证 FFmpeg 和 FFprobe。
- 补充缺失的媒体工具复制脚本，并允许仓库跟踪该脚本。

**主要文件**

- `backend-node/src/services/videoMergeService.js`
- `backend-node/test/videoMergeService.test.js`
- `backend-node/scripts/copy-ffmpeg.js`
- `deploy.ps1`
- `.gitignore`

**回归**

- 单片段无后处理：通过。
- 多片段缺 FFmpeg：明确失败。
- 单片段要求后处理但缺 FFmpeg：明确失败。
- 两个真实 MP4：FFmpeg 合并成功，输出 H.264/AAC、2560×1440、10.147166 秒。

## 3. 验证结果

| 验证项 | 结果 |
| --- | --- |
| 后端测试 | 213 / 213 |
| 前端测试 | 50 / 50 |
| 前端生产构建 | 通过 |
| 后端生产依赖审计 | 0 个漏洞 |
| 前端生产依赖审计 | 0 个漏洞 |
| 严格发布预检 | 通过 |
| 代码空白/冲突检查 | 通过 |
| 后端健康检查 | HTTP 200 |

## 4. 未关闭项

以下项目不是尚未修复的本地代码 Bug，但会影响“所有功能可用于生产”的最终承诺：

| 编号 | 类型 | 内容 | 阻断范围 |
| --- | --- | --- | --- |
| GATE-001 | 配置 | 尚未配置 TTS 模型 | 台词/旁白真实配音 |
| GATE-002 | 集成 | 默认 MediaBridge 配置无法直接读取本地参考图，需要公网上传/代理 | 默认参考图生视频 |
| GATE-003 | 合规 | Venice 真人素材需要素材权利人显式授权 | 含真人参考素材的视频 |
| GATE-004 | 供应商策略 | fal 对测试人物相似度请求返回策略拒绝 | 特定人物参考内容 |
| GATE-005 | 发布合规 | FFmpeg/FFprobe 为启用 GPLv3 的静态构建 | 商业制品分发 |
| GATE-006 | 性能 | 主入口 JS 超过 500 kB 提示阈值 | 弱网首屏，非功能阻断 |
| GATE-007 | 正式环境 | 尚未在正式域名、HTTPS、反向代理和备份恢复环境验收 | 正式上线签字 |

这些门禁及处理要求已记录在同日《全流程生产可用性测试报告》第 9 节。

## 5. 发布建议

代码层修复可以进入候选发布版本，但上线流程应保持严格门禁：

```powershell
.\deploy.ps1 -PreflightOnly -StrictAudit
```

只有命令通过、TTS 和默认视频供应商完成生产配置、素材授权完成、FFmpeg 分发合规确认，并在正式基础设施完成一次验收后，才应执行真实部署并签署“全功能生产可用”。
