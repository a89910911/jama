# 系统提示词名称与正文逐条变更清单

> 日期：2026-07-19  
> 范围：第一批简单合并后的 98 个系统级提示词模板；本文保留该阶段的逐条历史对比  
> 当前状态：用途类型重构后为 94 个模板；第二批结构变化见第 11 节，类型重构见第 12 节  
> 第一批结论：98 个模板名称全部优化；9 个模板的正文发生变化（6 个直接改写、3 个合并统一）；89 个模板正文不变。

## 1. 统一修改原则

- 下表保留“原正文”和“新正文”两列：仅 9 条正文发生变化的模板展示正文，89 条正文未变的模板两列统一显示“—”。点击“展开正文”可逐字对比。
- 原正文按改造前实际使用的中文模板取值；没有中文版本时取通用模板。旧英文语言行的硬删除属于语言行清理，不重复计为正文改写。
- 红色标记表示正文修改处：原正文中的红色内容表示被删除或替换，新正文中的红色内容表示新增或替换；3 个合并模板按记录整体替换处理，原正文列仍按原 `prompt_key` 分段展示全部 7 条合并来源。
- 名称统一说明“执行什么动作、处理什么对象、产生什么结果、属于哪类模板”。
- 名称结尾统一使用：`系统规则`、`输入模板`、`附加约束`、`输出格式`、`生图模板`、`视频模板`、`负向词`。
- 95 个沿用模板的 `prompt_key` 未改；3 组合并模板改用新的统一 `prompt_key`，共删除 7 个旧 key、新增 3 个新 key。模板变量、必填变量、消息角色、业务场景、模型路由和运行时调用位置保持兼容。
- 正文变化包括 6 个说明性英文/标签中文化模板，以及 3 个由重复模板合并后统一措辞的模板；JSON 字段、必填变量、Hex 色值、`none`、`unspecified`、`null` 和模型技术关键词保持兼容。
- 6 个直接改写正文的模板已提升 `seed_version`；3 个合并模板使用新的统一 `prompt_key`，合并前的 7 条旧模板记录已删除。对保留 `prompt_key` 的未编辑出厂模板自动升级，用户自定义正文继续保留。

## 2. 故事与小说

| # | prompt_key | 原名称 | 新名称 | 原正文 | 新正文 | 正文修改点 |
|---:|---|---|---|---|---|---|
| 1 | `story.generation.system` | 故事生成系统提示词 | 根据故事梗概生成分集短剧剧本（系统规则） | — | — | 正文不变，仅明确输入来源和输出结果 |
| 2 | `story.generation.user` | 故事生成用户模板 | 故事梗概与剧本生成参数（输入模板） | — | — | 正文不变，仅明确该模板承载梗概与生成参数 |
| 3 | `novel.import.user` | 小说章节短剧化改写 | 将小说章节改写为短剧剧本（输入模板） | — | — | 正文不变，仅明确转换方向和模板类型 |

## 3. 角色、场景、道具提取

| # | prompt_key | 原名称 | 新名称 | 原正文 | 新正文 | 正文修改点 |
|---:|---|---|---|---|---|---|
| 4 | `character.extraction.system` | 剧本角色提取规则 | 从剧本提取角色设定（系统规则） | — | — | 正文不变 |
| 5 | `character.extraction.user` | 剧本角色提取输入模板 | 待提取角色的剧本内容（输入模板） | — | — | 正文不变 |
| 6 | `character.extraction.drama_info` | 角色提取项目资料输入模板 | 角色提取所需的项目资料（输入模板） | — | — | 正文不变 |
| 7 | `scene.extraction.system` | 剧本场景提取规则 | 从剧本提取场景及生图描述（系统规则） | — | — | 正文不变；名称补充“生图描述”结果 |
| 8 | `scene.extraction.user` | 剧本场景提取输入模板 | 待提取场景的剧本内容（输入模板） | — | — | 正文不变 |
| 9 | `prop.extraction.system` | 剧本道具提取规则 | 从剧本提取关键道具及生图描述（系统规则） | — | — | 正文不变；名称补充“关键道具”和“生图描述”结果 |
| 10 | `prop.extraction.user` | 剧本道具提取输入模板 | 待提取道具的剧本内容（输入模板） | — | — | 正文不变 |

## 4. 参考图视觉识别

| # | prompt_key | 原名称 | 新名称 | 原正文 | 新正文 | 正文修改点 |
|---:|---|---|---|---|---|---|
| 11 | `vision.character.extract.system` | 从参考图提取角色描述 | 从角色参考图提取外貌设定（系统规则） | — | — | 正文不变；名称明确忽略背景、提取角色外貌设定 |
| 12 | `vision.character.extract.user` | 角色参考图输入模板 | 角色参考图识别任务（输入模板） | — | — | 正文不变 |
| 13 | `vision.scene.extract.system` | 从参考图提取场景描述 | 从场景参考图提取生图描述（系统规则） | — | — | 正文不变 |
| 14 | `vision.scene.extract.user` | 场景参考图输入模板 | 场景参考图识别任务（输入模板） | — | — | 正文不变 |
| 15 | `vision.prop.extract.system` | 从参考图提取道具描述 | 从道具参考图提取生图描述（系统规则） | — | — | 正文不变 |
| 16 | `vision.prop.extract.user` | 道具参考图输入模板 | 道具参考图识别任务（输入模板） | — | — | 正文不变 |
| 17 | `character.identity_anchors.system` | 角色视觉锚点提炼 | 从角色描述提炼视觉锚点（系统规则） | <details><summary>展开原正文（红色为修改处，1350 字符）</summary><pre><span style="color:#d93025;font-weight:600">You are a character visual analyst. Extract precise visual identity anchors from character appearance descriptions.</span><br><br><span style="color:#d93025;font-weight:600">Output ONLY a valid</span> JSON <span style="color:#d93025;font-weight:600">object with these exact</span> 6 <span style="color:#d93025;font-weight:600">keys:</span><br>{<br>  "face_shape": "<span style="color:#d93025;font-weight:600">precise description of face/skull shape, jawline, cheekbones (e.g. oval face, sharp jawline, high cheekbones)</span>",<br>  "facial_features": "<span style="color:#d93025;font-weight:600">eye</span> <span style="color:#d93025;font-weight:600">shape+color+</span>Hex<span style="color:#d93025;font-weight:600">,</span> <span style="color:#d93025;font-weight:600">nose bridge+tip, lip thickness+shape (e.g. almond eyes</span> #3D2B1F<span style="color:#d93025;font-weight:600">, straight nose, thin lips)</span>",<br>  "unique_marks": "<span style="color:#d93025;font-weight:600">scars, moles, tattoos, birthmarks, distinctive features — or</span> <span style="color:#d93025;font-weight:600">'</span>none<span style="color:#d93025;font-weight:600">'</span>",<br>  "color_anchors": {<br>    "hair": "#HexCode<span style="color:#d93025;font-weight:600"> (e.g.</span> #1A0A00<span style="color:#d93025;font-weight:600"> for black,</span> #C8A96E<span style="color:#d93025;font-weight:600"> for blonde)</span>",<br>    "eyes": "#HexCode",<br>    "skin": "#HexCode<span style="color:#d93025;font-weight:600"> (e.g.</span> #F5DEB3<span style="color:#d93025;font-weight:600"> for wheat,</span> #FDDBB4<span style="color:#d93025;font-weight:600"> for fair)</span>",<br>    "primary_outfit": "#HexCode<span style="color:#d93025;font-weight:600"> of dominant clothing color</span>"<br>  },<br>  "skin_texture": "<span style="color:#d93025;font-weight:600">skin tone description + texture (e.g. fair porcelain smooth, tanned slightly weathered)</span>",<br>  "hair_style": "<span style="color:#d93025;font-weight:600">length + style + texture (e.g. shoulder-length wavy black hair with loose strands, short crew cut)</span>"<br>}<br><br><span style="color:#d93025;font-weight:600">Rules:</span><br>- <span style="color:#d93025;font-weight:600">Use</span> Hex <span style="color:#d93025;font-weight:600">color codes for ALL color values — never use color names like "black" or "brown"</span><br>- <span style="color:#d93025;font-weight:600">Extract ONLY what is explicitly stated; infer</span> Hex <span style="color:#d93025;font-weight:600">values from color descriptions</span><br>- <span style="color:#d93025;font-weight:600">Keep each field concise</span> <span style="color:#d93025;font-weight:600">(</span>1<span style="color:#d93025;font-weight:600">-</span>2 <span style="color:#d93025;font-weight:600">sentences max)</span><br>- <span style="color:#d93025;font-weight:600">If information is missing for a field, write</span> <span style="color:#d93025;font-weight:600">"</span>unspecified<span style="color:#d93025;font-weight:600">"</span><br>- <span style="color:#d93025;font-weight:600">Output ONLY the</span> JSON <span style="color:#d93025;font-weight:600">object, no markdown, no</span> <span style="color:#d93025;font-weight:600">explanation</span></pre></details> | <details><summary>展开新正文（红色为修改处，710 字符）</summary><pre><span style="color:#d93025;font-weight:600">你是一名角色视觉分析师。请从角色外貌描述中提取精确、稳定、可复用的视觉身份锚点。</span><br><br><span style="color:#d93025;font-weight:600">只输出一个合法</span> JSON <span style="color:#d93025;font-weight:600">对象，并严格使用以下</span> 6 <span style="color:#d93025;font-weight:600">个字段：</span><br>{<br>  "face_shape": "<span style="color:#d93025;font-weight:600">精确描述脸型、颌线和颧骨，例如：椭圆脸、下颌线清晰、颧骨较高</span>",<br>  "facial_features": "<span style="color:#d93025;font-weight:600">描述眼形、眼睛颜色与</span> Hex <span style="color:#d93025;font-weight:600">色值、鼻梁与鼻尖、嘴唇厚度与形状，例如：杏眼</span> #3D2B1F<span style="color:#d93025;font-weight:600">、鼻梁挺直、薄唇</span>",<br>  "unique_marks": "<span style="color:#d93025;font-weight:600">疤痕、痣、纹身、胎记或其他辨识特征；没有时固定填写</span> none",<br>  "color_anchors": {<br>    "hair": "#HexCode<span style="color:#d93025;font-weight:600">，例如黑发</span> #1A0A00<span style="color:#d93025;font-weight:600">、金发</span> #C8A96E",<br>    "eyes": "#HexCode",<br>    "skin": "#HexCode<span style="color:#d93025;font-weight:600">，例如小麦肤色</span> #F5DEB3<span style="color:#d93025;font-weight:600">、白皙肤色</span> #FDDBB4",<br>    "primary_outfit": "<span style="color:#d93025;font-weight:600">主要服装颜色的 </span>#HexCode"<br>  },<br>  "skin_texture": "<span style="color:#d93025;font-weight:600">肤色与皮肤质感，例如：白皙瓷感、光滑；小麦肤色、略有风霜感</span>",<br>  "hair_style": "<span style="color:#d93025;font-weight:600">头发长度、造型与质感，例如：及肩黑色波浪发、带少量碎发；短寸</span>"<br>}<br><br><span style="color:#d93025;font-weight:600">规则：</span><br>- <span style="color:#d93025;font-weight:600">所有颜色值必须使用</span> Hex <span style="color:#d93025;font-weight:600">色值，不能只写“黑色”“棕色”等颜色名称。</span><br>- <span style="color:#d93025;font-weight:600">只提取原描述明确提供的信息；可以根据颜色文字合理推断对应</span> Hex <span style="color:#d93025;font-weight:600">色值。</span><br>- <span style="color:#d93025;font-weight:600">每个字段保持简洁，最多</span> 1<span style="color:#d93025;font-weight:600">～</span>2 <span style="color:#d93025;font-weight:600">句。</span><br>- <span style="color:#d93025;font-weight:600">某字段缺少信息时固定填写</span> unspecified<span style="color:#d93025;font-weight:600">。</span><br>- <span style="color:#d93025;font-weight:600">只输出</span> JSON <span style="color:#d93025;font-weight:600">对象，不要</span> <span style="color:#d93025;font-weight:600">Markdown，不要解释。</span></pre></details> | 英文说明、字段解释和示例改为中文；保留 6 个 JSON 字段、Hex 色值、`none`、`unspecified`；`seed_version` 升为 2 |
| 18 | `character.identity_anchors.user` | 角色视觉锚点输入模板 | 待提炼的角色外貌描述（输入模板） | <details><summary>展开原正文（红色为修改处，58 字符）</summary><pre><span style="color:#d93025;font-weight:600">Character appearance description:</span><br>{{character_appearance}}</pre></details> | <details><summary>展开新正文（红色为修改处，36 字符）</summary><pre><span style="color:#d93025;font-weight:600">待分析的角色外貌描述：</span><br>{{character_appearance}}</pre></details> | `Character appearance description` 改为“待分析的角色外貌描述”；保留 `{{character_appearance}}`；`seed_version` 升为 2 |

## 5. 分镜生成

| # | prompt_key | 原名称 | 新名称 | 原正文 | 新正文 | 正文修改点 |
|---:|---|---|---|---|---|---|
| 19 | `storyboard.generation.system` | 分镜生成系统规则 | 将剧本拆解为分镜方案（系统规则） | — | — | 正文不变 |
| 20 | `storyboard.generation.user` | 分镜生成用户模板 | 分镜生成所需剧本与素材（输入模板） | — | — | 正文不变；名称明确包含角色、场景、道具和剧本资料 |
| 21 | `storyboard.generation.requirements` | 分镜要素要求 | 分镜字段与画面描述要求（附加约束） | — | — | 正文不变 |
| 22 | `storyboard.generation.output_contract` | 分镜 JSON 输出协议 | 分镜数组 JSON 返回格式（输出格式） | — | — | 正文不变 |
| 23 | `storyboard.generation.continuation` | 分镜截断续写模板 | 分镜生成中断后的续写指令（输入模板） | — | — | 正文不变 |
| 24 | `storyboard.generation.continuation_narration` | 分镜续写旁白约束 | 分镜续写必须包含旁白（附加约束） | — | — | 正文不变 |
| 25 | `storyboard.generation.continuation_universal` | 分镜续写全能模式约束 | 分镜续写必须使用全能模式（附加约束） | — | — | 正文不变 |
| 26 | `storyboard.generation.narration` | 分镜旁白附加规则 | 全片解说模式的分镜旁白要求（附加约束） | — | — | 正文不变 |
| 27 | `storyboard.generation.universal_mode` | 全能模式分镜附加规则 | 全能模式的分镜新增字段要求（附加约束） | — | — | 正文不变 |
| 28 | `storyboard.generation.count_constraint` | 分镜数量约束模板 | 用户指定分镜数量范围（附加约束） | — | — | 正文不变 |
| 29 | `storyboard.generation.duration_constraint` | 视频总时长约束模板 | 用户指定视频总时长（附加约束） | — | — | 正文不变 |
| 30 | `storyboard.generation.project_clip_duration_constraint` | 项目分段时长优先约束 | 项目单段时长优先规则（附加约束） | — | — | 正文不变 |
| 31 | `storyboard.generation.calculated_shot_duration_constraint` | 计算所得单镜时长约束 | 按总时长计算单镜时长（附加约束） | — | — | 正文不变 |

## 6. 分镜帧、布局与连戏

| # | prompt_key | 原名称 | 新名称 | 原正文 | 新正文 | 正文修改点 |
|---:|---|---|---|---|---|---|
| 32 | `frame.first.system` | 首帧提示词生成规则 | 生成镜头首帧静态生图提示词（系统规则） | — | — | 正文不变 |
| 33 | `frame.key.system` | 关键帧提示词生成规则 | 生成镜头动作高潮关键帧提示词（系统规则） | — | — | 正文不变 |
| 34 | `frame.last.system` | 尾帧提示词生成规则 | 生成镜头动作结束尾帧提示词（系统规则） | — | — | 正文不变 |
| 35 | `frame.input.user` | 首帧/关键帧/尾帧上下文输入模板（合并前 3 条） | 分镜帧镜头信息（输入模板） | <details><summary>展开原正文（红色为修改处，324 字符）</summary><pre><span style="color:#d93025;font-weight:600">【合并前模板 1：frame.first.user｜首帧上下文输入模板】<br>镜头信息：<br>{{frame_context}}<br><br>请直接生成首帧的图像提示词（JSON 的 prompt 字段必须全文中文），不要任何解释：<br><br>【合并前模板 2：frame.key.user｜关键帧上下文输入模板】<br>镜头信息：<br>{{frame_context}}<br><br>请直接生成关键帧的图像提示词（JSON 的 prompt 字段必须全文中文），不要任何解释：<br><br>【合并前模板 3：frame.last.user｜尾帧上下文输入模板】<br>镜头信息：<br>{{frame_context}}<br><br>请直接生成尾帧的图像提示词（JSON 的 prompt 字段必须全文中文），不要任何解释：</span></pre></details> | <details><summary>展开新正文（红色为修改处，80 字符）</summary><pre><span style="color:#d93025;font-weight:600">镜头信息：<br>{{frame_context}}<br><br>请严格按照系统提示词要求生成对应帧的图像提示词（JSON 的 prompt 字段必须全文中文），不要任何解释：</span></pre></details> | 由首帧、关键帧、尾帧 3 个输入模板合并；将具体帧名称统一为“对应帧”；3 条旧模板记录已删除；合并项按记录整体替换，原、新正文整体标红 |
| 36 | `frame.output_contract` | 帧提示词 JSON 输出协议 | 分镜帧提示词 JSON 返回格式（输出格式） | — | — | 正文不变 |
| 37 | `frame.context.compose` | 分镜帧上下文拼装模板 | 拼装分镜帧完整镜头上下文（输入模板） | — | — | 正文不变 |
| 38 | `frame.context.style` | 分镜帧画风约束 | 分镜帧统一画风（附加约束） | — | — | 正文不变 |
| 39 | `frame.context.character_roster` | 分镜帧允许出场角色约束 | 限制分镜帧可出场角色（附加约束） | — | — | 正文不变 |
| 40 | `frame.context.character_anchors` | 分镜帧角色视觉锚点约束 | 锁定分镜帧角色外貌（附加约束） | — | — | 正文不变 |
| 41 | `frame.context.spatial_contract` | 分镜帧空间布局合同 | 锁定分镜帧人物站位与空间布局（附加约束） | — | — | 正文不变；名称去除开发术语“合同” |
| 42 | `frame.first.fallback` | 首帧生成失败回退提示词 | 首帧 AI 生成失败时的回退提示词（生图模板） | — | — | 正文不变；名称明确触发条件 |
| 43 | `frame.key.fallback` | 关键帧生成失败回退提示词 | 关键帧 AI 生成失败时的回退提示词（生图模板） | — | — | 正文不变；名称明确触发条件 |
| 44 | `frame.last.fallback` | 尾帧生成失败回退提示词 | 尾帧 AI 生成失败时的回退提示词（生图模板） | — | — | 正文不变；名称明确触发条件 |
| 45 | `storyboard.layout.regenerate.system` | 画面布局重生成规则 | 重新生成分镜人物站位与空间布局（系统规则） | — | — | 正文不变 |
| 46 | `storyboard.layout.regenerate.user` | 画面布局重生成输入模板 | 待重生成布局的分镜及邻镜信息（输入模板） | — | — | 正文不变 |
| 47 | `storyboard.continuity_snapshot.system` | 连戏状态摘要规则 | 生成分镜连戏状态摘要（系统规则） | <details><summary>展开原正文（红色为修改处，2281 字符）</summary><pre><span style="color:#d93025;font-weight:600">You are a script supervisor (continuity analyst) for a film production.</span><br><br><span style="color:#d93025;font-weight:600">Given a completed image generation prompt for a storyboard shot, extract a structured continuity state snapshot.</span><br><br><span style="color:#d93025;font-weight:600">Output ONLY a valid</span> JSON <span style="color:#d93025;font-weight:600">object — no explanations, no</span> <span style="color:#d93025;font-weight:600">markdown</span> <span style="color:#d93025;font-weight:600">fences.</span><br><br>JSON <span style="color:#d93025;font-weight:600">schema:</span><br>{<br>  "characters": {<br>    "&lt;character_name&gt;": {<br>      "screen_position": "&lt;<span style="color:#d93025;font-weight:600">EXACT screen standing position for layout lock — e.g. 'left third of frame, facing camera', 'right side of frame standing behind table', 'center, slightly left of partner', 'far left background'. Include relative to other characters and camera. This is CRITICAL for position consistency between first/last frames and cross-shot continuity.</span>&gt;",<br>      "body_posture": "&lt;<span style="color:#d93025;font-weight:600">BODY POSTURE only — e.g. 'lying on bed', 'sitting on edge of bed', 'standing', 'kneeling on floor', 'crouching'. NEVER write camera framing here (no 'close-up', 'extreme close-up', etc). If shot is close-up but context implies lying/sitting, infer from scene context</span>&gt;",<br>      "clothing": "&lt;<span style="color:#d93025;font-weight:600">clothing description, e.g. 'white hanfu robe, loosened collar'</span>&gt;",<br>      "expression": "&lt;<span style="color:#d93025;font-weight:600">facial expression, e.g. 'pained, eyes closed', 'tearful, concerned'</span>&gt;",<br>      "props": ["&lt;<span style="color:#d93025;font-weight:600">prop1</span>&gt;", "&lt;<span style="color:#d93025;font-weight:600">prop2</span>&gt;"]<br>    }<br>  },<br>  "lighting": "&lt;<span style="color:#d93025;font-weight:600">color temperature and direction, e.g. 'warm amber sidelight from window'</span>&gt;",<br>  "location": "&lt;<span style="color:#d93025;font-weight:600">scene location, e.g. 'ancient Chinese bedroom, daytime'</span>&gt;",<br>  "overall_composition": "&lt;<span style="color:#d93025;font-weight:600">brief overall layout note e.g. 'two-shot, woman left, man right, medium wide framing'</span>&gt;"<br>}<br><br><span style="color:#d93025;font-weight:600">Rules:</span><br>- <span style="color:#d93025;font-weight:600">Only include characters that are explicitly described in the prompt</span><br>- <span style="color:#d93025;font-weight:600">Keep each field concise (≤15 words)</span><br>- **screen_position <span style="color:#d93025;font-weight:600">is the MOST IMPORTANT field for solving "人物站位经常变"</span>**<span style="color:#d93025;font-weight:600"> — extract or infer precise left/center/right placement + relation to other characters</span>/<span style="color:#d93025;font-weight:600">camera from the prompt description. If the prompt mentions "left", "right", "beside", "opposite", "in front of", use that. For first</span>/<span style="color:#d93025;font-weight:600">last frame pairs this enables layout locking.</span><br>- body_posture <span style="color:#d93025;font-weight:600">MUST describe physical body state, NOT camera shot type. Infer from scene context if needed (e.g. bedroom scene + lying character → 'lying on bed')</span><br>- <span style="color:#d93025;font-weight:600">If a detail truly cannot be determined even by inference, use</span> null<br><br><span style="color:#d93025;font-weight:600">Input:</span><br><span style="color:#d93025;font-weight:600">PROMPT: </span>&lt;<span style="color:#d93025;font-weight:600">the completed image generation </span>prompt&gt;<br><span style="color:#d93025;font-weight:600">ASSETS: </span>&lt;<span style="color:#d93025;font-weight:600">character names present in this shot</span>&gt;</pre></details> | <details><summary>展开新正文（红色为修改处，926 字符）</summary><pre><span style="color:#d93025;font-weight:600">你是一位影视制作连戏监督，负责分析分镜之间的人物状态、站位和环境连续性。</span><br><br><span style="color:#d93025;font-weight:600">请根据一个分镜已经完成的生图提示词，提取结构化连戏状态快照。</span><br><br><span style="color:#d93025;font-weight:600">只输出一个合法</span> JSON <span style="color:#d93025;font-weight:600">对象，不要解释，不要使用</span> <span style="color:#d93025;font-weight:600">Markdown</span> <span style="color:#d93025;font-weight:600">代码块。</span><br><br>JSON <span style="color:#d93025;font-weight:600">结构：</span><br>{<br>  "characters": {<br>    "&lt;character_name&gt;": {<br>      "screen_position": "&lt;<span style="color:#d93025;font-weight:600">用于锁定布局的精确画面站位，例如：画面左侧三分之一、面向镜头；画面右侧、站在桌后；居中且略偏同伴左侧；左后方远景。必须说明与其他人物、镜头的相对位置。</span>&gt;",<br>      "body_posture": "&lt;<span style="color:#d93025;font-weight:600">只描述身体姿态，例如：躺在床上、坐在床沿、站立、跪在地面、蹲伏。禁止填写近景、特写等景别；可根据场景上下文推断坐卧状态。</span>&gt;",<br>      "clothing": "&lt;<span style="color:#d93025;font-weight:600">服装描述，例如：白色汉服长袍、领口微松</span>&gt;",<br>      "expression": "&lt;<span style="color:#d93025;font-weight:600">面部表情，例如：痛苦闭眼、含泪担忧</span>&gt;",<br>      "props": ["&lt;<span style="color:#d93025;font-weight:600">道具1</span>&gt;", "&lt;<span style="color:#d93025;font-weight:600">道具2</span>&gt;"]<br>    }<br>  },<br>  "lighting": "&lt;<span style="color:#d93025;font-weight:600">光线色温与方向，例如：窗户射入的暖琥珀色侧光</span>&gt;",<br>  "location": "&lt;<span style="color:#d93025;font-weight:600">场景地点与时段，例如：古代中式卧房、白天</span>&gt;",<br>  "overall_composition": "&lt;<span style="color:#d93025;font-weight:600">简短整体布局，例如：双人镜头，女左男右，中远景</span>&gt;"<br>}<br><br><span style="color:#d93025;font-weight:600">规则：</span><br>- <span style="color:#d93025;font-weight:600">只包含生图提示词明确描述的角色。</span><br>- <span style="color:#d93025;font-weight:600">每个字段保持简洁，使用短语或短句。</span><br>- **screen_position <span style="color:#d93025;font-weight:600">是解决人物站位漂移的最重要字段</span>**<span style="color:#d93025;font-weight:600">：必须从提示词中提取或合理推断画面左</span>/<span style="color:#d93025;font-weight:600">中</span>/<span style="color:#d93025;font-weight:600">右位置，以及与其他人物和镜头的相对关系。提示词出现左侧、右侧、旁边、对面、前方等信息时必须保留，用于锁定首尾帧和跨镜站位。</span><br>- body_posture <span style="color:#d93025;font-weight:600">必须描述身体状态，不能填写镜头景别。必要时可根据场景推断，例如卧房场景中的人物可推断为“躺在床上”。</span><br>- <span style="color:#d93025;font-weight:600">某项信息经过合理推断仍无法确定时填写</span> null<span style="color:#d93025;font-weight:600">。</span><br><br><span style="color:#d93025;font-weight:600">输入：</span><br><span style="color:#d93025;font-weight:600">已完成的生图提示词：</span>&lt;prompt&gt;<br><span style="color:#d93025;font-weight:600">本镜头角色与素材：</span>&lt;<span style="color:#d93025;font-weight:600">assets</span>&gt;</pre></details> | 英文连戏说明、JSON 字段解释和示例改为中文；保留 JSON 字段、`null` 和站位锁定规则；`seed_version` 升为 2 |
| 48 | `storyboard.continuity_snapshot.user` | 连戏状态摘要输入模板 | 连戏摘要所需提示词与素材（输入模板） | <details><summary>展开原正文（红色为修改处，43 字符）</summary><pre><span style="color:#d93025;font-weight:600">PROMPT: {{image_prompt}}</span><br><span style="color:#d93025;font-weight:600">ASSETS: {{assets}}</span></pre></details> | <details><summary>展开新正文（红色为修改处，49 字符）</summary><pre><span style="color:#d93025;font-weight:600">已完成的生图提示词：</span><br><span style="color:#d93025;font-weight:600">{{image_prompt}}</span><br><br><span style="color:#d93025;font-weight:600">本镜头角色与素材：</span><br><span style="color:#d93025;font-weight:600">{{assets}}</span></pre></details> | `PROMPT`、`ASSETS` 改为中文说明；保留 `{{image_prompt}}`、`{{assets}}`；`seed_version` 升为 2 |

## 7. 角色、场景、道具生图

| # | prompt_key | 原名称 | 新名称 | 原正文 | 新正文 | 正文修改点 |
|---:|---|---|---|---|---|---|
| 49 | `character.image_polish.system` | 角色生图提示词润色 | 将角色描述润色为四视图提示词（系统规则） | — | — | 正文不变 |
| 50 | `character.image_layout` | 角色四视图布局要求 | 角色四视图的画面布局（生图模板） | — | — | 正文不变 |
| 51 | `scene.image_four_view.system` | 场景四视图提示词润色 | 将场景描述润色为四视图提示词（系统规则） | — | — | 正文不变 |
| 52 | `scene.image_four_view.layout` | 场景四视图布局要求 | 场景四视图的画面布局（生图模板） | — | — | 正文不变 |
| 53 | `scene.image_single.system` | 场景单图提示词润色 | 将场景描述润色为单图提示词（系统规则） | — | — | 正文不变 |
| 54 | `scene.image_single.layout` | 场景单图布局要求 | 场景单图的画面布局（生图模板） | — | — | 正文不变 |
| 55 | `prop.image_polish.system` | 道具生图提示词润色 | 将道具描述润色为资产主图提示词（系统规则） | — | — | 正文不变 |
| 56 | `character.image_compose` | 角色四视图最终生图拼装模板 | 拼装角色四视图最终生图提示词（生图模板） | — | — | 正文不变 |
| 57 | `scene.image.compose` | 场景四视图/单图最终生图拼装模板（合并前 2 条） | 拼装场景单图或四视图最终提示词（生图模板） | <details><summary>展开原正文（红色为修改处，533 字符）</summary><pre><span style="color:#d93025;font-weight:600">【合并前模板 1：scene.image_four_view.compose｜场景四视图最终生图拼装模板】<br>【画风·最高优先级】四格统一：{{style_zh}}<br>MANDATORY ART STYLE (all 4 panels): {{style_en}}.<br><br>{{layout_instruction}}<br><br>---<br><br>{{generated_description}}<br><br>---<br><br>Reiterate the same art style in every panel: {{style_en}} {{style_zh}}. No people, no text.<br><br>【合并前模板 2：scene.image_single.compose｜场景单图最终生图拼装模板】<br>【画风·最高优先级】{{style_zh}}<br>MANDATORY ART STYLE: {{style_en}}.<br><br>{{layout_instruction}}<br><br>---<br><br>{{generated_description}}<br><br>---<br><br>Reiterate the same art style: {{style_en}} {{style_zh}}. No people, no text.</span></pre></details> | <details><summary>展开新正文（红色为修改处，268 字符）</summary><pre><span style="color:#d93025;font-weight:600">【画风·最高优先级】{{style_zh}}<br>MANDATORY ART STYLE: {{style_en}}.<br><br>{{layout_instruction}}<br><br>---<br><br>{{generated_description}}<br><br>---<br><br>Reiterate the same art style throughout the entire image and in every panel when a grid is requested: {{style_en}} {{style_zh}}. No people, no text.</span></pre></details> | 由场景四视图、场景单图 2 个拼装模板合并；统一画风标题、英文画风约束和结尾重申语句；2 条旧模板记录已删除；合并项按记录整体替换，原、新正文整体标红 |
| 58 | `character.image_polish.user` | 角色生图提示词输入模板 | 待润色的角色名称与描述（输入模板） | — | — | 正文不变 |
| 59 | `scene.image.user` | 场景四视图/单图输入模板（合并前 2 条） | 待润色的场景地点、时段与描述（输入模板） | <details><summary>展开原正文（红色为修改处，264 字符）</summary><pre><span style="color:#d93025;font-weight:600">【合并前模板 1：scene.image_four_view.user｜场景四视图输入模板】<br>请根据以下场景信息生成四格场景参考图提示词：<br>地点：{{entity_name}}<br>时段：{{entity_time}}<br>描述：{{entity_description}}<br><br>【合并前模板 2：scene.image_single.user｜场景单图输入模板】<br>请根据以下场景信息生成单图场景参考图提示词：<br>地点：{{entity_name}}<br>时段：{{entity_time}}<br>描述：{{entity_description}}</span></pre></details> | <details><summary>展开新正文（红色为修改处，96 字符）</summary><pre><span style="color:#d93025;font-weight:600">请根据以下场景信息，严格按照系统提示词要求生成场景参考图提示词：<br>地点：{{entity_name}}<br>时段：{{entity_time}}<br>描述：{{entity_description}}</span></pre></details> | 由场景四视图、场景单图 2 个输入模板合并；任务说明统一为“严格按照系统提示词要求生成场景参考图提示词”；2 条旧模板记录已删除；合并项按记录整体替换，原、新正文整体标红 |
| 60 | `prop.image_polish.user` | 道具生图提示词输入模板 | 待润色的道具名称、类型与描述（输入模板） | — | — | 正文不变 |
| 61 | `scene.prompt.translate_zh.user` | 场景提示词翻译中文 | 将场景生图提示词翻译为中文（输入模板） | — | — | 正文不变 |

## 8. 分镜图片与视频

| # | prompt_key | 原名称 | 新名称 | 原正文 | 新正文 | 正文修改点 |
|---:|---|---|---|---|---|---|
| 62 | `storyboard.image_polish.system` | 分镜图片提示词润色 | 将分镜描述润色为静态单帧提示词（系统规则） | — | — | 正文不变 |
| 63 | `storyboard.image_polish.user` | 分镜图片提示词输入模板 | 分镜图片润色所需镜头与连戏信息（输入模板） | — | — | 正文不变 |
| 64 | `omni.segment.system` | 全能片段生成规则 | 生成多参考图全能视频片段提示词（系统规则） | — | — | 正文不变；多节拍协议英文固定标签继续保留 |
| 65 | `omni.segment.user` | 全能片段输入模板 | 全能视频片段所需剧本与分镜资料（输入模板） | — | — | 正文不变 |
| 66 | `omni.segment.image_slot_map` | 全能片段图片槽位映射规则 | 全能视频参考图槽位对应关系（输出格式） | — | — | 正文不变 |
| 67 | `omni.segment.image_slot_map_empty` | 全能片段无图槽位规则 | 全能视频无参考图时的槽位规则（输出格式） | — | — | 正文不变 |
| 68 | `omni.segment.line3_scene_reference` | 全能片段场景图第三行合同 | 场景图作为首图时的第三行说明（输出格式） | — | — | 正文不变；名称去除开发术语“合同” |
| 69 | `omni.segment.line3_primary_reference` | 全能片段首图第三行合同 | 普通参考图作为首图时的第三行说明（输出格式） | — | — | 正文不变；名称明确普通参考图场景 |
| 70 | `omni.segment.line3_no_reference` | 全能片段无图第三行合同 | 无参考图时的第三行说明（输出格式） | — | — | 正文不变 |
| 71 | `omni.segment.character_binding_scene_first` | 全能片段场景首图角色绑定规则 | 场景图在首位时的角色图片绑定（输出格式） | — | — | 正文不变 |
| 72 | `omni.segment.character_binding_primary` | 全能片段角色首图绑定规则 | 普通首图模式的角色图片绑定（输出格式） | — | — | 正文不变 |
| 73 | `omni.segment.character_binding_empty` | 全能片段无角色参考绑定规则 | 无角色参考图时的绑定规则（输出格式） | — | — | 正文不变 |
| 74 | `omni.segment.reference_rule` | 全能片段有图引用规则 | 全能视频有参考图时的引用规则（输出格式） | — | — | 正文不变 |
| 75 | `omni.segment.reference_rule_empty` | 全能片段无图引用规则 | 全能视频无参考图时的引用规则（输出格式） | — | — | 正文不变 |
| 76 | `omni.segment.scene_reference_layout` | 全能片段场景拼图处理规则 | 全能视频遇到场景拼图时的处理规则（输出格式） | — | — | 正文不变 |
| 77 | `omni.segment.boundary_changed` | 全能片段段落切换节奏规则 | 切换剧情段落时的视频节奏提示（输出格式） | — | — | 正文不变 |
| 78 | `omni.segment.boundary_same` | 全能片段同段延续节奏规则 | 延续同一段落时的视频节奏提示（输出格式） | — | — | 正文不变 |
| 79 | `omni.segment.polish.system` | 全能片段润色规则 | 润色多参考图全能视频片段提示词（系统规则） | — | — | 正文不变；多节拍协议英文固定标签继续保留 |
| 80 | `omni.segment.polish.user` | 全能片段润色输入模板 | 待润色的全能视频片段资料（输入模板） | — | — | 正文不变 |
| 81 | `video.classic_polish.system` | 经典分镜视频提示词润色 | 润色经典首尾帧图生视频提示词（系统规则） | — | — | 正文不变 |
| 82 | `video.classic_polish.user` | 经典分镜视频提示词输入模板 | 经典图生视频润色所需资料（输入模板） | — | — | 正文不变 |
| 83 | `storyboard.image_prompt.compose` | 分镜图片提示词拼装模板 | 按分镜字段拼装静态首帧提示词（生图模板） | — | — | 正文不变；名称明确实际生成的是静态首帧 |
| 84 | `storyboard.video_prompt.compose` | 分镜视频提示词拼装模板 | 按分镜字段拼装视频生成提示词（视频模板） | — | — | 正文不变 |

## 9. 图片与视频技术约束

| # | prompt_key | 原名称 | 新名称 | 原正文 | 新正文 | 正文修改点 |
|---:|---|---|---|---|---|---|
| 85 | `image.quad_grid.layout` | 四宫格图片布局要求 | 拼装四宫格图片布局与分格内容（生图模板） | — | — | 正文不变 |
| 86 | `image.nine_grid.layout` | 九宫格图片布局要求 | 拼装九宫格图片布局与分格内容（生图模板） | — | — | 正文不变 |
| 87 | `image.reference_context.system` | 参考图上下文说明 | 向模型说明每张参考图对应对象（系统规则） | <details><summary>展开原正文（红色为修改处，288 字符）</summary><pre><span style="color:#d93025;font-weight:600">The following lines map each reference image to its intended subject. Use every image only for identity, appearance, environment or object semantics. Do not copy a reference image's grid, split-screen, border, framing or multi-panel layout into the generated result.</span><br>{{reference_context}}</pre></details> | <details><summary>展开新正文（红色为修改处，101 字符）</summary><pre><span style="color:#d93025;font-weight:600">以下内容说明每张参考图对应的目标对象。每张图片只能用于参考对象身份、外貌、环境或物体语义；禁止把参考图中的宫格、分屏、边框、构图或多面板布局复制到生成结果中。</span><br>{{reference_context}}</pre></details> | 参考图用途与禁止复制宫格/分屏/边框等说明由英文改为中文；保留 `{{reference_context}}`；`seed_version` 升为 3 |
| 88 | `image.negative.anti_split` | 防分屏负向提示词 | 图片安全及防分屏负向提示词（负向词） | — | — | 正文不变；名称补充安全过滤作用 |
| 89 | `video.aspect_ratio_mismatch_suffix` | 视频画幅不匹配补充规则 | 修正视频目标画幅不匹配（附加约束） | — | — | 正文不变 |
| 90 | `image.single_frame.anti_split_suffix` | 单帧防分屏正向后缀 | 禁止单帧图片出现分屏拼图（附加约束） | — | — | 正文不变 |
| 91 | `image.reference_generation.user` | 非 Gemini 参考图生图拼装模板 | 非 Gemini 模型的参考图生图拼装（生图模板） | — | — | 正文不变 |
| 92 | `image.reference.layout_lock_label` | 尾帧首帧参考图标签 | 尾帧生成使用首帧作为布局参考（附加约束） | — | — | 正文不变 |
| 93 | `image.last_frame.layout_lock_suffix` | 尾帧人物站位锁定后缀 | 锁定尾帧人物站位与首帧一致（附加约束） | — | — | 正文不变 |
| 94 | `image.default_cinematic_style` | 缺省电影感生图风格 | 未配置画风时的默认电影感风格（生图模板） | — | — | 正文不变 |
| 95 | `omni.segment.fallback` | 全能片段缺失时回退拼装模板 | 全能片段缺少正文时的回退视频提示词（视频模板） | — | — | 正文不变 |
| 96 | `frame.character_anchor.structured` | 结构化角色视觉锚点拼装模板 | 将角色结构化字段拼装为视觉锚点（附加约束） | <details><summary>展开原正文（红色为修改处，180 字符）</summary><pre><span style="color:#d93025;font-weight:600">Character: </span>{{character_name}}<span style="color:#d93025;font-weight:600">; Face: </span>{{face_shape}}<span style="color:#d93025;font-weight:600">; Features: </span>{{facial_features}}<span style="color:#d93025;font-weight:600">; Hair: </span>{{hair_style}}<span style="color:#d93025;font-weight:600">; Skin: </span>{{skin_texture}}<span style="color:#d93025;font-weight:600">; Colors: </span>{{color_anchors}}<span style="color:#d93025;font-weight:600">; Marks: </span>{{unique_marks}}</pre></details> | <details><summary>展开新正文（红色为修改处，145 字符）</summary><pre><span style="color:#d93025;font-weight:600">角色：</span>{{character_name}}<span style="color:#d93025;font-weight:600">；脸型：</span>{{face_shape}}<span style="color:#d93025;font-weight:600">；五官：</span>{{facial_features}}<span style="color:#d93025;font-weight:600">；发型：</span>{{hair_style}}<span style="color:#d93025;font-weight:600">；肤质：</span>{{skin_texture}}<span style="color:#d93025;font-weight:600">；颜色锚点：</span>{{color_anchors}}<span style="color:#d93025;font-weight:600">；独特标记：</span>{{unique_marks}}</pre></details> | `Character/Face/Features/Hair/Skin/Colors/Marks` 标签改为中文；保留全部 7 个变量；`seed_version` 升为 2 |
| 97 | `frame.character_anchor.fallback` | 角色外貌文本锚点拼装模板 | 将角色外貌文本拼装为视觉锚点（附加约束） | — | — | 正文不变 |
| 98 | `image.realistic_scale_contract` | 真实物理尺度约束 | 锁定真实物体尺寸与道具比例（附加约束） | — | — | 正文不变 |

## 10. 汇总

| 项目 | 数量 |
|---|---:|
| 第一批合并后有效模板 | 98 |
| 第二批合并后最终有效模板 | 93 |
| 用途类型重构后最终有效模板 | 94 |
| 名称修改 | 98 |
| 正文修改 | 9 |
| 正文不变 | 89 |
| `prompt_key` 合并调整 | 3 组（删除 7、新增 3） |
| 变量协议修改 | 0 |
| 业务场景修改 | 0 |
| 模型路由修改 | 0 |

## 11. 第二批技术模板合理收敛补充

第二批没有新增业务规则或改写技术含义，只把“每次固定随主模板发送、没有独立条件”的正文移动到最终模板内。按前述规则，纯移动且文字不变的内容不重复展开“原正文/新正文”；场景模板恢复四视图、单图各自的完整最终正文，避免通用拼装模板掩盖布局差异。

| 最终模板 | 被吸收并删除的旧模板 | 原正文 | 新正文 | 修改点 |
|---|---|---|---|---|
| `storyboard.generation.system` | `storyboard.generation.requirements`、`storyboard.generation.output_contract` | — | — | 系统规则、固定分镜要素要求、JSON 输出协议按实际发送顺序合为一条；文字不变 |
| `frame.first.system`、`frame.key.system`、`frame.last.system` | `frame.output_contract` | — | — | 三个系统模板正文已经分别包含完整 JSON 字段协议，删除重复的独立概括协议；运行时不再重复发送 |
| `character.image_compose` | `character.image_layout` | — | — | 用角色四视图布局全文替换 `{{layout_instruction}}`；布局文字不变，变量由 5 个减少为 4 个 |
| `scene.image_four_view.final` | `scene.image.compose`、`scene.image_four_view.layout` | <span style="color:#d93025;font-weight:600">通用场景拼装正文 + `{{layout_instruction}}`</span> | <span style="color:#d93025;font-weight:600">四视图专用画风开头 + 四视图布局全文 + 生成描述 + 四格统一结尾</span> | 恢复四视图专用语义并内联四视图布局，删除运行时二次拼装 |
| `scene.image_single.final` | `scene.image.compose`、`scene.image_single.layout` | <span style="color:#d93025;font-weight:600">通用场景拼装正文 + `{{layout_instruction}}`</span> | <span style="color:#d93025;font-weight:600">单图专用画风开头 + 单图布局全文 + 生成描述 + 单图统一结尾</span> | 恢复单图专用语义并内联单图布局，删除运行时二次拼装 |

第二批净变化：删除 7 个旧定义，新增 2 个完整场景最终模板，目录由 98 条减少到 93 条。迁移会保留合法的系统自定义和逐项目覆盖，随后物理删除旧定义及旧模板记录。

## 12. 模板用途类型重构补充

除首帧、尾帧适用范围句外，本阶段不改写其他提示词正文。正文变化处如下：

| prompt_key | 原关系 | 新类型/关系 | 原正文 | 新正文 | 修改点 |
|---|---|---|---|---|---|
| `image.reference_generation.user` | `image.reference_context.system` 的技术子模板 | 独立技术模板，无 `parent_prompt_key` | — | — | 正文不变；运行时可以直接拼装非 Gemini 参考图生图提示词，因此提升为独立技术模板 |
| `image.realistic_scale_contract` | 首帧、尾帧共用的一条技术模板 | 删除 | — | — | 正文不变；取消跨主模板共享，系统修改和项目覆盖会分别迁移给下面两条模板 |
| `frame.first.realistic_scale_contract` | 不存在 | `frame.first.system` 的条件子模板 | <span style="color:#d93025;font-weight:600">本铁律同时适用于首帧和尾帧生成，零例外。</span> | <span style="color:#d93025;font-weight:600">本铁律仅适用于首帧生成，零例外。</span> | 其余正文沿用旧尺度约束；适用范围改为仅首帧，由首帧主模板独立管理；`seed_version` 为 2 |
| `frame.last.realistic_scale_contract` | 不存在 | `frame.last.system` 的条件子模板 | <span style="color:#d93025;font-weight:600">本铁律同时适用于首帧和尾帧生成，零例外。</span> | <span style="color:#d93025;font-weight:600">本铁律仅适用于尾帧生成，零例外。</span> | 其余正文沿用旧尺度约束；适用范围改为仅尾帧，由尾帧主模板独立管理；`seed_version` 为 2 |

最终模板用途类型：52 个主模板、39 个条件子模板（其中 6 个回退子类型）、3 个独立技术模板；不设置共享技术模板或独立回退模板类型。

## 13. 回退子类型与 AI 消息角色重构

本阶段不修改任何提示词正文，因此不重复输出原正文、新正文。结构变化如下：

| 调整项 | 原定义 | 新定义 |
|---|---|---|
| 回退模板用途类型 | `template_kind=fallback` | `template_kind=conditional_child`、`template_subtype=fallback` |
| 回退模板数量 | 独立类型 6 条 | 条件子模板中的特殊子类型 6 条 |
| `omni.segment.fallback` 归属 | 无父模板 | `parent_prompt_key=omni.segment.user` |
| `image.default_cinematic_style` 归属 | 无父模板的独立回退入口 | 无固定父模板的特殊回退条件子模板 |
| AI 消息角色 | 混合角色与内容用途，共 7 种旧值 | 只允许 `system`、`user`、`assistant` |
| 技术内容用途 | 存放在 `message_role` | 单独通过 `content_type` 和注入位置表达 |
| 页面筛选 | 有消息角色筛选 | 删除消息角色筛选 |
