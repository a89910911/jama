<template>
  <div class="ai-config-content">
    <el-tabs v-model="activeTab" class="config-tabs">
      <el-tab-pane label="AI 配置" name="configs">
        <div class="tab-content">
          <!-- 普通模式操作栏 -->
          <div v-if="!vendorLock.enabled" class="content-actions">
            <div class="actions-left">
              <el-button type="primary" @click="openAdd">
                <el-icon><Plus /></el-icon>
                添加配置
              </el-button>
              <el-button plain @click="exportConfigs">
                <el-icon><Download /></el-icon>
                导出配置
              </el-button>
              <el-button plain @click="triggerImport">
                <el-icon><Upload /></el-icon>
                导入配置
              </el-button>
              <input ref="importFileRef" type="file" accept=".json" style="display:none" @change="importConfigs" />
              <el-button class="quick-config-btn" type="success" plain @click="openOneKeyVolc">
                <el-icon><MagicStick /></el-icon>
                一键配置火山
              </el-button>
              <el-button class="quick-config-btn" type="success" plain @click="openOneKeyAgnes">
                <el-icon><MagicStick /></el-icon>
                一键配置 Agnes
              </el-button>
              <el-button class="quick-config-btn" type="primary" plain @click="openOneKeyFal">
                <el-icon><MagicStick /></el-icon>
                一键配置 fal.ai
              </el-button>
              <el-button class="quick-config-btn" type="warning" plain @click="openOneKeyVenice">
                <el-icon><MagicStick /></el-icon>
                一键配置 Venice
              </el-button>
              <el-button class="quick-config-btn" type="danger" plain @click="openOneKeyMediaBridge">
                <el-icon><MagicStick /></el-icon>
                一键配置 MediaBridge
              </el-button>
            </div>
            <div class="actions-right">
              <transition name="fade-slide">
                <el-button
                  v-if="selectedRows.length > 0"
                  type="danger"
                  :loading="batchDeleting"
                  @click="onBatchDelete"
                >
                  <el-icon><Delete /></el-icon>
                  删除选中 ({{ selectedRows.length }})
                </el-button>
              </transition>
            </div>
          </div>
          <!-- 锁定模式提示栏 -->
          <div v-else class="vendor-lock-bar">
            <el-alert
              type="info"
              :closable="false"
              class="vendor-lock-tip"
            >
              <template #title>
                <span>🔒 当前为厂商锁定模式，AI 服务由管理员统一配置。你只能修改 <b>API Key</b>、<b>默认模型</b>和<b>默认配置</b>。</span>
              </template>
            </el-alert>
            <el-button type="primary" size="small" class="vendor-bulk-key-btn" @click="openBulkKey">
              <el-icon><Key /></el-icon>
              一键换Key
            </el-button>
          </div>
          <p class="default-tip">
            每种服务类型请设置一条默认配置。文本、图片、分镜图片、视频和 TTS 会在对应生成流程中自动使用各自的默认项。
          </p>
          <el-table
            v-loading="loading"
            :data="list"
            stripe
            style="width: 100%"
            @selection-change="onSelectionChange"
          >
            <el-table-column v-if="!vendorLock.enabled" type="selection" width="46" />
            <el-table-column prop="name" label="名称" min-width="130" />
            <el-table-column prop="provider" label="提供商" width="96" />
            <el-table-column prop="base_url" label="Base URL" min-width="170" show-overflow-tooltip />
            <el-table-column prop="default_model" label="默认模型" min-width="130" show-overflow-tooltip>
              <template #default="{ row }">
                {{ row.default_model || (Array.isArray(row.model) && row.model[0]) || '—' }}
              </template>
            </el-table-column>
            <el-table-column prop="service_type" label="类型" width="148">
              <template #default="{ row }">
                <span :class="['type-badge', 'type-' + row.service_type]">
                  <el-icon class="type-icon">
                    <ChatDotRound v-if="row.service_type === 'text'" />
                    <Picture v-else-if="row.service_type === 'image'" />
                    <Film v-else-if="row.service_type === 'storyboard_image'" />
                    <VideoCamera v-else-if="row.service_type === 'video'" />
                    <Microphone v-else-if="row.service_type === 'tts'" />
                  </el-icon>
                  {{ serviceTypeLabel(row.service_type) }}
                </span>
              </template>
            </el-table-column>
            <el-table-column prop="is_default" label="默认" width="60">
              <template #default="{ row }">
                <el-tag v-if="row.is_default" type="success" size="small">✓</el-tag>
                <span v-else class="no-default">—</span>
              </template>
            </el-table-column>
            <el-table-column label="操作" width="240" fixed="right">
              <template #default="{ row }">
                <el-button link type="primary" size="small" @click="openTest(row)">测试</el-button>
                <el-button
                  v-if="!row.is_default"
                  link
                  type="success"
                  size="small"
                  :loading="defaultingId === row.id"
                  :disabled="defaultingId !== null"
                  @click="onSetDefault(row)"
                >设为默认</el-button>
                <el-button link type="primary" size="small" @click="onRowEdit(row)">{{ vendorLock.enabled ? '修改Key' : '编辑' }}</el-button>
                <el-button v-if="!vendorLock.enabled" link type="danger" size="small" @click="onDelete(row)">删除</el-button>
              </template>
            </el-table-column>
          </el-table>
        </div>
      </el-tab-pane>
      <el-tab-pane label="AI 任务记录" name="ai_records" lazy>
        <div class="tab-content ai-records-tab">
          <AiRequests scope="system" embedded />
        </div>
      </el-tab-pane>
      <el-tab-pane label="高级设置（提示词）" name="prompts">
        <div class="tab-content">
          <PromptEditor />
        </div>
      </el-tab-pane>
      <el-tab-pane label="高级设置（业务场景）" name="sceneModelMap">
        <div class="tab-content">
          <SceneModelMap />
        </div>
      </el-tab-pane>
      <el-tab-pane label="生成设置" name="generation">
        <div class="tab-content generation-settings">
          <section class="settings-card">
            <div class="gs-section-title">AI 创作助手</div>
            <p class="gs-desc">
              开启后，对话、结构化创作和图片生成使用本机 Codex；关闭后，文本走“文本/对话”，普通资源图走“文本生成图片”，分镜图走“分镜图片生成”配置。
              切换后立即保存并作用于新对话，已有对话保持原引擎。
            </p>
            <div class="gs-row assistant-engine-row">
              <span class="gs-label">启用 Codex 引擎</span>
              <el-switch
                v-model="codexAssistantEnabled"
                inline-prompt
                active-text="Codex"
                inactive-text="API"
                :loading="assistantEngineSaving"
                :disabled="assistantEngineSaving"
                style="--el-switch-on-color: var(--brand)"
                @change="saveAssistantEngine"
              />
              <span class="gs-unit">
                {{
                  assistantEngineSaving
                    ? '正在保存…'
                    : codexAssistantEnabled ? '使用 Codex 额度' : '使用 AI 配置中的 API'
                }}
              </span>
            </div>
            <el-alert
              v-if="!codexAssistantEnabled && assistantConfigWarning"
              type="warning"
              :title="assistantConfigWarning"
              :closable="false"
              show-icon
              class="gs-alert"
            />
          </section>

          <section class="settings-card">
            <div class="gs-section-title">一键生成并发设置</div>
            <p class="gs-desc">控制「一键生成视频」和「补全并生成」流水线中，各类任务同时并行生成的数量。并发数越高速度越快，但过高可能触发 API 限流（429 错误）。建议根据你的 API 额度选择。</p>

            <div class="gs-control-stack">
              <div class="gs-row">
                <span class="gs-label">图片并发数</span>
                <el-select
                  v-model="genConcurrencyInput"
                  filterable
                  allow-create
                  default-first-option
                  placeholder="选择或输入并发数"
                  class="gs-select"
                  @change="onConcurrencyChange"
                >
                  <el-option label="1（串行，最稳定）" :value="1" />
                  <el-option label="2" :value="2" />
                  <el-option label="3（默认）" :value="3" />
                  <el-option label="5" :value="5" />
                  <el-option label="8" :value="8" />
                  <el-option label="10" :value="10" />
                </el-select>
                <span class="gs-unit">个任务同时生成</span>
              </div>

              <div class="gs-row">
                <span class="gs-label">视频并发数</span>
                <el-select
                  v-model="genVideoConcurrencyInput"
                  filterable
                  allow-create
                  default-first-option
                  placeholder="选择或输入并发数"
                  class="gs-select"
                  @change="onVideoConcurrencyChange"
                >
                  <el-option label="1（串行，最稳定）" :value="1" />
                  <el-option label="2" :value="2" />
                  <el-option label="3（默认）" :value="3" />
                  <el-option label="5" :value="5" />
                  <el-option label="8" :value="8" />
                  <el-option label="10" :value="10" />
                </el-select>
                <span class="gs-unit">个任务同时生成</span>
              </div>
            </div>

            <div class="gs-save-row">
              <el-button
                type="primary"
                :loading="genSettingSaving"
                @click="saveGenerationSettings"
              >保存并发设置</el-button>
              <el-alert
                v-if="genSettingSaved"
                type="success"
                title="已保存"
                :closable="false"
                show-icon
                class="gs-saved-alert"
              />
            </div>
            <div class="gs-tip-box">
              <div class="gs-tip-title">适用范围</div>
              <ul class="gs-tip-list">
                <li>图片并发：步骤 2 角色图、步骤 4 场景图、步骤 6 分镜图</li>
                <li>视频并发：步骤 7 分镜视频</li>
              </ul>
            </div>
          </section>
        </div>
      </el-tab-pane>
      <el-tab-pane label="MediaBridge 资产管理" name="mediabridge_assets">
        <div class="tab-content">
          <MediaBridgeAssetManagement :configs="list" />
        </div>
      </el-tab-pane>
    </el-tabs>

    <!-- 添加/编辑 -->
    <el-dialog
      v-model="dialogVisible"
      :title="vendorLock.enabled ? '修改 API Key / 默认模型' : (editingId ? '编辑配置' : '添加配置')"
      class="ai-config-editor-dialog"
      width="520px"
      top="5vh"
      append-to-body
      :close-on-click-modal="false"
      @closed="resetForm"
    >
      <!-- 锁定模式：只展示 api_key 和 default_model -->
      <template v-if="vendorLock.enabled">
        <el-descriptions :column="1" border style="margin-bottom: 16px">
          <el-descriptions-item label="名称">{{ form.name }}</el-descriptions-item>
          <el-descriptions-item label="类型">{{ serviceTypeLabel(form.service_type) }}</el-descriptions-item>
          <el-descriptions-item label="厂商">{{ form.provider }}</el-descriptions-item>
        </el-descriptions>
        <el-form ref="formRef" :model="form" label-width="100px">
          <el-form-item prop="api_key" :rules="[{ required: true, message: '请输入 API Key', trigger: 'blur' }]">
            <template #label><span class="form-label-tip">API Key</span></template>
            <el-input
              v-model="form.api_key"
              type="password"
              :placeholder="form.provider === 'jimeng_ai_api' ? '即梦 Session，多个用英文逗号分隔' : '输入你的 API 密钥'"
              show-password
            />
          </el-form-item>
          <el-form-item>
            <template #label><span class="form-label-tip">默认模型</span></template>
            <el-select v-model="form.default_model" clearable style="width: 100%">
              <el-option-group v-for="group in formModelGroups" :key="group.tier" :label="group.label">
                <el-option v-for="option in group.options" :key="option.value" :label="option.label" :value="option.value" />
              </el-option-group>
            </el-select>
            <p class="field-tip">实际调用时使用的模型，可从预设列表中选择。</p>
          </el-form-item>
          <el-form-item>
            <template #label>
              <span class="form-label-tip">设为默认
                <el-tooltip placement="top" popper-class="cfg-tip-popper">
                  <template #content>
                    <div class="cfg-tip-content">
                      每种服务类型只有一个「默认」配置。<br>
                      生成时系统会优先使用默认配置，建议每类至少设一个默认。
                    </div>
                  </template>
                  <el-icon class="tip-icon"><QuestionFilled /></el-icon>
                </el-tooltip>
              </span>
            </template>
            <el-switch v-model="form.is_default" />
          </el-form-item>
        </el-form>
      </template>

      <!-- 普通模式：完整表单 -->
      <el-form v-else ref="formRef" :model="form" :rules="rules" label-width="100px">
        <el-form-item prop="service_type">
          <template #label>
            <span class="form-label-tip">服务类型
              <el-tooltip placement="top" :show-arrow="true" popper-class="cfg-tip-popper">
                <template #content>
                  <div class="cfg-tip-content">
                    <b>文本/对话</b>：用于 AI 生成故事剧本<br>
                    <b>文本生成图片</b>：角色、场景、道具的图片生成（不支持参考图）<br>
                    <b>分镜图片生成</b>：生成分镜图片，支持传入角色参考图<br>
                    <b>视频生成</b>：根据分镜图生成视频片段<br>
                    <b>语音合成 TTS</b>：为分镜对白自动合成语音（点分镜配音按钮时使用）
                  </div>
                </template>
                <el-icon class="tip-icon"><QuestionFilled /></el-icon>
              </el-tooltip>
            </span>
          </template>
          <el-select v-model="form.service_type" placeholder="选择类型" style="width: 100%" @change="onServiceTypeChange">
            <el-option label="文本/对话" value="text" />
            <el-option label="文本生成图片" value="image" />
            <el-option label="分镜图片生成" value="storyboard_image" />
            <el-option label="视频生成" value="video" />
            <el-option label="语音合成 TTS" value="tts" />
          </el-select>
        </el-form-item>
        <el-form-item prop="provider">
          <template #label>
            <span class="form-label-tip">厂商
              <el-tooltip placement="top" popper-class="cfg-tip-popper">
                <template #content>
                  <div class="cfg-tip-content">
                    从下拉选择预设厂商，会自动填入 Base URL 和模型列表。<br>
                    也可直接输入自定义厂商名（需手动填写其他字段）。<br>
                    <b>推荐</b>：通义千问 / 火山引擎，国内访问稳定。
                  </div>
                </template>
                <el-icon class="tip-icon"><QuestionFilled /></el-icon>
              </el-tooltip>
            </span>
          </template>
          <el-select
            v-model="form.provider"
            placeholder="选择预设厂商（自动填充 URL 和模型）"
            clearable
            filterable
            allow-create
            default-first-option
            style="width: 100%"
            @change="onProviderChange"
          >
            <el-option
              v-for="p in availableProviderOptions"
              :key="p.id"
              :label="p.name"
              :value="p.id"
              :class="p.id === '__custom__' ? 'provider-custom-option' : ''"
            />
          </el-select>
        </el-form-item>
        <!-- 接口规范：仅图片/分镜/视频类型显示，预设厂商自动填充；自定义厂商必选 -->
        <el-form-item v-if="form.service_type !== 'text' && form.service_type !== 'tts'">
          <template #label>
            <span class="form-label-tip">接口规范
              <el-icon class="tip-icon" style="cursor:pointer;color:#409eff" @click="showProtocolHelp = true"><QuestionFilled /></el-icon>
            </span>
          </template>
          <el-select v-model="form.api_protocol" style="width: 100%" placeholder="选择接口规范（自定义厂商必选）" clearable>
            <el-option label="OpenAI 兼容（大多数中转站默认）" value="openai" />
            <el-option label="fal.ai 原生协议（Key 认证 + 队列）" value="fal" />
            <el-option label="Venice.ai 原生协议（Bearer + 媒体队列）" value="venice" />
            <el-option label="MediaBridge 原生协议（X-User-Token + Global Ark Seedance）" value="mediabridge" />
            <el-option label="火山引擎（豆包 Seedream / Seedance）" value="volcengine" />
            <el-option label="火山即梦 Seedance 全能（方舟多图参考，Seedance 2.0 等）" value="volcengine_omni" />
            <el-option label="通义万象 DashScope" value="dashscope" />
            <el-option label="Google Gemini（图片 / Veo 视频）" value="gemini" />
            <el-option label="Sora 中转站（multipart/form-data，seconds+size）" value="sora" />
            <el-option label="Veo3 兼容（JSON，images+enhance_prompt，自动翻译英文）" value="veo3" />
            <el-option label="Vidu 视频" value="vidu" />
            <el-option label="可灵 Omni-Video（官方 api-beijing / ffir 中转，O1 全能）" value="kling_omni" />
            <el-option label="xAI Grok Imagine（官方 prompt + aspect_ratio，/v1/videos/generations）" value="xai" />
            <el-option label="NanoBanana" value="nano_banana" />
          </el-select>
        </el-form-item>

        <!-- 接口规范帮助 Dialog -->
        <el-dialog v-model="showProtocolHelp" title="接口规范说明" width="700px" top="5vh">
          <div class="protocol-help">
            <div class="ph-section-title">🖼 图片 / 分镜图 协议</div>
            <el-collapse accordion>
              <el-collapse-item name="fal-img">
                <template #title><span class="ph-tag ph-tag-img">图片</span> fal.ai 原生协议</template>
                <div class="ph-body">
                  <b>认证：</b><code>Authorization: Key FAL_KEY</code><br>
                  <b>GPT Image 2：</b><code>POST https://fal.run/openai/gpt-image-2</code><br>
                  有参考图时自动改用 <code>/openai/gpt-image-2/edit</code>，并解析 <code>images[0].url</code>。
                </div>
              </el-collapse-item>
              <el-collapse-item name="venice-img">
                <template #title><span class="ph-tag ph-tag-img">图片</span> Venice.ai 原生协议</template>
                <div class="ph-body">
                  <b>认证：</b><code>Authorization: Bearer VENICE_API_KEY</code><br>
                  <b>GPT Image 2：</b><code>POST /api/v1/image/generate</code><br>
                  一张参考图使用 <code>/image/edit</code>，多张参考图使用
                  <code>/image/multi-edit</code>，编辑模型自动切换为 <code>gpt-image-2-edit</code>。
                </div>
              </el-collapse-item>
              <el-collapse-item name="openai-img">
                <template #title><span class="ph-tag ph-tag-img">图片</span> OpenAI 兼容 — 绝大多数中转站默认</template>
                <div class="ph-body">
                  <b>适用场景：</b>OpenAI 官方、各类中转/代理站（ChatFire、硅基流动等）<br>
                  <b>Endpoint：</b><code>POST /v1/images/generations</code><br>
                  <pre>{ "model": "dall-e-3", "prompt": "...", "n": 1, "size": "1024x1024" }</pre>
                </div>
              </el-collapse-item>
              <el-collapse-item name="volcengine-img">
                <template #title><span class="ph-tag ph-tag-img">图片</span> 火山引擎 — 豆包 Seedream</template>
                <div class="ph-body">
                  <b>Endpoint：</b><code>POST /api/v3/images/generations</code><br>
                  <b>Base URL：</b><code>https://ark.cn-beijing.volces.com/api/v3</code><br>
                  <pre>{ "model": "doubao-seedream-4-5-251128", "prompt": "...", "size": "1024x1024" }</pre>
                </div>
              </el-collapse-item>
              <el-collapse-item name="dashscope-img">
                <template #title><span class="ph-tag ph-tag-img">图片</span> 通义万象 DashScope</template>
                <div class="ph-body">
                  <b>Base URL：</b><code>https://dashscope.aliyuncs.com</code><br>
                  <b>Endpoint：</b><code>POST /api/v1/services/aigc/text2image/image-synthesis</code>
                </div>
              </el-collapse-item>
              <el-collapse-item name="gemini-img">
                <template #title><span class="ph-tag ph-tag-img">图片</span> Google Gemini</template>
                <div class="ph-body">
                  <b>认证：</b>URL 参数 <code>?key=API_KEY</code><br>
                  <b>Endpoint：</b><code>POST /v1beta/models/{model}:generateContent</code>
                </div>
              </el-collapse-item>
            </el-collapse>

            <div class="ph-section-title" style="margin-top:16px">🎬 视频 协议</div>
            <el-collapse accordion>
              <el-collapse-item name="fal-vid">
                <template #title><span class="ph-tag ph-tag-vid">视频</span> fal.ai Seedance 2.0 队列</template>
                <div class="ph-body">
                  自动按素材选择 <code>text-to-video</code>、<code>image-to-video</code> 或
                  <code>reference-to-video</code>；提交到 <code>queue.fal.run</code> 后轮询
                  <code>request_id</code>，完成时读取 <code>video.url</code>。
                </div>
              </el-collapse-item>
              <el-collapse-item name="venice-vid">
                <template #title><span class="ph-tag ph-tag-vid">视频</span> Venice.ai Seedance 2.0 队列</template>
                <div class="ph-body">
                  自动选择 <code>seedance-2-0-text-to-video</code>、
                  <code>image-to-video</code> 或 <code>reference-to-video</code>；
                  提交到 <code>POST /api/v1/video/queue</code>，再通过
                  <code>POST /api/v1/video/retrieve</code> 获取视频。
                </div>
              </el-collapse-item>
              <el-collapse-item name="openai-vid">
                <template #title><span class="ph-tag ph-tag-vid">视频</span> OpenAI 兼容 — content 数组格式</template>
                <div class="ph-body">
                  <b>适用场景：</b>各类中转站视频接口（ChatFire 等）<br>
                  <b>Endpoint：</b>自定义，如 <code>POST /v1/video/create</code><br>
                  <pre>{ "model": "sora-2-pro",
  "content": [
    { "type": "text", "text": "..." },
    { "type": "image_url", "image_url": { "url": "https://..." }, "role": "reference_image" }
  ],
  "ratio": "9:16", "duration": 5, "watermark": false, "resolution": "720p" }</pre>
                </div>
              </el-collapse-item>
              <el-collapse-item name="sora-vid">
                <template #title><span class="ph-tag ph-tag-vid">视频</span> Sora 中转站 — multipart/form-data</template>
                <div class="ph-body">
                  <b>适用场景：</b>Sora API 格式的中转站<br>
                  <b>默认 Endpoint：</b><code>POST /v1/videos</code>（创建），<code>GET /v1/videos/{taskId}</code>（查询）<br>
                  <b>请求格式：</b>multipart/form-data（非 JSON）<br>
                  <pre>model       = "sora-2"
prompt      = "..."
seconds     = "4" | "8" | "12"
size        = "720x1280" | "1280x720" | "1024x1792" | "1792x1024"
watermark   = "false"
private     = "false"
input_reference = (图片文件，可选)</pre>
                  <b>注意：</b>参考图会自动 resize 到与 size 一致后上传。
                </div>
              </el-collapse-item>
              <el-collapse-item name="veo3-vid">
                <template #title><span class="ph-tag ph-tag-vid">视频</span> Veo3 兼容 — images + enhance_prompt</template>
                <div class="ph-body">
                  <b>适用场景：</b>Veo3 系列模型的 JSON 格式接口<br>
                  <b>默认 Endpoint：</b><code>POST /v1/video/create</code>（创建），<code>GET /v1/video/query?id={taskId}</code>（查询）<br>
                  <pre>{ "model": "veo3.1",
  "prompt": "...",
  "enhance_prompt": true,
  "images": ["data:image/jpeg;base64,..."]
}</pre>
                  <b>注意：</b><code>enhance_prompt: true</code> 会让接口自动将提示词翻译为英文。localhost 图片会自动转为 base64 内嵌。
                </div>
              </el-collapse-item>
              <el-collapse-item name="volcengine-vid">
                <template #title><span class="ph-tag ph-tag-vid">视频</span> 火山引擎 — 豆包 Seedance</template>
                <div class="ph-body">
                  <b>Endpoint：</b><code>POST …/contents/generations/tasks</code>（与后端一致）<br>
                  <b>Base URL：</b><code>https://ark.cn-beijing.volces.com/api/v3</code><br>
                  <pre>{ "model": "doubao-seedance-1-5-pro-251215",
  "content": [{ "type": "text", "text": "..." }],
  "ratio": "9:16", "duration": 5,
  "watermark": false, "resolution": "720p" }</pre>
                </div>
              </el-collapse-item>
              <el-collapse-item name="volcengine-omni-vid">
                <template #title><span class="ph-tag ph-tag-vid">视频</span> 火山即梦 Seedance 全能（多图参考）</template>
                <div class="ph-body">
                  <b>适用：</b>方舟 Seedance 2.0 等支持多参考图的全能链路；与「全能模式」分镜、<code>@图片1</code>… 提示词配合使用。<br>
                  <b>Endpoint：</b><code>POST {base}/contents/generations/tasks</code>，轮询 <code>GET {base}/contents/generations/tasks/{taskId}</code><br>
                  <b>厂商：</b>仍选「火山引擎」，<b>接口规范</b>选本项；模型填控制台接入点（如 <code>doubao-seedance-2-0-260128</code>，以控制台为准）。<br>
                  <pre>{ "model": "doubao-seedance-2-0-260128",
  "task_type": "i2v",
  "content": [
    { "type": "text", "text": "… @图片1 … @图片2 …" },
    { "type": "image_url", "image_url": { "url": "https://..." } },
    { "type": "image_url", "image_url": { "url": "https://..." }, "role": "reference_image" }
  ],
  "ratio": "9:16", "duration": 8, "watermark": false }</pre>
                  <b>说明：</b>全能模式下列均为参考图（场景、角色…），每张均 <code>role: reference_image</code>；最多 9 张，时长 Seedance 2.x 按 4–15 秒吸附。
                </div>
              </el-collapse-item>
              <el-collapse-item name="dashscope-vid">
                <template #title><span class="ph-tag ph-tag-vid">视频</span> 通义万象 DashScope</template>
                <div class="ph-body">
                  <b>Base URL：</b><code>https://dashscope.aliyuncs.com</code><br>
                  <b>Endpoint：</b><code>POST /api/v1/services/aigc/video-generation/video-synthesis</code><br>
                  <pre>{ "model": "wan2.2-kf2v-flash",
  "input": { "prompt": "...", "img_url": "https://..." },
  "parameters": { "size": "1280*720", "duration": 5 } }</pre>
                </div>
              </el-collapse-item>
              <el-collapse-item name="gemini-vid">
                <template #title><span class="ph-tag ph-tag-vid">视频</span> Google Gemini — Veo 视频</template>
                <div class="ph-body">
                  <b>认证：</b>URL 参数 <code>?key=API_KEY</code><br>
                  <b>Endpoint：</b><code>POST /v1beta/models/{model}:generateVideo</code>
                </div>
              </el-collapse-item>
              <el-collapse-item name="vidu-vid">
                <template #title><span class="ph-tag ph-tag-vid">视频</span> Vidu</template>
                <div class="ph-body">
                  <b>适用场景：</b>Vidu 官方及兼容接口<br>
                  <b>认证：</b><code>Authorization: Token {api_key}</code>（非 Bearer）<br>
                  <b>默认 Endpoint：</b><code>POST /ent/v2/img2video</code>（创建），<code>GET /ent/v2/tasks/{taskId}/creations</code>（查询）<br>
                  <pre>{ "model": "viduq3-pro",
  "images": ["https://..."],
  "prompt": "...",
  "duration": 5,
  "resolution": "720p",
  "movement_amplitude": "auto",
  "audio": false,
  "watermark": false
}</pre>
                  <b>注意：</b>官方 api.vidu.cn 用 <code>Token</code> 认证，中转站用 <code>Bearer</code>，系统自动识别。localhost 图片自动上传图床。
                </div>
              </el-collapse-item>
              <el-collapse-item name="jimeng-ai-api-vid">
                <template #title><span class="ph-tag ph-tag-vid">视频</span> Jimeng AI API（自建服务）</template>
                <div class="ph-body">
                  <b>说明：</b>需自行部署 <code>jimeng-free-api-all</code> 等即梦 OpenAI 兼容服务并启动（如 <code>http://127.0.0.1:8000</code>）。本系统仅作为客户端转发请求。<br>
                  <b>Base URL：</b>填你的服务根地址，无尾斜杠。<br>
                  <b>API Key：</b>填即梦网页 <b>Session</b>；多个账号用<b>英文逗号</b>分隔，由对方服务轮询使用。<br>
                  <b>默认路径：</b><code>POST /v1/videos/generations</code>（可在「Endpoint」覆盖）。Seedance 多图需分镜参考图；响应为同步 <code>data[0].url</code>。
                </div>
              </el-collapse-item>
            </el-collapse>
          </div>
          <template #footer>
            <el-button @click="showProtocolHelp = false">关闭</el-button>
          </template>
        </el-dialog>
        <el-form-item prop="name">
          <template #label>
            <span class="form-label-tip">名称
              <el-tooltip content="配置的显示名，用于在列表中区分不同配置，选择厂商后可自动生成。" placement="top" popper-class="cfg-tip-popper">
                <el-icon class="tip-icon"><QuestionFilled /></el-icon>
              </el-tooltip>
            </span>
          </template>
          <el-input v-model="form.name" placeholder="如：OpenAI 图文，可自动生成" />
        </el-form-item>
        <el-form-item prop="base_url">
          <template #label>
            <span class="form-label-tip">Base URL
              <el-tooltip placement="top" popper-class="cfg-tip-popper">
                <template #content>
                  <div class="cfg-tip-content">
                    API 接口地址，选择预设厂商后自动填入，一般无需修改。<br>
                    示例：https://dashscope.aliyuncs.com
                  </div>
                </template>
                <el-icon class="tip-icon"><QuestionFilled /></el-icon>
              </el-tooltip>
            </span>
          </template>
          <el-input
            v-model="form.base_url"
            placeholder="选择预设厂商后自动填充，可修改"
          />
        </el-form-item>
        <el-form-item prop="api_key">
          <template #label>
            <span class="form-label-tip">API Key
              <el-tooltip placement="top" popper-class="cfg-tip-popper">
                <template #content>
                  <div class="cfg-tip-content">
                    在对应 AI 平台申请的密钥，用于身份验证。<br>
                    通义：<b>dashscope.aliyuncs.com</b><br>
                    火山：<b>console.volcengine.com/ark</b>
                  </div>
                </template>
                <el-icon class="tip-icon"><QuestionFilled /></el-icon>
              </el-tooltip>
            </span>
          </template>
          <el-input
            v-model="form.api_key"
            type="password"
            :placeholder="editingId
              ? '已配置时留空表示不修改'
              : (form.provider === 'jimeng_ai_api'
                  ? '即梦 Session，多个用英文逗号分隔'
                  : 'API 密钥')"
            show-password
          />
        </el-form-item>
        <el-form-item v-if="form.service_type === 'video'">
          <template #label><span class="form-label-tip">生成音频</span></template>
          <div>
            <el-switch :model-value="true" disabled />
            <p class="field-tip">视频必须生成声音，此项由系统强制开启，不能关闭。</p>
          </div>
        </el-form-item>
        <template v-if="form.service_type === 'video' && form.api_protocol === 'kling_omni'">
          <el-form-item>
            <template #label><span class="form-label-tip">AccessKey</span></template>
            <el-input
              v-model="form.kling_access_key"
              type="password"
              show-password
              placeholder="可灵开放平台 AccessKey（与 SecretKey 成对，可不填上方 API Key）"
              autocomplete="off"
            />
            <p class="field-tip">
              官方 JWT 规则见
              <a href="https://klingai.com/document-api/apiReference/commonInfo" target="_blank" rel="noopener noreferrer">commonInfo</a>
              （<a href="https://app.klingai.com/cn/dev/document-api/apiReference/commonInfo" target="_blank" rel="noopener noreferrer">中文版</a>）。
              后端使用与官方示例一致的 HS256（<code>iss</code>=AccessKey，<code>exp</code>、<code>nbf</code>）生成 Token。
              若接口返回 <code>1000 Authorization signature is invalid</code>：请确认 AccessKey/SecretKey 未填反、无多余空格；并尝试勾选下方「SecretKey 为 Base64」；
              Base URL 区域（<code>api-beijing.klingai.com</code> / <code>api-singapore.klingai.com</code>）须与密钥所属区域一致。
            </p>
          </el-form-item>
          <el-form-item>
            <template #label><span class="form-label-tip">SecretKey</span></template>
            <el-input
              v-model="form.kling_secret_key"
              type="password"
              show-password
              placeholder="可灵开放平台 SecretKey"
              autocomplete="off"
            />
            <el-checkbox v-model="form.kling_secret_key_base64" style="margin-top: 8px; display: block">
              SecretKey 为 Base64 字符串（解码后的二进制再用于签名；若仍报签名无效可切换此项重试）
            </el-checkbox>
            <p class="field-tip">
              官方域名：<code>POST {base}/v1/videos/omni-video</code>，轮询
              <code>GET {base}/v1/videos/omni-video/{taskId}</code>；飞儿等中转仍为
              <code>/kling/v1/videos/omni-video</code> 与
              <code>/kling/v1/images/omni-image/{taskId}</code>。详见
              <a href="https://klingai.com/document-api/apiReference/model/OmniVideo" target="_blank" rel="noopener noreferrer">OmniVideo</a>。
            </p>
          </el-form-item>
        </template>
        <!-- TTS 专属字段：声音 ID 和 MiniMax Group ID -->
        <template v-if="form.service_type === 'tts'">
          <el-form-item>
            <template #label>
              <span class="form-label-tip">声音 ID
                <el-tooltip placement="top" popper-class="cfg-tip-popper">
                  <template #content>
                    <div class="cfg-tip-content">
                      TTS 合成使用的音色 ID。<br>
                      <b>MiniMax 常用音色：</b><br>
                      female-shaonv（少女）、female-chengshu（成熟）<br>
                      male-qingxin（清新男）、male-zhicheng（知城男）<br>
                      audiobook_female_2（有声书女）、audiobook_male_1（有声书男）
                    </div>
                  </template>
                  <el-icon class="tip-icon"><QuestionFilled /></el-icon>
                </el-tooltip>
              </span>
            </template>
            <el-select
              v-model="form.voice_id"
              filterable
              allow-create
              default-first-option
              placeholder="选择或输入声音 ID"
              style="width: 100%"
            >
              <el-option-group v-if="form.provider === 'fal'" label="fal.ai · Qwen 3 TTS">
                <el-option label="Vivian（中文女声）" value="Vivian" />
                <el-option label="Serena（女声）" value="Serena" />
                <el-option label="Uncle_Fu（中文男声）" value="Uncle_Fu" />
                <el-option label="Dylan（男声）" value="Dylan" />
                <el-option label="Eric（男声）" value="Eric" />
              </el-option-group>
              <el-option-group label="MiniMax 女声">
                <el-option label="female-shaonv（少女）" value="female-shaonv" />
                <el-option label="female-chengshu（成熟）" value="female-chengshu" />
                <el-option label="female-tianmei（甜美）" value="female-tianmei" />
                <el-option label="audiobook_female_2（有声书）" value="audiobook_female_2" />
              </el-option-group>
              <el-option-group label="MiniMax 男声">
                <el-option label="male-qingxin（清新）" value="male-qingxin" />
                <el-option label="male-zhicheng（知城）" value="male-zhicheng" />
                <el-option label="audiobook_male_1（有声书）" value="audiobook_male_1" />
              </el-option-group>
            </el-select>
            <p v-if="form.provider === 'fal'" class="field-tip">fal.ai Qwen 3 TTS 不填时默认使用 Vivian 中文音色。</p>
            <p v-else class="field-tip">MiniMax 必填；不填默认 female-shaonv。</p>
          </el-form-item>
          <el-form-item v-if="form.provider === 'minimax'">
            <template #label>
              <span class="form-label-tip">Group ID
                <el-tooltip placement="top" popper-class="cfg-tip-popper">
                  <template #content>
                    <div class="cfg-tip-content">
                      MiniMax 账号的 GroupId，调用 T2A v2 接口时附在 URL 参数里。<br>
                      登录 <b>platform.minimaxi.com</b> → 账户设置 → 即可查看 GroupId。
                    </div>
                  </template>
                  <el-icon class="tip-icon"><QuestionFilled /></el-icon>
                </el-tooltip>
              </span>
            </template>
            <el-input v-model="form.group_id" placeholder="MiniMax GroupId，如 1234567890" />
            <p class="field-tip">仅 MiniMax T2A 需要此字段。</p>
          </el-form-item>
        </template>

        <!-- 端点配置：视频必填（自定义厂商）；图片/分镜在使用代理或特殊厂商时填写 -->
        <template v-if="form.service_type !== 'text' && form.service_type !== 'tts'">
          <el-form-item>
            <template #label>
              <span class="form-label-tip">提交端点
                <el-tooltip placement="top" popper-class="cfg-tip-popper">
                  <template #content>
                    <div class="cfg-tip-content">
                      接口路径，追加在 Base URL 之后。<br>
                      <b>预设厂商</b>（火山 / 通义 / NanoBanana）留空，系统自动推断。<br>
                      <b>视频自定义厂商</b>必须填写，如 /v1/videos/generations<br>
                      <b>NanoBanana 代理</b>填写代理路径，如 /fal-ai/nano-banana
                    </div>
                  </template>
                  <el-icon class="tip-icon"><QuestionFilled /></el-icon>
                </el-tooltip>
              </span>
            </template>
            <el-input v-model="form.endpoint" :placeholder="form.service_type === 'video' ? '自定义视频厂商必填，如 /v1/videos/generations；预设厂商留空' : '代理或特殊厂商时填写，如 /fal-ai/nano-banana；预设厂商留空'" />
          </el-form-item>
          <el-form-item>
            <template #label>
              <span class="form-label-tip">查询端点
                <el-tooltip placement="top" popper-class="cfg-tip-popper">
                  <template #content>
                    <div class="cfg-tip-content">
                      查询任务状态的接口路径，{taskId} 会被替换为实际任务 ID。<br>
                      <b>预设厂商</b>留空即可，由系统自动推断。<br>
                      <b>视频自定义厂商</b>必须填写，如 /v1/video/tasks/{taskId}<br>
                      <b>图片/NanoBanana</b> 代理若不支持轮询可留空
                    </div>
                  </template>
                  <el-icon class="tip-icon"><QuestionFilled /></el-icon>
                </el-tooltip>
              </span>
            </template>
            <el-input v-model="form.query_endpoint" placeholder="自定义视频厂商必填，如 /v1/video/tasks/{taskId}；预设厂商留空" />
          </el-form-item>
        </template>

        <!-- 接口地址预览：选择厂商/协议后自动展示，帮助用户核对 -->
        <div v-if="endpointPreviewInfo" class="endpoint-preview-box" :class="{ 'ep-box-gemini': endpointPreviewInfo.isGemini }">
          <div class="ep-preview-header">
            <span>📌 系统将使用以下接口地址</span>
            <span v-if="endpointPreviewInfo.isGemini" class="ep-auto-badge ep-badge-gemini">Gemini 固定模式</span>
            <span v-else-if="endpointPreviewInfo.isAuto && form.service_type !== 'text'" class="ep-auto-badge">自动推断</span>
          </div>
          <div class="ep-row">
            <span class="ep-label">提交地址：</span>
            <code class="ep-url">{{ endpointPreviewInfo.submit }}</code>
          </div>
          <div v-if="endpointPreviewInfo.query" class="ep-row">
            <span class="ep-label">查询地址：</span>
            <code class="ep-url">{{ endpointPreviewInfo.query }}</code>
          </div>
          <p v-if="endpointPreviewInfo.isGemini" class="ep-tip ep-tip-warn">
            ⚠️ Gemini 端点由系统根据模型名固定生成，上方「提交端点」和「查询端点」字段对 Gemini 无效，填了也不生效。
          </p>
          <p v-else class="ep-tip">以上为系统推断的实际调用地址（可手动填写上方端点字段来覆盖）</p>
        </div>

        <el-form-item>
          <template #label>
            <span class="form-label-tip">模型列表
              <el-tooltip placement="top" popper-class="cfg-tip-popper">
                <template #content>
                  <div class="cfg-tip-content">
                    该厂商下可用的模型，多个用逗号或换行分隔。<br>
                    可从上方「追加预设模型」下拉快速添加，也可手动输入。
                  </div>
                </template>
                <el-icon class="tip-icon"><QuestionFilled /></el-icon>
              </el-tooltip>
            </span>
          </template>
          <div class="model-row">
            <el-select
              v-model="presetModelPick"
              placeholder="追加预设模型"
              clearable
              filterable
              style="width: 220px; margin-bottom: 8px"
              @change="onPresetModelSelect"
            >
              <el-option-group v-for="group in availableModelGroups" :key="group.tier" :label="group.label">
                <el-option v-for="option in group.options" :key="option.value" :label="option.label" :value="option.value" />
              </el-option-group>
            </el-select>
            <el-button
              v-if="canSyncProviderModels"
              size="small"
              :loading="syncingProviderModels"
              @click="syncProviderModels"
            >同步 Venice 模型</el-button>
          </div>
          <el-input v-model="form.modelText" type="textarea" :rows="2" placeholder="选择预设厂商后自动填入，可编辑；多个用逗号或换行分隔" />
        </el-form-item>
        <el-form-item>
          <template #label>
            <span class="form-label-tip">默认模型
              <el-tooltip content="有多个模型时，实际调用哪个进行生成。建议选响应快、效果好的那个。" placement="top" popper-class="cfg-tip-popper">
                <el-icon class="tip-icon"><QuestionFilled /></el-icon>
              </el-tooltip>
            </span>
          </template>
          <el-select
            v-model="form.default_model"
            :placeholder="formModelList.length ? '从上面模型列表中选一个作为生成时使用的默认' : '请先填写上方模型列表'"
            clearable
            style="width: 100%"
          >
            <el-option-group v-for="group in formModelGroups" :key="group.tier" :label="group.label">
              <el-option v-for="option in group.options" :key="option.value" :label="option.label" :value="option.value" />
            </el-option-group>
          </el-select>
          <p class="field-tip">该配置被选为「默认」时，生成故事/图片/视频将使用此处指定的模型。</p>
        </el-form-item>
        <el-form-item v-if="isDeepSeekOfficialForm">
          <template #label>
            <span class="form-label-tip">思考模式
              <el-tooltip placement="top" popper-class="cfg-tip-popper">
                <template #content>
                  <div class="cfg-tip-content">
                    DeepSeek V4 官方模型用 thinking 参数控制思考模式。<br>
                    关闭思考对应旧 deepseek-chat；开启思考对应旧 deepseek-reasoner。
                  </div>
                </template>
                <el-icon class="tip-icon"><QuestionFilled /></el-icon>
              </el-tooltip>
            </span>
          </template>
          <div class="deepseek-settings">
            <el-radio-group v-model="form.deepseek_thinking">
              <el-radio-button label="disabled">关闭思考</el-radio-button>
              <el-radio-button label="enabled">开启思考</el-radio-button>
            </el-radio-group>
            <el-select
              v-if="form.deepseek_thinking === 'enabled'"
              v-model="form.deepseek_reasoning_effort"
              style="width: 140px"
            >
              <el-option label="high" value="high" />
              <el-option label="max" value="max" />
            </el-select>
          </div>
          <p class="field-tip">官方旧模型名将在 2026-07-24 废弃；新配置建议使用 deepseek-v4-flash 或 deepseek-v4-pro。</p>
        </el-form-item>
        <el-form-item>
          <template #label>
            <span class="form-label-tip">优先级
              <el-tooltip content="同一服务类型有多个配置时，数字越大越优先被调用。默认 0，一般设为 10 即可。" placement="top" popper-class="cfg-tip-popper">
                <el-icon class="tip-icon"><QuestionFilled /></el-icon>
              </el-tooltip>
            </span>
          </template>
          <el-input-number v-model="form.priority" :min="0" :max="999" />
        </el-form-item>
        <el-form-item>
          <template #label>
            <span class="form-label-tip">设为默认
              <el-tooltip placement="top" popper-class="cfg-tip-popper">
                <template #content>
                  <div class="cfg-tip-content">
                    每种服务类型只有一个「默认」配置。<br>
                    生成时系统会优先使用默认配置，建议每类至少设一个默认。
                  </div>
                </template>
                <el-icon class="tip-icon"><QuestionFilled /></el-icon>
              </el-tooltip>
            </span>
          </template>
          <el-switch v-model="form.is_default" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="dialogVisible = false">取消</el-button>
        <el-button type="primary" :loading="saving" @click="submit">确定</el-button>
      </template>
    </el-dialog>

    <!-- 一键配置 fal.ai -->
    <el-dialog
      v-model="oneKeyFalVisible"
      title="一键配置 fal.ai"
      width="560px"
      :close-on-click-modal="false"
      @closed="oneKeyFalKey = ''"
    >
      <div class="one-key-help">
        <div class="one-key-section">
          <div class="one-key-section-title">📋 将自动创建以下配置</div>
          <ul class="one-key-list">
            <li><b>文本/对话</b>：GPT 5.5（<code>openai/gpt-5.5</code>）</li>
            <li><b>文本生成图片</b>：GPT Image 2（<code>openai/gpt-image-2</code>）</li>
            <li><b>分镜图片生成</b>：GPT Image 2 Edit，自动使用参考图</li>
            <li><b>视频生成</b>：Seedance 2.0，自动选择文生视频、首尾帧或多参考图接口</li>
            <li><b>语音合成 TTS</b>：Qwen 3 TTS 1.7B，默认中文 Vivian 音色</li>
          </ul>
        </div>
        <div class="one-key-section">
          <div class="one-key-section-title">🔑 fal.ai API Key</div>
          <p class="one-key-note">
            在
            <a href="https://fal.ai/dashboard/keys" target="_blank" rel="noopener noreferrer" class="one-key-link">fal.ai/dashboard/keys</a>
            创建 API scope Key；同一个 Key 用于以上五项服务。
          </p>
        </div>
      </div>
      <el-form label-width="0" style="margin-top: 8px">
        <el-form-item>
          <el-input
            v-model="oneKeyFalKey"
            type="password"
            placeholder="请输入 fal.ai API Key"
            show-password-on="click"
            clearable
          />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="oneKeyFalVisible = false">取消</el-button>
        <el-button
          type="primary"
          :loading="oneKeyFalSaving"
          :disabled="!oneKeyFalKey.trim()"
          @click="submitOneKeyFal"
        >
          确定，一键创建配置
        </el-button>
      </template>
    </el-dialog>

    <!-- 一键配置 Venice.ai -->
    <el-dialog
      v-model="oneKeyVeniceVisible"
      title="一键配置 Venice.ai"
      width="560px"
      :close-on-click-modal="false"
      @closed="oneKeyVeniceKey = ''"
    >
      <div class="one-key-help">
        <div class="one-key-section">
          <div class="one-key-section-title">📋 将自动创建以下配置</div>
          <ul class="one-key-list">
            <li><b>文本/对话</b>：GPT 5.5（<code>openai-gpt-55</code>）</li>
            <li><b>文本生成图片</b>：GPT Image 2（<code>gpt-image-2</code>）</li>
            <li><b>分镜图片生成</b>：自动使用 <code>gpt-image-2-edit</code> 处理参考图</li>
            <li><b>视频生成</b>：Seedance 2.0，自动选择文生、图生或多参考图模型</li>
          </ul>
        </div>
        <div class="one-key-section">
          <div class="one-key-section-title">🔑 Venice.ai API Key</div>
          <p class="one-key-note">
            在
            <a href="https://venice.ai/settings/api" target="_blank" rel="noopener noreferrer" class="one-key-link">venice.ai/settings/api</a>
            创建 Key；同一把 Key 用于以上四项服务。
          </p>
        </div>
      </div>
      <el-form label-width="0" style="margin-top: 8px">
        <el-form-item>
          <el-input
            v-model="oneKeyVeniceKey"
            type="password"
            placeholder="请输入 Venice.ai API Key"
            show-password-on="click"
            clearable
          />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="oneKeyVeniceVisible = false">取消</el-button>
        <el-button
          type="primary"
          :loading="oneKeyVeniceSaving"
          :disabled="!oneKeyVeniceKey.trim()"
          @click="submitOneKeyVenice"
        >
          确定，一键创建配置
        </el-button>
      </template>
    </el-dialog>

    <!-- 一键配置 MediaBridge -->
    <el-dialog
      v-model="oneKeyMediaBridgeVisible"
      title="一键配置 MediaBridge Global Ark Seedance"
      width="580px"
      :close-on-click-modal="false"
      @closed="oneKeyMediaBridgeKey = ''"
    >
      <div class="one-key-help">
        <div class="one-key-section">
          <div class="one-key-section-title">📋 将自动创建以下视频配置</div>
          <ul class="one-key-list">
            <li><b>Seedance 2.0</b>：<code>seedance-2-0</code>，支持最高 4K</li>
            <li><b>Seedance 2.0 Fast</b>：<code>seedance-2-0-fast</code>，支持 480p / 720p</li>
            <li><b>Seedance 2.0 Mini</b>：<code>seedance-2-0-mini</code>，支持 480p / 720p</li>
            <li>角色图、首尾帧和多参考图会自动注册为 MediaBridge 用户素材。</li>
          </ul>
        </div>
        <div class="one-key-section">
          <div class="one-key-section-title">🔑 MediaBridge API Key</div>
          <p class="one-key-note">
            请填写 MediaBridge API Key 页面创建并启用的 32 位 Key；系统使用
            <code>X-User-Token</code> 认证。
          </p>
        </div>
      </div>
      <el-form label-width="0" style="margin-top: 8px">
        <el-form-item>
          <el-input
            v-model="oneKeyMediaBridgeKey"
            type="password"
            placeholder="请输入 MediaBridge API Key"
            show-password-on="click"
            clearable
          />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="oneKeyMediaBridgeVisible = false">取消</el-button>
        <el-button
          type="danger"
          :loading="oneKeyMediaBridgeSaving"
          :disabled="!oneKeyMediaBridgeKey.trim()"
          @click="submitOneKeyMediaBridge"
        >
          确定，创建视频配置
        </el-button>
      </template>
    </el-dialog>

    <!-- 一键配置火山 -->
    <el-dialog
      v-model="oneKeyVolcVisible"
      title="一键配置火山引擎（方舟）"
      width="520px"
      :close-on-click-modal="false"
      @closed="oneKeyVolcKey = ''"
    >
      <div class="one-key-help">
        <div class="one-key-section">
          <div class="one-key-section-title">📋 将自动创建以下配置</div>
          <ul class="one-key-list">
            <li><b>文本/对话</b>：DeepSeek V3（deepseek-v3-2-251201）— 生成故事剧本</li>
            <li><b>文本生成图片</b>：即梦 4.5（doubao-seedream-4-5-251128）— 角色/场景/道具图</li>
            <li><b>分镜图片生成</b>：即梦 4.5（doubao-seedream-4-5-251128）— 支持角色参考图</li>
            <li><b>视频生成</b>：即梦 Seedance 1.5 Pro — 生成视频片段</li>
          </ul>
        </div>
        <div class="one-key-section">
          <div class="one-key-section-title">🔑 如何申请 API Key</div>
          <ol class="one-key-list">
            <li>前往火山引擎方舟控制台：<a href="https://console.volcengine.com/ark" target="_blank" class="one-key-link">console.volcengine.com/ark</a></li>
            <li>注册/登录字节跳动火山引擎账号（新用户有免费 token 额度）</li>
            <li>左侧菜单点击「API Key 管理」→「创建 API Key」</li>
            <li>复制生成的 Key 填入下方</li>
          </ol>
          <p class="one-key-note">💡 方舟平台一个 Key 同时支持豆包文本、即梦图片与视频等所有服务</p>
          <p class="one-key-note">⚠️ 视频生成需在控制台「开通」对应模型（即梦 Seedance）后方可使用</p>
        </div>
      </div>
      <el-form label-width="0" style="margin-top: 8px">
        <el-form-item>
          <el-input
            v-model="oneKeyVolcKey"
            type="password"
            placeholder="请输入火山引擎（方舟）API Key"
            show-password-on="click"
            clearable
          />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="oneKeyVolcVisible = false">取消</el-button>
        <el-button type="success" :loading="oneKeyVolcSaving" :disabled="!oneKeyVolcKey.trim()" @click="submitOneKeyVolc">
          确定，一键创建配置
        </el-button>
      </template>
    </el-dialog>

    <!-- 一键配置 Agnes -->
    <el-dialog
      v-model="oneKeyAgnesVisible"
      title="一键配置 Agnes AI"
      width="520px"
      :close-on-click-modal="false"
      @closed="oneKeyAgnesKey = ''"
    >
      <div class="one-key-help">
        <div class="one-key-section">
          <div class="one-key-section-title">📋 将自动创建以下配置</div>
          <ul class="one-key-list">
            <li><b>文本/对话</b>：Agnes 2.0 Flash（agnes-2.0-flash）— 生成故事剧本</li>
            <li><b>文本生成图片</b>：Agnes Image 2.1 Flash — 角色/场景/道具图</li>
            <li><b>分镜图片生成</b>：Agnes Image 2.1 Flash — 支持参考图编辑</li>
            <li><b>视频生成</b>：Agnes Video V2.0（agnes-video-v2.0）— 生成视频片段</li>
          </ul>
        </div>
        <div class="one-key-section">
          <div class="one-key-section-title">🔑 如何申请 API Key</div>
          <ol class="one-key-list">
            <li>前往 Agnes 平台：<a href="https://platform.agnes-ai.com/settings/apiKeys" target="_blank" class="one-key-link">platform.agnes-ai.com/settings/apiKeys</a></li>
            <li>注册/登录账号，进入 Settings → API Keys</li>
            <li>点击「Create new secret key」创建密钥</li>
            <li>复制 Key 填入下方</li>
          </ol>
          <p class="one-key-note">💡 一个 Key 同时支持文本、图片、视频；接口文档见 <a href="https://agnes-ai.com/doc/agnes-20-flash" target="_blank" class="one-key-link">agnes-ai.com/doc</a></p>
        </div>
      </div>
      <el-form label-width="0" style="margin-top: 8px">
        <el-form-item>
          <el-input
            v-model="oneKeyAgnesKey"
            type="password"
            placeholder="请输入 Agnes API Key"
            show-password-on="click"
            clearable
          />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="oneKeyAgnesVisible = false">取消</el-button>
        <el-button type="success" :loading="oneKeyAgnesSaving" :disabled="!oneKeyAgnesKey.trim()" @click="submitOneKeyAgnes">
          确定，一键创建配置
        </el-button>
      </template>
    </el-dialog>

    <!-- 测试连接 -->
    <el-dialog v-model="testVisible" title="测试连接" width="420px">
      <p v-if="testResult === null">正在测试…</p>
      <template v-else-if="testResult">
        <el-alert
          v-if="testServiceType === 'image' || testServiceType === 'storyboard_image' || testServiceType === 'video'"
          type="success"
          title="连接成功"
          description="API Key 有效，网络已连通。提示：测试仅验证 Key 合法性，不实际生成图片/视频，模型名填错、账号未开通该功能或配额不足时实际生成仍可能报错。"
          show-icon
          :closable="false"
        />
        <el-alert
          v-else
          type="success"
          title="连接成功"
          description="文本生成接口已正常响应。"
          show-icon
          :closable="false"
        />
      </template>
      <el-alert v-else type="error" :title="testError || '连接失败'" show-icon :closable="false" />
      <template #footer>
        <el-button @click="testVisible = false">关闭</el-button>
      </template>
    </el-dialog>

    <!-- 一键换Key（锁定模式） -->
    <el-dialog v-model="bulkKeyVisible" title="一键换Key" width="440px" :close-on-click-modal="false">
      <el-alert
        type="warning"
        :closable="false"
        style="margin-bottom: 16px"
        title="此操作将替换所有配置的 API Key，请确认新 Key 可用后再提交。"
        show-icon
      />
      <el-form label-width="80px">
        <el-form-item label="新 API Key">
          <el-input
            v-model="bulkKeyInput"
            type="password"
            show-password
            placeholder="粘贴新的 API Key"
            clearable
          />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="bulkKeyVisible = false">取消</el-button>
        <el-button type="primary" :loading="bulkKeySaving" :disabled="!bulkKeyInput.trim()" @click="submitBulkKey">确认替换</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup>
import { ref, computed, onMounted, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { ElMessage, ElMessageBox } from 'element-plus'
import { Plus, MagicStick, QuestionFilled, Download, Upload, Delete, ChatDotRound, Picture, Film, VideoCamera, Key, Microphone } from '@element-plus/icons-vue'
import { aiAPI } from '@/api/ai'
import { assistantSettingsAPI, generationSettingsAPI } from '@/api/prompts'
import { groupModelOptions } from '@/config/aiModelCatalog'
import PromptEditor from '@/components/PromptEditor.vue'
import SceneModelMap from '@/components/SceneModelMap.vue'
import MediaBridgeAssetManagement from '@/components/MediaBridgeAssetManagement.vue'
import AiRequests from '@/views/AiRequests.vue'

const LEGACY_MEDIA_PROVIDER = atob('aG9seWNyYWI=')
const MEDIA_BRIDGE_API_BASE = `https://abgzfc.${LEGACY_MEDIA_PROVIDER}.ai`

const route = useRoute()
const router = useRouter()
const tabNames = new Set(['configs', 'ai_records', 'prompts', 'sceneModelMap', 'generation', 'mediabridge_assets'])
const activeTab = ref(tabNames.has(String(route.query.tab || '')) ? String(route.query.tab) : 'configs')
const importFileRef = ref(null)

watch(() => route.query.tab, (value) => {
  const next = String(value || '')
  if (tabNames.has(next) && activeTab.value !== next) activeTab.value = next
})
watch(activeTab, (value) => {
  if (String(route.query.tab || '') === value) return
  router.replace({ query: { ...route.query, tab: value } })
})

// ---- 生成设置 ----
const genConcurrencyInput = ref(3)
const genVideoConcurrencyInput = ref(3)
const codexAssistantEnabled = ref(false)
const assistantConfiguredStatus = ref(null)
const assistantEngineSaving = ref(false)
const genSettingSaving = ref(false)
const genSettingSaved = ref(false)

const assistantConfigWarning = computed(() => {
  const configured = assistantConfiguredStatus.value
  if (!configured) return ''
  const missing = [
    ['text', '文本/对话'],
    ['image', '文本生成图片'],
    ['storyboard_image', '分镜图片生成'],
  ].filter(([key]) => !configured[key]?.available).map(([, label]) => label)
  return missing.length ? `尚未配置：${missing.join('、')}。对应能力暂不可用。` : ''
})

async function loadGenerationSettings() {
  try {
    const [generation, assistant] = await Promise.all([
      generationSettingsAPI.get(),
      assistantSettingsAPI.get(),
    ])
    genConcurrencyInput.value = generation?.concurrency ?? 3
    genVideoConcurrencyInput.value = generation?.video_concurrency ?? 3
    codexAssistantEnabled.value = assistant?.engine === 'codex'
    assistantConfiguredStatus.value = assistant?.configured_api || null
  } catch (_) {}
}

function onConcurrencyChange(val) {
  const n = Number(val)
  if (!isNaN(n) && n >= 1) genConcurrencyInput.value = Math.min(20, Math.max(1, Math.round(n)))
}

function onVideoConcurrencyChange(val) {
  const n = Number(val)
  if (!isNaN(n) && n >= 1) genVideoConcurrencyInput.value = Math.min(20, Math.max(1, Math.round(n)))
}

async function saveAssistantEngine(enabled) {
  if (assistantEngineSaving.value) return
  assistantEngineSaving.value = true
  try {
    const assistant = await assistantSettingsAPI.update({
      engine: enabled ? 'codex' : 'configured_api',
    })
    if (assistant?.engine) {
      codexAssistantEnabled.value = assistant.engine === 'codex'
    }
    assistantConfiguredStatus.value = assistant?.configured_api || assistantConfiguredStatus.value
    ElMessage.success(
      codexAssistantEnabled.value
        ? '已切换为 Codex 引擎，新对话将使用 Codex 额度'
        : '已切换为 AI 配置 API，新对话将使用对应 API'
    )
  } catch (e) {
    codexAssistantEnabled.value = !enabled
    ElMessage.error('切换助手引擎失败：' + (e?.message || ''))
  } finally {
    assistantEngineSaving.value = false
  }
}

async function saveGenerationSettings() {
  const n = Number(genConcurrencyInput.value)
  const nv = Number(genVideoConcurrencyInput.value)
  if (isNaN(n) || n < 1 || n > 20) {
    ElMessage.warning('图片并发数请填写 1-20 之间的整数')
    return
  }
  if (isNaN(nv) || nv < 1 || nv > 20) {
    ElMessage.warning('视频并发数请填写 1-20 之间的整数')
    return
  }
  genSettingSaving.value = true
  genSettingSaved.value = false
  try {
    await generationSettingsAPI.update({
      concurrency: Math.round(n),
      video_concurrency: Math.round(nv),
    })
    genSettingSaved.value = true
    setTimeout(() => { genSettingSaved.value = false }, 2000)
  } catch (e) {
    ElMessage.error('保存失败：' + (e?.message || ''))
  } finally {
    genSettingSaving.value = false
  }
}
const loading = ref(false)
const list = ref([])
const selectedRows = ref([])
const batchDeleting = ref(false)
const defaultingId = ref(null)
const vendorLock = ref({ enabled: false, config_file: '' })
const dialogVisible = ref(false)
const editingId = ref(null)
const saving = ref(false)
const showProtocolHelp = ref(false)
const bulkKeyVisible = ref(false)
const bulkKeyInput = ref('')
const bulkKeySaving = ref(false)
const formRef = ref(null)
const form = ref({
  service_type: 'text',
  name: '',
  provider: '',
  api_protocol: '',
  base_url: '',
  api_key: '',
  endpoint: '',
  query_endpoint: '',
  modelText: '',
  default_model: '',
  deepseek_thinking: 'disabled',
  deepseek_reasoning_effort: 'high',
  priority: 0,
  is_default: false,
  // 可灵 Omni 官方 AK/SK（存 settings，后端生成 JWT）
  kling_access_key: '',
  kling_secret_key: '',
  kling_secret_key_base64: false,
  // TTS 专属字段
  voice_id: '',
  group_id: '',
})
const presetModelPick = ref('')
const remoteProviderModels = ref([])
const syncingProviderModels = ref(false)

const formModelList = computed(() => parseModelText(form.value.modelText))
const remoteProviderModelIds = computed(() => remoteProviderModels.value.map((item) => item.id))
const formModelGroups = computed(() => groupModelOptions(
  formModelList.value,
  form.value.service_type,
  form.value.provider,
  remoteProviderModelIds.value
))

// 保证「生成时默认使用」下拉有可选且选中值在列表内，否则会不显示或修改无效
watch(
  () => [formModelList.value, form.value.default_model],
  () => {
    const list = formModelList.value
    if (list.length === 0) return
    const current = form.value.default_model
    if (!current || !list.includes(current)) {
      form.value.default_model = list[0] || ''
    }
  },
  { immediate: true }
)

function onServiceTypeChange() {
  remoteProviderModels.value = []
  const st = form.value.service_type || 'text'
  const listByType = providerConfigs[st] || []
  const current = form.value.provider
  if (current === 'fal') {
    const preset = listByType.find((p) => p.id === 'fal')
    form.value.base_url = getBaseUrlForProvider('fal')
    form.value.modelText = (preset?.models || []).join('\n')
    form.value.default_model = preset?.models?.[0] || ''
    form.value.api_protocol = 'fal'
    form.value.endpoint = st === 'text' ? '/chat/completions' : ''
    form.value.query_endpoint = ''
    if (st === 'tts') form.value.voice_id = 'Vivian'
    return
  }
  if (current === 'venice') {
    const preset = listByType.find((p) => p.id === 'venice')
    form.value.base_url = getBaseUrlForProvider('venice')
    form.value.modelText = (preset?.models || []).join('\n')
    form.value.default_model = preset?.models?.[0] || ''
    form.value.api_protocol = 'venice'
    form.value.endpoint = st === 'text' ? '/chat/completions' : ''
    form.value.query_endpoint = ''
    return
  }
  if (!current || !listByType.some((p) => p.id === current)) {
    form.value.provider = ''
    form.value.base_url = ''
    form.value.modelText = ''
    form.value.default_model = ''
  }
}

function onPresetModelSelect(value) {
  if (!value) return
  const listParsed = parseModelText(form.value.modelText)
  if (listParsed.includes(value)) {
    presetModelPick.value = ''
    return
  }
  const append = listParsed.length ? '\n' + value : value
  form.value.modelText = (form.value.modelText || '').trim() + append
  presetModelPick.value = ''
}
const rules = computed(() => ({
  service_type: [{ required: true, message: '请选择服务类型', trigger: 'change' }],
  name: [{ required: true, message: '请输入名称', trigger: 'blur' }],
  provider: [{ required: true, message: '请选择或输入厂商', trigger: 'change' }],
  base_url: [{ required: true, message: '请输入 Base URL', trigger: 'blur' }],
  api_key: [
    {
      validator: (_rule, v, cb) => {
        const st = form.value.service_type
        const existing = editingId.value
          ? list.value.find((item) => item.id === editingId.value)
          : null
        const proto = form.value.api_protocol
        const ak = (form.value.kling_access_key || '').trim()
        const sk = (form.value.kling_secret_key || '').trim()
        if (st === 'video' && proto === 'kling_omni' && ak && sk) return cb()
        if (v != null && String(v).trim()) return cb()
        if (existing?.credentials?.api_key?.configured) return cb()
        if (
          st === 'video'
          && proto === 'kling_omni'
          && existing?.credentials?.kling_access_key?.configured
          && existing?.credentials?.kling_secret_key?.configured
        ) return cb()
        cb(new Error('请输入 API Key，或使用官方 AccessKey + SecretKey（可不填 API Key）'))
      },
      trigger: 'blur',
    },
  ],
}))
const testVisible = ref(false)
const testResult = ref(null)
const testServiceType = ref('')
const testError = ref('')
const oneKeyVolcVisible = ref(false)
const oneKeyVolcKey = ref('')
const oneKeyVolcSaving = ref(false)
const oneKeyAgnesVisible = ref(false)
const oneKeyAgnesKey = ref('')
const oneKeyAgnesSaving = ref(false)
const oneKeyFalVisible = ref(false)
const oneKeyFalKey = ref('')
const oneKeyFalSaving = ref(false)
const oneKeyVeniceVisible = ref(false)
const oneKeyVeniceKey = ref('')
const oneKeyVeniceSaving = ref(false)
const oneKeyMediaBridgeVisible = ref(false)
const oneKeyMediaBridgeKey = ref('')
const oneKeyMediaBridgeSaving = ref(false)

/** 预设厂商与模型（与参考前端一致） */
const providerConfigs = {
  text: [
    { id: 'fal', name: 'fal.ai', models: ['openai/gpt-5.5', 'openai/gpt-5.6-sol', 'openai/gpt-5.6-terra', 'openai/gpt-5.6-luna'] },
    { id: 'venice', name: 'Venice.ai', models: ['openai-gpt-55', 'openai-gpt-55-pro', 'deepseek-v4-pro', 'deepseek-v4-flash', 'qwen3-6-27b'] },
    { id: 'openai', name: 'OpenAI', models: ['gpt-4o', 'gpt-4', 'gpt-3.5-turbo'] },
    { id: 'volcengine', name: '火山引擎', models: ['deepseek-v3-2-251201', 'doubao-seed-2-0-pro-260215', 'doubao-seed-2-0-lite-260215', 'doubao-1-5-pro-32k-250115', 'kimi-k2-thinking-251104'] },
    // { id: 'chatfire', name: 'Chatfire', models: ['gemini-3-flash-preview', 'claude-sonnet-4-5-20250929', 'doubao-seed-1-8-251228'] },
    { id: 'gemini', name: 'Google Gemini', models: ['gemini-2.5-pro', 'gemini-3-flash-preview'] },
    { id: 'deepseek', name: 'DeepSeek', models: ['deepseek-v4-flash', 'deepseek-v4-pro'] },
    { id: 'qwen', name: '通义千问', models: ['qwen-plus', 'qwen3.7-max', 'qwen3.7-max-2026-05-20', 'qwen3.6-plus', 'qwen3.6-flash', 'qwen-flash', 'qwen3-max'] },
    { id: 'agnes', name: 'Agnes AI', models: ['agnes-2.0-flash'] }
  ],
  image: [
    { id: 'fal', name: 'fal.ai', models: ['openai/gpt-image-2'] },
    { id: 'venice', name: 'Venice.ai', models: ['gpt-image-2'] },
    { id: 'volcengine', name: '火山引擎', models: ['doubao-seedream-4-5-251128', 'doubao-seedream-5-0-pro-260628', 'doubao-seedream-5-0-260128', 'doubao-seedream-5-0-lite-260128', 'doubao-seedream-4-0-250828'] },
    { id: 'kling', name: '可灵 Kling', models: ['kling-image', 'kling-omni-image'] },
    { id: 'nano_banana', name: 'NanoBanana', models: ['nano-banana-2', 'nano-banana-pro', 'nano-banana'] },
    // { id: 'chatfire', name: 'Chatfire', models: ['nano-banana-pro', 'doubao-seedream-4-5-251128', 'qwen-image'] },
    { id: 'gemini', name: 'Google Gemini', models: ['gemini-2.5-flash-image', 'gemini-2.5-flash-image-preview', 'gemini-3.1-flash-image-preview', 'gemini-3-pro-image-preview'] },
    { id: 'openai', name: 'OpenAI', models: ['dall-e-3', 'dall-e-2'] },
    { id: 'dashscope', name: '通义万象', models: ['wan2.6-image', 'wan2.7-image-pro', 'wan2.7-image', 'qwen-image-edit-plus-2026-01-09', 'qwen-image-edit-plus', 'qwen-image-edit-max'] },
    { id: 'qwen_image', name: '通义千问', models: ['qwen-image-max', 'qwen-image-2.0-pro', 'qwen-image-2.0', 'qwen-image-plus', 'qwen-image'] },
    { id: 'agnes', name: 'Agnes AI', models: ['agnes-image-2.1-flash', 'agnes-image-2.0-flash'] }
  ],
  storyboard_image: [
    { id: 'fal', name: 'fal.ai', models: ['openai/gpt-image-2'] },
    { id: 'venice', name: 'Venice.ai', models: ['gpt-image-2'] },
    { id: 'dashscope', name: '通义万象', models: ['wan2.6-image', 'wan2.7-image-pro', 'wan2.7-image', 'qwen-image-edit-plus-2026-01-09', 'qwen-image-edit-plus', 'qwen-image-edit-max'] },
    { id: 'volcengine', name: '火山引擎', models: ['doubao-seedream-4-5-251128', 'doubao-seedream-5-0-pro-260628', 'doubao-seedream-5-0-260128', 'doubao-seedream-5-0-lite-260128', 'doubao-seedream-4-0-250828'] },
    { id: 'kling', name: '可灵 Kling', models: ['kling-image', 'kling-omni-image'] },
    { id: 'nano_banana', name: 'NanoBanana', models: ['nano-banana-2', 'nano-banana-pro', 'nano-banana'] },
    // { id: 'chatfire', name: 'Chatfire', models: ['nano-banana-pro', 'doubao-seedream-4-5-251128', 'qwen-image'] },
    { id: 'gemini', name: 'Google Gemini', models: ['gemini-2.5-flash-image', 'gemini-2.5-flash-image-preview', 'gemini-3.1-flash-image-preview', 'gemini-3-pro-image-preview'] },
    { id: 'openai', name: 'OpenAI', models: ['dall-e-3', 'dall-e-2'] },
    { id: 'agnes', name: 'Agnes AI', models: ['agnes-image-2.1-flash', 'agnes-image-2.0-flash'] }
  ],
  video: [
    { id: 'fal', name: 'fal.ai', models: ['bytedance/seedance-2.0', 'bytedance/seedance-2.0/fast', 'bytedance/seedance-2.0/mini'] },
    { id: 'venice', name: 'Venice.ai', models: ['seedance-2-0', 'seedance-2-0-fast'] },
    { id: 'mediabridge', name: 'MediaBridge Global Ark', models: ['seedance-2-0', 'seedance-2-0-fast', 'seedance-2-0-mini'] },
    { id: 'klingai', name: '可灵官方 Omni (api-beijing.klingai.com)', models: ['kling-video-o1', 'kling-v3-omni'] },
    { id: 'ffir', name: '飞儿API / 可灵 Omni-Video (ffir.cn)', models: ['kling-video-o1', 'kling-v3-omni'] },
    { id: 'kling', name: '可灵 Kling', models: ['kling-omni-video', 'kling-video', 'kling-motion-control'] },
    { id: 'vidu', name: 'Vidu', models: ['viduq2', 'viduq2-pro', 'viduq2-turbo', 'viduq3-pro'] },
    { id: 'volces', name: '火山引擎', models: ['doubao-seedance-2-0-260128', 'doubao-seedance-2-0-fast-260128', 'doubao-seedance-1-5-pro-251215', 'doubao-seedance-1-0-lite-i2v-250428', 'doubao-seedance-1-0-lite-t2v-250428', 'doubao-seedance-1-0-pro-250528', 'doubao-seedance-1-0-pro-fast-251015'] },
    // { id: 'chatfire', name: 'Chatfire', models: ['doubao-seedance-1-5-pro-251215', 'doubao-seedance-1-0-lite-i2v-250428', 'doubao-seedance-1-0-lite-t2v-250428', 'doubao-seedance-1-0-pro-250528', 'doubao-seedance-1-0-pro-fast-251015', 'sora-2', 'sora-2-pro'] },
    { id: 'minimax', name: 'MiniMax 海螺', models: ['MiniMax-Hailuo-2.3', 'MiniMax-Hailuo-2.3-Fast', 'MiniMax-Hailuo-02'] },
    { id: 'gemini', name: 'Google Gemini (Veo)', models: ['veo-3.1-generate-preview', 'veo-3.0-generate-preview', 'veo-3.0-fast-generate-preview'] },
    { id: 'dashscope', name: '通义万相', models: ['wan2.6-r2v-flash', 'wan2.7-r2v', 'wan2.7-i2v', 'wan2.7-t2v', 'wan2.6-t2v', 'wan2.2-kf2v-flash', 'wan2.6-i2v-flash', 'wanx2.1-vace-plus'] },
    {
      id: 'jimeng_ai_api',
      name: 'Jimeng AI API（自建即梦免费 API）',
      models: [
        'jimeng-video-seedance-2.0',
        'seedance-2.0',
        'jimeng-video-seedance-2.0-fast',
        'jimeng-video-3.0',
        'jimeng-video-3.0-pro',
        'jimeng-video-3.5-pro',
      ],
    },
    { id: 'openai', name: 'OpenAI', models: ['sora-2', 'sora-2-pro'] },
    { id: 'xai', name: 'xAI Grok Imagine', models: ['grok-imagine-video'] },
    { id: 'agnes', name: 'Agnes AI', models: ['agnes-video-v2.0'] },
  ],
  tts: [
    { id: 'fal', name: 'fal.ai', models: ['fal-ai/qwen-3-tts/text-to-speech/1.7b', 'fal-ai/qwen-3-tts/text-to-speech/0.6b', 'fal-ai/gemini-3.1-flash-tts'] },
    { id: 'minimax', name: 'MiniMax T2A', models: ['speech-02-hd', 'speech-02-turbo'] },
  ],
}

/** 厂商 id → 默认接口规范（api_protocol） */
const providerProtocolMap = {
  fal: 'fal',
  venice: 'venice',
  mediabridge: 'mediabridge',
  [LEGACY_MEDIA_PROVIDER]: 'mediabridge',
  // image / storyboard_image
  volcengine: 'volcengine',
  volces: 'volcengine',
  volc: 'volcengine',
  nano_banana: 'nano_banana',
  dashscope: 'dashscope',
  qwen_image: 'dashscope',
  gemini: 'gemini',
  google: 'gemini',
  kling: 'kling',
  ffir: 'kling_omni',
  klingai: 'kling_omni',
  // video
  vidu: 'vidu',
  xai: 'xai',
  grok: 'xai',
  minimax: 'openai',
  openai: 'openai',
  chatfire: 'openai',
  qwen: 'openai',
  deepseek: 'openai',
  agnes: 'openai',
  jimeng_ai_api: 'jimeng_ai_api',
}

/** 厂商 id → 默认 Base URL（与参考前端 AIConfigDialog 757-775 一致） */
function getBaseUrlForProvider(provider) {
  if (!provider) return ''
  const p = String(provider).toLowerCase()
  if (p === 'fal' || p === 'fal.ai') {
    const serviceType = form.value.service_type || 'text'
    if (serviceType === 'text') return 'https://fal.run/openrouter/router/openai/v1'
    if (serviceType === 'video') return 'https://queue.fal.run'
    return 'https://fal.run'
  }
  if (p === 'venice' || p === 'venice.ai') return 'https://api.venice.ai/api/v1'
  if (
    p === 'mediabridge' ||
    p === 'mediabridge.ai' ||
    p === LEGACY_MEDIA_PROVIDER ||
    p === `${LEGACY_MEDIA_PROVIDER}.ai`
  ) return MEDIA_BRIDGE_API_BASE
  if (p === 'gemini' || p === 'google') return 'https://generativelanguage.googleapis.com'
  if (p === 'minimax') return 'https://api.minimaxi.com/v1'
  if (p === 'volces' || p === 'volcengine') return 'https://ark.cn-beijing.volces.com/api/v3'
  if (p === 'openai') return 'https://api.openai.com/v1'
  if (p === 'deepseek') return 'https://api.deepseek.com'
  if (p === 'dashscope') return 'https://dashscope.aliyuncs.com'
  if (p === 'qwen_image') return 'https://dashscope.aliyuncs.com'
  if (p === 'qwen') return 'https://dashscope.aliyuncs.com/compatible-mode/v1'
  if (p === 'nano_banana') return 'https://api.nanobananaapi.ai'
  if (p === 'vidu') return 'https://api.vidu.cn'
  if (p === 'kling') return 'https://api.klingai.com'
  if (p === 'klingai') return 'https://api-beijing.klingai.com'
  if (p === 'ffir') return 'https://ffir.cn'
  if (p === 'jimeng_ai_api') return 'http://127.0.0.1:8000'
  if (p === 'xai' || p === 'grok') return 'https://api.x.ai'
  if (p === 'agnes') return 'https://apihub.agnes-ai.com/v1'
  return 'https://api.chatfire.site/v1'
}

const CUSTOM_PROVIDER_SENTINEL = '__custom__'

function parseSettings(settings) {
  if (!settings) return {}
  if (typeof settings === 'object') return settings
  try {
    const parsed = JSON.parse(settings)
    return parsed && typeof parsed === 'object' ? parsed : {}
  } catch (_) {
    return {}
  }
}

function isDeepSeekOfficial(provider, baseUrl) {
  const p = String(provider || '').trim().toLowerCase()
  const base = String(baseUrl || '').trim().toLowerCase()
  return p === 'deepseek' || base.includes('api.deepseek.com')
}

function resolveDeepSeekFormSettings(row) {
  const s = parseSettings(row?.settings)
  const nested = s.deepseek && typeof s.deepseek === 'object' ? s.deepseek : {}
  let thinking = s.deepseek_thinking || s.thinking || nested.thinking || nested.type || ''
  const model = String(row?.default_model || '').toLowerCase()
  if (!thinking && model === 'deepseek-chat') thinking = 'disabled'
  if (!thinking && model === 'deepseek-reasoner') thinking = 'enabled'
  if (thinking !== 'enabled' && thinking !== 'disabled') thinking = 'disabled'

  let effort = s.deepseek_reasoning_effort || s.reasoning_effort || nested.reasoning_effort || nested.effort || 'high'
  effort = String(effort).toLowerCase() === 'max' ? 'max' : 'high'
  return { thinking, effort }
}

const isDeepSeekOfficialForm = computed(() => (
  form.value.service_type === 'text'
  && isDeepSeekOfficial(form.value.provider, form.value.base_url)
))

/** 当前服务类型下的预设厂商列表（编辑时若当前 provider 不在列表则补一项；末尾始终附一项自定义入口） */
const availableProviderOptions = computed(() => {
  const st = form.value.service_type || 'text'
  const listByType = providerConfigs[st] || []
  const current = form.value.provider
  let result = [...listByType]
  if (editingId.value && current && current !== CUSTOM_PROVIDER_SENTINEL && !listByType.some((p) => p.id === current)) {
    result = [{ id: current, name: current + ' (当前)', models: [] }, ...result]
  }
  result.push({ id: CUSTOM_PROVIDER_SENTINEL, name: '✏️ 自定义（直接输入厂商名）', models: [] })
  return result
})

/** 当前厂商的预设模型列表（用于追加预设模型） */
const availableModels = computed(() => {
  const st = form.value.service_type
  const provider = form.value.provider
  if (!st || !provider) return []
  const p = (providerConfigs[st] || []).find((x) => x.id === provider)
  return [...new Set([...(p?.models || []), ...remoteProviderModelIds.value])]
})

const availableModelGroups = computed(() => groupModelOptions(
  availableModels.value,
  form.value.service_type,
  form.value.provider,
  remoteProviderModelIds.value
))

const canSyncProviderModels = computed(() => (
  editingId.value != null
  && form.value.provider === 'venice'
  && form.value.service_type === 'text'
))

async function syncProviderModels() {
  if (!canSyncProviderModels.value || syncingProviderModels.value) return
  syncingProviderModels.value = true
  try {
    const result = await aiAPI.listModels(editingId.value, form.value.service_type)
    const models = Array.isArray(result?.models) ? result.models : []
    remoteProviderModels.value = models
    ElMessage.success(`已同步 ${models.length} 个当前账号可用的 Venice 文本模型`)
  } catch (_) {
    // request 已统一显示错误信息
  } finally {
    syncingProviderModels.value = false
  }
}

/** 根据当前厂商/协议/base_url 推算实际将使用的接口地址，供用户核对 */
const endpointPreviewInfo = computed(() => {
  const { provider, api_protocol, base_url, service_type, endpoint, query_endpoint } = form.value
  const p = String(provider || '').toLowerCase()
  const proto = api_protocol || providerProtocolMap[p] || ''
  const base = (base_url || '').replace(/\/$/, '')

  if (!base && !proto && !p) return null

  if (proto === 'fal' || p === 'fal' || p === 'fal.ai') {
    const model = form.value.default_model || parseModelText(form.value.modelText)[0] || '{模型 endpoint}'
    if (service_type === 'text') {
      return {
        submit: `${base || 'https://fal.run/openrouter/router/openai/v1'}/chat/completions`,
        query: null,
        isAuto: true,
      }
    }
    if (service_type === 'image' || service_type === 'storyboard_image') {
      const root = base || 'https://fal.run'
      return {
        submit: `${root}/${model}（有参考图时自动使用 /edit）`,
        query: null,
        isAuto: true,
      }
    }
    if (service_type === 'video') {
      const root = base || 'https://queue.fal.run'
      return {
        submit: `${root}/${model}/{text-to-video | image-to-video | reference-to-video}`,
        query: `${root}/${model}/{模式}/requests/{requestId}/status`,
        isAuto: true,
      }
    }
    if (service_type === 'tts') {
      return {
        submit: `${base || 'https://fal.run'}/${model}`,
        query: null,
        isAuto: true,
      }
    }
  }

  if (proto === 'venice' || p === 'venice' || p === 'venice.ai') {
    const root = base || 'https://api.venice.ai/api/v1'
    if (service_type === 'text') {
      return {
        submit: `${root}/chat/completions`,
        query: null,
        isAuto: true,
      }
    }
    if (service_type === 'image' || service_type === 'storyboard_image') {
      return {
        submit: `${root}/image/generate（参考图自动切换 edit / multi-edit）`,
        query: null,
        isAuto: true,
      }
    }
    if (service_type === 'video') {
      return {
        submit: `${root}/video/queue`,
        query: `${root}/video/retrieve`,
        isAuto: true,
      }
    }
  }

  let submitPath = '', queryPath = ''

  if (service_type === 'text') {
    submitPath = '/chat/completions'
  } else if (service_type === 'tts') {
    if (p === 'minimax') {
      submitPath = '/t2a_v2?GroupId={group_id}'
    } else {
      submitPath = endpoint || '/tts'
    }
  } else if (service_type === 'image' || service_type === 'storyboard_image') {
    if (endpoint) {
      submitPath = endpoint
    } else if (proto === 'volcengine' || p === 'volcengine' || p === 'volces') {
      submitPath = '/images/generations'
    } else if (proto === 'dashscope' || p === 'dashscope' || p === 'qwen_image') {
      submitPath = '/api/v1/services/aigc/multimodal-generation/generation'
    } else if (proto === 'gemini' || p === 'gemini') {
      const m = form.value.default_model || '{模型名}'
      submitPath = `/v1beta/models/${m}:generateContent?key=***`
      return { submit: base + submitPath, query: null, isAuto: true, isGemini: true }
    } else if (proto === 'nano_banana' || p === 'nano_banana') {
      submitPath = '/v1/images/generations'  // nano_banana base_url 无 /v1
    } else if (proto === 'kling' || p === 'kling' || p === 'klingai') {
      submitPath = '/v1/images/generations'
    } else {
      submitPath = '/images/generations'  // openai 兼容：base_url 已含 /v1
    }
    } else if (service_type === 'video') {
    if (endpoint) {
      submitPath = endpoint
    } else if (proto === 'volcengine_omni') {
      submitPath = '/contents/generations/tasks'
    } else if (proto === 'volcengine' || p === 'volces' || p === 'volcengine') {
      submitPath = '/videos/generations'
    } else if (proto === 'dashscope' || p === 'dashscope') {
      submitPath = '/api/v1/services/aigc/video-generation/video-synthesis'
    } else if (proto === 'gemini' || p === 'gemini') {
      const m = form.value.default_model || '{模型名}'
      return {
        submit: `${base}/v1beta/models/${m}:predictLongRunning  （API Key 放 header: x-goog-api-key）`,
        query: `${base}/v1beta/{operationName}  （operationName 由提交响应返回）`,
        isAuto: true,
        isGemini: true
      }
    } else if (proto === 'vidu' || p === 'vidu') {
      submitPath = '/ent/v2/img2video'
    } else if (proto === 'sora') {
      submitPath = '/v1/videos'
    } else if (proto === 'agnes' || p === 'agnes') {
      submitPath = '/videos'
    } else if (proto === 'xai') {
      submitPath = '/v1/videos/generations'
    } else if (proto === 'veo3') {
      submitPath = '/v1/video/create'
    } else if (proto === 'jimeng_ai_api' || p === 'jimeng_ai_api') {
      submitPath = endpoint || '/v1/videos/generations'
      return {
        submit: (base || '(请填 Base URL)') + submitPath + '  （Bearer 为即梦 Session，可多账号英文逗号分隔；同步返回 data[0].url）',
        query: null,
        isAuto: true,
      }
    } else if (proto === 'kling_omni' || p === 'ffir' || p === 'klingai') {
      const omniFfir = p === 'ffir' || /ffir\.cn/i.test(base)
      const omniKlingOfficial = p === 'klingai' || /api(-beijing|-singapore)?\.klingai\.com/i.test(base)
      submitPath = omniFfir ? '/kling/v1/videos/omni-video' : omniKlingOfficial ? '/v1/videos/omni-video' : '/kling/v1/videos/omni-video'
    } else if (proto === 'kling' || p === 'kling' || p === 'klingai') {
      submitPath = '/v1/videos/text2video (T2V) 或 /v1/videos/image2video (I2V)'
    } else if (p === 'minimax') {
      submitPath = '/video_generation'  // minimax base_url 已含 /v1
    } else {
      submitPath = '/v1/video/create'
    }

    if (query_endpoint) {
      queryPath = query_endpoint
    } else if (proto === 'volcengine_omni') {
      queryPath = '/contents/generations/tasks/{taskId}'
    } else if (proto === 'volcengine' || p === 'volces' || p === 'volcengine') {
      queryPath = '/tasks/{taskId}/info'
    } else if (proto === 'dashscope' || p === 'dashscope') {
      queryPath = '/api/v1/tasks/{taskId}/info'
    } else if (proto === 'vidu' || p === 'vidu') {
      queryPath = '/ent/v2/tasks/{taskId}/creations'
    } else if (proto === 'sora') {
      queryPath = '/v1/videos/{taskId}'
    } else if (proto === 'agnes' || p === 'agnes') {
      queryPath = '/videos/{taskId}'
    } else if (proto === 'xai') {
      queryPath = '/v1/videos/{taskId}'
    } else if (proto === 'veo3') {
      queryPath = '/v1/video/query?id={taskId}'
    } else if (proto === 'kling_omni' || p === 'ffir' || p === 'klingai') {
      const omniFfirQ = p === 'ffir' || /ffir\.cn/i.test(base)
      const omniKlingOfficialQ = p === 'klingai' || /api(-beijing|-singapore)?\.klingai\.com/i.test(base)
      queryPath = omniFfirQ
        ? '/kling/v1/images/omni-image/{taskId}'
        : omniKlingOfficialQ
          ? '/v1/videos/omni-video/{taskId}'
          : '/kling/v1/images/omni-image/{taskId}'
    } else if (proto === 'kling' || p === 'kling' || p === 'klingai') {
      queryPath = '/v1/videos/{videoType}/{taskId}（自动按任务类型选择）'
    } else if (p === 'minimax') {
      queryPath = '/query/video_generation?task_id={taskId}'  // minimax base_url 已含 /v1
    } else if (proto !== 'gemini' && p !== 'gemini') {
      queryPath = '/v1/video/query?id={taskId}'
    }
  }

  const submitUrl = base ? (base + submitPath) : ('(未填 Base URL)' + submitPath)
  const queryUrl = queryPath ? (base ? base + queryPath : '(未填 Base URL)' + queryPath) : null

  if (!submitPath) return null
  return {
    submit: submitUrl,
    query: queryUrl,
    isAuto: !endpoint  // 端点是自动推断的（非用户手填）
  }
})

function onProviderChange(providerId) {
  remoteProviderModels.value = []
  if (providerId === CUSTOM_PROVIDER_SENTINEL) {
    form.value.provider = ''
    form.value.api_protocol = ''
    form.value.base_url = ''
    form.value.modelText = ''
    form.value.default_model = ''
    return
  }
  const st = form.value.service_type || 'text'
  const p = (providerConfigs[st] || []).find((x) => x.id === providerId)
  if (!p) {
    form.value.base_url = ''
    form.value.modelText = ''
    form.value.default_model = ''
    return
  }
  form.value.base_url = getBaseUrlForProvider(providerId)
  form.value.modelText = (p.models || []).join('\n')
  form.value.default_model = (p.models && p.models[0]) || ''
  if (providerId === 'deepseek') {
    form.value.deepseek_thinking = 'disabled'
    form.value.deepseek_reasoning_effort = 'high'
  }
  // 自动填充接口规范
  form.value.api_protocol = providerProtocolMap[providerId] || (st === 'text' ? '' : 'openai')
  if (providerId === 'fal') {
    form.value.api_protocol = 'fal'
    form.value.endpoint = st === 'text' ? '/chat/completions' : ''
    form.value.query_endpoint = ''
    if (st === 'tts') {
      form.value.voice_id = 'Vivian'
      form.value.group_id = ''
    }
  }
  if (providerId === 'venice') {
    form.value.api_protocol = 'venice'
    form.value.endpoint = st === 'text' ? '/chat/completions' : ''
    form.value.query_endpoint = ''
  }
  if (providerId === 'mediabridge') {
    form.value.api_protocol = 'mediabridge'
    form.value.endpoint = '/api/tasks/generation'
    form.value.query_endpoint = '/api/tasks/{taskId}'
  }
  if (st === 'video' && providerId === 'jimeng_ai_api') {
    form.value.endpoint = ''
    form.value.query_endpoint = ''
  }
  if (st === 'video' && (providerId === 'ffir' || providerId === 'klingai')) {
    if (providerId === 'ffir') {
      form.value.endpoint = '/kling/v1/videos/omni-video'
      form.value.query_endpoint = '/kling/v1/images/omni-image/{taskId}'
    } else {
      form.value.endpoint = '/v1/videos/omni-video'
      form.value.query_endpoint = '/v1/videos/omni-video/{taskId}'
    }
  }
  if (st === 'video' && providerId === 'agnes') {
    form.value.api_protocol = 'agnes'
    form.value.endpoint = '/videos'
    form.value.query_endpoint = '/videos/{taskId}'
  }
  if (!editingId.value) {
    form.value.name = (p.name || providerId) + ' ' + serviceTypeLabel(st)
  }
}

/** 火山引擎一键配置用 */
const VOLCENGINE_CONFIGS = [
  { service_type: 'text', name: '火山引擎 文本', base_url: 'https://ark.cn-beijing.volces.com/api/v3', provider: 'volcengine', model: ['deepseek-v3-2-251201', 'doubao-seed-2-0-pro-260215', 'doubao-seed-2-0-lite-260215', 'doubao-1-5-pro-32k-250115', 'kimi-k2-thinking-251104'] },
  { service_type: 'image', name: '火山引擎 即梦 文本生图', base_url: 'https://ark.cn-beijing.volces.com/api/v3', provider: 'volcengine', model: ['doubao-seedream-4-5-251128', 'doubao-seedream-5-0-pro-260628', 'doubao-seedream-5-0-260128', 'doubao-seedream-5-0-lite-260128'] },
  { service_type: 'storyboard_image', name: '火山引擎 即梦 分镜图', base_url: 'https://ark.cn-beijing.volces.com/api/v3', provider: 'volcengine', model: ['doubao-seedream-4-5-251128', 'doubao-seedream-5-0-pro-260628', 'doubao-seedream-5-0-260128', 'doubao-seedream-5-0-lite-260128'] },
  { service_type: 'video', name: '火山引擎 即梦 视频', base_url: 'https://ark.cn-beijing.volces.com/api/v3', provider: 'volces', model: ['doubao-seedance-1-5-pro-251215', 'doubao-seedance-2-0-260128', 'doubao-seedance-2-0-fast-260128'] }
]

/** Agnes 一键配置用 */
const AGNES_CONFIGS = [
  { service_type: 'text', name: 'Agnes 文本', base_url: 'https://apihub.agnes-ai.com/v1', provider: 'agnes', api_protocol: 'openai', model: ['agnes-2.0-flash'] },
  { service_type: 'image', name: 'Agnes 文本生图', base_url: 'https://apihub.agnes-ai.com/v1', provider: 'agnes', api_protocol: 'openai', model: ['agnes-image-2.1-flash'] },
  { service_type: 'storyboard_image', name: 'Agnes 分镜图', base_url: 'https://apihub.agnes-ai.com/v1', provider: 'agnes', api_protocol: 'openai', model: ['agnes-image-2.1-flash'] },
  { service_type: 'video', name: 'Agnes 视频', base_url: 'https://apihub.agnes-ai.com/v1', provider: 'agnes', api_protocol: 'agnes', endpoint: '/videos', query_endpoint: '/videos/{taskId}', model: ['agnes-video-v2.0'] },
]

const FAL_CONFIGS = [
  {
    service_type: 'text',
    name: 'fal.ai GPT 5.5 / 5.6 文本',
    base_url: 'https://fal.run/openrouter/router/openai/v1',
    provider: 'fal',
    api_protocol: 'fal',
    endpoint: '/chat/completions',
    model: ['openai/gpt-5.5', 'openai/gpt-5.6-sol', 'openai/gpt-5.6-terra', 'openai/gpt-5.6-luna'],
  },
  {
    service_type: 'image',
    name: 'fal.ai GPT Image 2 图片',
    base_url: 'https://fal.run',
    provider: 'fal',
    api_protocol: 'fal',
    model: ['openai/gpt-image-2'],
  },
  {
    service_type: 'storyboard_image',
    name: 'fal.ai GPT Image 2 分镜图',
    base_url: 'https://fal.run',
    provider: 'fal',
    api_protocol: 'fal',
    model: ['openai/gpt-image-2'],
  },
  {
    service_type: 'video',
    name: 'fal.ai Seedance 2.0 视频',
    base_url: 'https://queue.fal.run',
    provider: 'fal',
    api_protocol: 'fal',
    model: ['bytedance/seedance-2.0', 'bytedance/seedance-2.0/fast', 'bytedance/seedance-2.0/mini'],
    settings: JSON.stringify({ generate_audio: true, bitrate_mode: 'standard' }),
  },
  {
    service_type: 'tts',
    name: 'fal.ai Qwen 3 TTS',
    base_url: 'https://fal.run',
    provider: 'fal',
    api_protocol: 'fal',
    model: ['fal-ai/qwen-3-tts/text-to-speech/1.7b', 'fal-ai/qwen-3-tts/text-to-speech/0.6b', 'fal-ai/gemini-3.1-flash-tts'],
    settings: JSON.stringify({ voice_id: 'Vivian', language: 'Chinese' }),
  },
]

const VENICE_CONFIGS = [
  {
    service_type: 'text',
    name: 'Venice.ai 文本模型',
    base_url: 'https://api.venice.ai/api/v1',
    provider: 'venice',
    api_protocol: 'venice',
    endpoint: '/chat/completions',
    model: ['openai-gpt-55', 'openai-gpt-55-pro', 'deepseek-v4-pro', 'deepseek-v4-flash', 'qwen3-6-27b'],
  },
  {
    service_type: 'image',
    name: 'Venice.ai GPT Image 2 图片',
    base_url: 'https://api.venice.ai/api/v1',
    provider: 'venice',
    api_protocol: 'venice',
    model: ['gpt-image-2'],
  },
  {
    service_type: 'storyboard_image',
    name: 'Venice.ai GPT Image 2 分镜图',
    base_url: 'https://api.venice.ai/api/v1',
    provider: 'venice',
    api_protocol: 'venice',
    model: ['gpt-image-2'],
  },
  {
    service_type: 'video',
    name: 'Venice.ai Seedance 2.0 视频',
    base_url: 'https://api.venice.ai/api/v1',
    provider: 'venice',
    api_protocol: 'venice',
    model: ['seedance-2-0', 'seedance-2-0-fast'],
    settings: JSON.stringify({ generate_audio: true }),
  },
]

const MEDIABRIDGE_VIDEO_CONFIG = {
  service_type: 'video',
  name: 'MediaBridge Global Ark Seedance 视频',
  base_url: MEDIA_BRIDGE_API_BASE,
  provider: 'mediabridge',
  api_protocol: 'mediabridge',
  endpoint: '/api/tasks/generation',
  query_endpoint: '/api/tasks/{taskId}',
  model: ['seedance-2-0', 'seedance-2-0-fast', 'seedance-2-0-mini'],
  settings: JSON.stringify({ generate_audio: true }),
}

function serviceTypeLabel(t) {
  const map = {
    text: '文本',
    image: '文本生成图片',
    storyboard_image: '分镜图片生成',
    video: '视频',
    tts: '语音合成 TTS',
  }
  return map[t] || t
}

function onRowEdit(row) {
  openEdit(row)
}

async function loadList() {
  loading.value = true
  try {
    list.value = await aiAPI.list()
  } catch (_) {
    list.value = []
  } finally {
    loading.value = false
  }
}

function parseModelText(text) {
  if (!text || !String(text).trim()) return []
  return String(text)
    .split(/[\n,，]/)
    .map((s) => s.trim())
    .filter(Boolean)
}

function resetForm() {
  editingId.value = null
  presetModelPick.value = ''
  remoteProviderModels.value = []
  form.value = {
    service_type: 'text',
    name: '',
    provider: '',
    api_protocol: '',
    base_url: '',
    api_key: '',
    endpoint: '',
    query_endpoint: '',
    modelText: '',
    default_model: '',
    deepseek_thinking: 'disabled',
    deepseek_reasoning_effort: 'high',
    priority: 0,
    is_default: true,  // 新增时默认勾选「设为默认」，便于理解当前会使用哪条配置
    voice_id: '',
    group_id: '',
    kling_access_key: '',
    kling_secret_key: '',
    kling_secret_key_base64: false,
  }
  formRef.value?.resetFields?.()
}

function openAdd() {
  resetForm()
  dialogVisible.value = true
}

function openEdit(row) {
  remoteProviderModels.value = []
  editingId.value = row.id
  const isLegacyMediaBridge =
    String(row.provider || '').toLowerCase() === LEGACY_MEDIA_PROVIDER ||
    String(row.api_protocol || '').toLowerCase() === LEGACY_MEDIA_PROVIDER
  const model = Array.isArray(row.model) ? row.model : (row.model ? [row.model] : [])
  const modelList = model.map((m) => String(m).trim()).filter(Boolean)
  const defaultInList = row.default_model && modelList.includes(row.default_model)
  // TTS / 可灵 Omni 等从 settings 解析
  let voice_id = row.voice_id || ''
  let group_id = row.group_id || ''
  let kling_access_key = ''
  let kling_secret_key = ''
  let kling_secret_key_base64 = false
  const deepseekSettings = resolveDeepSeekFormSettings(row)
  if (row.settings) {
    try {
      const s = JSON.parse(row.settings)
      if (row.service_type === 'tts') {
        voice_id = s.voice_id || voice_id
        group_id = s.group_id || group_id
      }
      if (row.service_type === 'video' && row.api_protocol === 'kling_omni') {
        kling_access_key = s.kling_access_key || ''
        kling_secret_key = s.kling_secret_key || ''
        kling_secret_key_base64 = !!s.kling_secret_key_base64
      }
    } catch (_) {}
  }
  form.value = {
    service_type: row.service_type,
    name: row.name,
    provider: isLegacyMediaBridge ? 'mediabridge' : row.provider,
    api_protocol: isLegacyMediaBridge ? 'mediabridge' : (row.api_protocol || ''),
    base_url: row.base_url,
    api_key: '',
    endpoint: row.endpoint || '',
    query_endpoint: row.query_endpoint || '',
    modelText: modelList.join('\n'),
    default_model: defaultInList ? row.default_model : (modelList[0] || ''),
    deepseek_thinking: deepseekSettings.thinking,
    deepseek_reasoning_effort: deepseekSettings.effort,
    priority: row.priority ?? 0,
    is_default: !!row.is_default,
    voice_id,
    group_id,
    kling_access_key,
    kling_secret_key,
    kling_secret_key_base64,
  }
  dialogVisible.value = true
}

async function submit() {
  await formRef.value?.validate?.().catch(() => {})
  saving.value = true
  try {
    const modelList = parseModelText(form.value.modelText)
    const defaultModel = form.value.default_model && modelList.includes(form.value.default_model)
      ? form.value.default_model
      : modelList[0] || null
    // TTS / 可灵 Omni 官方 AKSK / DeepSeek V4 参数打包进 settings
    let settings = undefined
    if (form.value.service_type === 'tts') {
      const prev = editingId.value ? list.value.find((r) => r.id === editingId.value) : null
      const s = form.value.provider === 'fal' ? parseSettings(prev?.settings) : {}
      if (form.value.voice_id) s.voice_id = form.value.voice_id
      if (form.value.group_id) s.group_id = form.value.group_id
      if (form.value.provider === 'fal') {
        const selectedModel = defaultModel || modelList[0] || ''
        if (selectedModel.includes('qwen-3-tts') && !s.language) s.language = 'Chinese'
        if (selectedModel.includes('gemini') && !s.language_code) {
          s.language_code = 'Chinese Mandarin (China)'
        }
      }
      settings = Object.keys(s).length ? JSON.stringify(s) : null
    } else if (form.value.service_type === 'video') {
      const prev = editingId.value ? list.value.find((r) => r.id === editingId.value) : null
      const baseS = parseSettings(prev?.settings)
      baseS.generate_audio = true
      if (form.value.api_protocol === 'kling_omni') {
        if ((form.value.kling_access_key || '').trim()) baseS.kling_access_key = form.value.kling_access_key.trim()
        else delete baseS.kling_access_key
        if ((form.value.kling_secret_key || '').trim()) baseS.kling_secret_key = form.value.kling_secret_key.trim()
        else delete baseS.kling_secret_key
        if (form.value.kling_secret_key_base64) baseS.kling_secret_key_base64 = true
        else delete baseS.kling_secret_key_base64
      }
      settings = Object.keys(baseS).length ? JSON.stringify(baseS) : null
    } else if (isDeepSeekOfficialForm.value) {
      const prev = editingId.value ? list.value.find((r) => r.id === editingId.value) : null
      const baseS = parseSettings(prev?.settings)
      baseS.deepseek_thinking = form.value.deepseek_thinking === 'enabled' ? 'enabled' : 'disabled'
      if (baseS.deepseek_thinking === 'enabled') {
        baseS.deepseek_reasoning_effort = form.value.deepseek_reasoning_effort === 'max' ? 'max' : 'high'
      } else {
        delete baseS.deepseek_reasoning_effort
      }
      settings = Object.keys(baseS).length ? JSON.stringify(baseS) : null
    }
    const payload = {
      service_type: form.value.service_type,
      name: form.value.name,
      provider: form.value.provider,
      api_protocol: form.value.api_protocol || '',
      base_url: form.value.base_url,
      endpoint: form.value.endpoint || '',
      query_endpoint: form.value.query_endpoint || '',
      model: modelList,
      default_model: defaultModel,
      priority: form.value.priority,
      is_default: form.value.is_default,
      ...(settings !== undefined ? { settings } : {}),
    }
    if (!editingId.value || form.value.api_key.trim()) {
      payload.api_key = form.value.api_key
    }
    if (editingId.value) {
      await aiAPI.update(editingId.value, payload)
      ElMessage.success('保存成功')
    } else {
      await aiAPI.create(payload)
      ElMessage.success('添加成功')
    }
    dialogVisible.value = false
    await loadList()
  } catch (e) {
    // request 已统一报错
  } finally {
    saving.value = false
  }
}

function openBulkKey() {
  bulkKeyInput.value = ''
  bulkKeyVisible.value = true
}

async function submitBulkKey() {
  const key = bulkKeyInput.value.trim()
  if (!key) return
  bulkKeySaving.value = true
  try {
    const res = await aiAPI.bulkUpdateKey(key)
    ElMessage.success(res?.message || '所有配置的 API Key 已更新')
    bulkKeyVisible.value = false
    await loadList()
  } catch (_) {
  } finally {
    bulkKeySaving.value = false
  }
}

async function openTest(row) {
  testVisible.value = true
  testResult.value = null
  testError.value = ''
  testServiceType.value = row.service_type || 'text'
  try {
    await aiAPI.testConnection({
      config_id: row.id,
      base_url: row.base_url,
      model: Array.isArray(row.model) ? row.model[0] : row.model,
      provider: row.provider,
      api_protocol: row.api_protocol,
      endpoint: row.endpoint,
      service_type: row.service_type,
      settings: row.settings
    })
    testResult.value = true
  } catch (e) {
    testResult.value = false
    testError.value = e?.message || '请求失败'
  }
}

async function onDelete(row) {
  await ElMessageBox.confirm(`确定删除配置「${row.name}」？`, '删除确认', {
    type: 'warning'
  })
  try {
    await aiAPI.delete(row.id)
    ElMessage.success('已删除')
    await loadList()
  } catch (_) {}
}

async function onSetDefault(row) {
  if (row.is_default || defaultingId.value !== null) return
  defaultingId.value = row.id
  try {
    await aiAPI.setDefault(row.id)
    ElMessage.success(`已将「${row.name}」设为${serviceTypeLabel(row.service_type)}默认配置`)
    await loadList()
  } catch (_) {
    // request 已统一显示错误信息
  } finally {
    defaultingId.value = null
  }
}

function onSelectionChange(rows) {
  selectedRows.value = rows
}

async function onBatchDelete() {
  if (!selectedRows.value.length) return
  await ElMessageBox.confirm(
    `确定删除选中的 ${selectedRows.value.length} 条配置？此操作不可恢复。`,
    '批量删除确认',
    { type: 'warning', confirmButtonText: '确定删除', confirmButtonClass: 'el-button--danger' }
  )
  batchDeleting.value = true
  let success = 0, failed = 0
  for (const row of selectedRows.value) {
    try {
      await aiAPI.delete(row.id)
      success++
    } catch (_) { failed++ }
  }
  batchDeleting.value = false
  selectedRows.value = []
  ElMessage.success(`已删除 ${success} 条${failed ? `，${failed} 条失败` : ''}`)
  await loadList()
}

function openOneKeyVolc() {
  oneKeyVolcKey.value = ''
  oneKeyVolcVisible.value = true
}

async function submitOneKeyVolc() {
  const apiKey = oneKeyVolcKey.value.trim()
  if (!apiKey) return
  oneKeyVolcSaving.value = true
  try {
    for (const cfg of VOLCENGINE_CONFIGS) {
      const models = cfg.model || []
      await aiAPI.create({
        service_type: cfg.service_type,
        name: cfg.name,
        provider: cfg.provider,
        base_url: cfg.base_url,
        api_key: apiKey,
        model: models,
        default_model: models[0] || null,
        priority: 10,
        is_default: true
      })
    }
    ElMessage.success('已创建火山引擎文本、文本生图、分镜图、视频配置')
    oneKeyVolcVisible.value = false
    await loadList()
  } catch (_) {
    // 错误已由 request 统一提示
  } finally {
    oneKeyVolcSaving.value = false
  }
}

function openOneKeyAgnes() {
  oneKeyAgnesKey.value = ''
  oneKeyAgnesVisible.value = true
}

async function submitOneKeyAgnes() {
  const apiKey = oneKeyAgnesKey.value.trim()
  if (!apiKey) return
  oneKeyAgnesSaving.value = true
  try {
    for (const cfg of AGNES_CONFIGS) {
      const models = cfg.model || []
      await aiAPI.create({
        service_type: cfg.service_type,
        name: cfg.name,
        provider: cfg.provider,
        api_protocol: cfg.api_protocol || '',
        base_url: cfg.base_url,
        api_key: apiKey,
        model: models,
        default_model: models[0] || null,
        endpoint: cfg.endpoint || '',
        query_endpoint: cfg.query_endpoint || '',
        priority: 10,
        is_default: true
      })
    }
    ElMessage.success('已创建 Agnes 文本、文本生图、分镜图、视频配置')
    oneKeyAgnesVisible.value = false
    await loadList()
  } catch (_) {
    // 错误已由 request 统一提示
  } finally {
    oneKeyAgnesSaving.value = false
  }
}

function openOneKeyFal() {
  oneKeyFalKey.value = ''
  oneKeyFalVisible.value = true
}

async function submitOneKeyFal() {
  const apiKey = oneKeyFalKey.value.trim()
  if (!apiKey) return
  oneKeyFalSaving.value = true
  try {
    const existing = await aiAPI.list()
    for (const cfg of FAL_CONFIGS) {
      const models = cfg.model || []
      const payload = {
        service_type: cfg.service_type,
        name: cfg.name,
        provider: 'fal',
        api_protocol: 'fal',
        base_url: cfg.base_url,
        api_key: apiKey,
        model: models,
        default_model: models[0] || null,
        endpoint: cfg.endpoint || '',
        query_endpoint: cfg.query_endpoint || '',
        priority: 20,
        is_default: true,
        is_active: true,
        settings: cfg.settings || null,
      }
      const current = existing.find(
        (item) =>
          item.provider === 'fal' &&
          item.service_type === cfg.service_type &&
          !item.deleted_at
      )
      if (current?.id) await aiAPI.update(current.id, payload)
      else await aiAPI.create(payload)
    }
    ElMessage.success('已创建或更新 fal.ai 文本、图片、分镜图、视频和 TTS 配置')
    oneKeyFalVisible.value = false
    await loadList()
  } catch (_) {
    // 错误已由 request 统一提示
  } finally {
    oneKeyFalSaving.value = false
  }
}

function openOneKeyVenice() {
  oneKeyVeniceKey.value = ''
  oneKeyVeniceVisible.value = true
}

async function submitOneKeyVenice() {
  const apiKey = oneKeyVeniceKey.value.trim()
  if (!apiKey) return
  oneKeyVeniceSaving.value = true
  try {
    const existing = await aiAPI.list()
    for (const cfg of VENICE_CONFIGS) {
      const models = cfg.model || []
      const payload = {
        service_type: cfg.service_type,
        name: cfg.name,
        provider: 'venice',
        api_protocol: 'venice',
        base_url: cfg.base_url,
        api_key: apiKey,
        model: models,
        default_model: models[0] || null,
        endpoint: cfg.endpoint || '',
        query_endpoint: cfg.query_endpoint || '',
        priority: 20,
        is_default: true,
        is_active: true,
        settings: cfg.settings || null,
      }
      const current = existing.find(
        (item) =>
          item.provider === 'venice' &&
          item.service_type === cfg.service_type &&
          !item.deleted_at
      )
      if (current?.id) await aiAPI.update(current.id, payload)
      else await aiAPI.create(payload)
    }
    ElMessage.success('已创建或更新 Venice.ai 文本、图片、分镜图和视频配置')
    oneKeyVeniceVisible.value = false
    await loadList()
  } catch (_) {
    // 错误已由 request 统一提示
  } finally {
    oneKeyVeniceSaving.value = false
  }
}

function openOneKeyMediaBridge() {
  oneKeyMediaBridgeKey.value = ''
  oneKeyMediaBridgeVisible.value = true
}

async function submitOneKeyMediaBridge() {
  const apiKey = oneKeyMediaBridgeKey.value.trim()
  if (!apiKey) return
  oneKeyMediaBridgeSaving.value = true
  try {
    const existing = await aiAPI.list()
    const cfg = MEDIABRIDGE_VIDEO_CONFIG
    const models = cfg.model || []
    const payload = {
      service_type: cfg.service_type,
      name: cfg.name,
      provider: cfg.provider,
      api_protocol: cfg.api_protocol,
      base_url: cfg.base_url,
      api_key: apiKey,
      model: models,
      default_model: models[0] || null,
      endpoint: cfg.endpoint,
      query_endpoint: cfg.query_endpoint,
      priority: 20,
      is_default: true,
      is_active: true,
      settings: cfg.settings,
    }
    const current = existing.find(
      (item) =>
        ['mediabridge', LEGACY_MEDIA_PROVIDER].includes(String(item.provider || '').toLowerCase()) &&
        item.service_type === 'video' &&
        !item.deleted_at
    )
    if (current?.id) await aiAPI.update(current.id, payload)
    else await aiAPI.create(payload)
    ElMessage.success('已创建或更新 MediaBridge Global Ark Seedance 视频配置')
    oneKeyMediaBridgeVisible.value = false
    await loadList()
  } catch (_) {
    // 错误已由 request 统一提示
  } finally {
    oneKeyMediaBridgeSaving.value = false
  }
}

async function exportConfigs() {
  try {
    const configs = await aiAPI.list()
    const exportData = configs.map(({ id, created_at, updated_at, ...rest }) => rest)
    const blob = new Blob([JSON.stringify(exportData, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `ai-configs-${new Date().toISOString().slice(0, 10)}.json`
    a.click()
    URL.revokeObjectURL(url)
    ElMessage.success(`已导出 ${exportData.length} 条配置`)
  } catch (e) {
    ElMessage.error('导出失败')
  }
}

function triggerImport() {
  importFileRef.value?.click()
}

async function importConfigs(event) {
  const file = event.target.files?.[0]
  if (!file) return
  try {
    const text = await file.text()
    const configs = JSON.parse(text)
    if (!Array.isArray(configs)) {
      ElMessage.error('文件格式不正确，需要 JSON 数组')
      return
    }
    let success = 0
    let failed = 0
    for (const cfg of configs) {
      try {
        const models = Array.isArray(cfg.model) ? cfg.model : (cfg.model ? [cfg.model] : [])
        await aiAPI.create({
          service_type: cfg.service_type,
          name: cfg.name,
          provider: cfg.provider,
          api_protocol: cfg.api_protocol || null,
          base_url: cfg.base_url,
          api_key: cfg.api_key || '',
          endpoint: cfg.endpoint || null,
          query_endpoint: cfg.query_endpoint || null,
          model: models,
          default_model: cfg.default_model || null,
          priority: cfg.priority ?? 0,
          is_default: !!cfg.is_default,
          settings: cfg.settings || null
        })
        success++
      } catch (_) {
        failed++
      }
    }
    ElMessage.success(`导入完成：${success} 条成功${failed ? `，${failed} 条失败` : ''}`)
    await loadList()
  } catch (e) {
    ElMessage.error('导入失败：' + (e.message || '文件解析错误'))
  } finally {
    event.target.value = ''
  }
}

async function loadVendorLock() {
  try {
    vendorLock.value = await aiAPI.getVendorLock()
  } catch (_) {
    vendorLock.value = { enabled: false, config_file: '' }
  }
}

onMounted(() => {
  loadVendorLock()
  loadList()
  loadGenerationSettings()
})
</script>

<style>
.provider-custom-option {
  border-top: 1px solid var(--el-border-color-light, #e4e7ed);
  margin-top: 4px;
  padding-top: 4px;
  color: var(--el-color-primary, #409eff) !important;
  font-style: italic;
}

.ai-config-editor-dialog {
  display: flex;
  flex-direction: column;
  max-height: 90vh;
  max-height: 90dvh;
  overflow: hidden;
}

.ai-config-editor-dialog > .el-dialog__header,
.ai-config-editor-dialog > .el-dialog__footer {
  flex: 0 0 auto;
}

.ai-config-editor-dialog > .el-dialog__body {
  flex: 1 1 auto;
  min-height: 0;
  overflow-y: auto;
  overscroll-behavior: contain;
}
</style>

<style scoped>
.ai-config-content {
  min-width: 0;
  padding: 0;
}
.config-tabs {
  margin-top: 0;
  overflow: hidden;
}
.config-tabs :deep(.el-tabs__header) {
  margin: 0;
  padding: 0 20px;
  border-bottom: 1px solid var(--border-color);
  background: var(--bg-panel);
}
.config-tabs :deep(.el-tabs__nav-wrap::after) {
  display: none;
}
.config-tabs :deep(.el-tabs__item) {
  height: 52px;
  padding: 0 16px;
  color: var(--text-muted) !important;
  font-size: 13px;
  font-weight: 600;
}
.config-tabs :deep(.el-tabs__item.is-active),
.config-tabs :deep(.el-tabs__item:hover) {
  color: var(--text-primary) !important;
}
.config-tabs :deep(.el-tabs__content) {
  overflow: visible;
  padding: 24px;
}
.tab-content {
  min-width: 0;
  padding-top: 0;
}
.content-actions {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 16px;
  padding: 14px;
  border: 1px solid var(--border-color);
  border-radius: 16px;
  background: var(--bg-panel);
}
.actions-left {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}
.actions-right {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-shrink: 0;
}
.quick-config-btn.el-button {
  border-color: var(--border-color) !important;
  color: var(--text-primary) !important;
  background: var(--bg-raised) !important;
}
.quick-config-btn.el-button:hover {
  border-color: var(--module-accent) !important;
  color: var(--module-accent) !important;
  background: color-mix(in srgb, var(--module-accent) 7%, var(--bg-raised)) !important;
}

/* 过渡动画 */
.fade-slide-enter-active,
.fade-slide-leave-active {
  transition: all 0.2s ease;
}
.fade-slide-enter-from,
.fade-slide-leave-to {
  opacity: 0;
  transform: translateX(8px);
}

/* 类型徽章 */
.type-badge {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  padding: 3px 10px;
  border-radius: 20px;
  font-size: 12px;
  font-weight: 600;
  white-space: nowrap;
  border: 1px solid transparent;
}
.type-icon {
  font-size: 13px;
  flex-shrink: 0;
}

/* 文本/对话 — 蓝色 */
.type-text {
  background: rgba(59, 130, 246, 0.12);
  color: #3b82f6;
  border-color: rgba(59, 130, 246, 0.25);
}
/* 文本生成图片 — 绿色 */
.type-image {
  background: rgba(16, 185, 129, 0.12);
  color: #10b981;
  border-color: rgba(16, 185, 129, 0.25);
}
/* 分镜图片生成 — 陶土橙 */
.type-storyboard_image {
  background: rgba(201, 106, 58, 0.12);
  color: #df8051;
  border-color: rgba(201, 106, 58, 0.25);
}
/* 视频 — 橙色 */
.type-video {
  background: rgba(249, 115, 22, 0.12);
  color: #f97316;
  border-color: rgba(249, 115, 22, 0.25);
}
.no-default {
  color: #9ca3af;
  font-size: 13px;
}
.one-key-tip {
  margin: 0 0 12px;
  color: var(--text-muted);
  font-size: 13px;
  line-height: 1.5;
}
.one-key-help {
  display: flex;
  flex-direction: column;
  gap: 12px;
}
.one-key-section {
  background: var(--el-fill-color-light, #f5f7fa);
  border-radius: 8px;
  padding: 12px 14px;
}
.one-key-section-title {
  font-size: 13px;
  font-weight: 600;
  color: var(--el-text-color-primary, #303133);
  margin-bottom: 8px;
}
.one-key-list {
  margin: 0;
  padding-left: 20px;
  font-size: 13px;
  color: var(--el-text-color-regular, #606266);
  line-height: 1.8;
}
.one-key-list li {
  margin-bottom: 2px;
}
.one-key-link {
  color: var(--el-color-primary, #409eff);
  text-decoration: none;
}
.one-key-link:hover {
  text-decoration: underline;
}
.one-key-note {
  margin: 6px 0 0;
  font-size: 12px;
  color: var(--el-text-color-secondary, #909399);
  line-height: 1.5;
}
.one-key-note + .one-key-note {
  margin-top: 4px;
}
code {
  background: var(--el-fill-color, #f0f2f5);
  padding: 1px 5px;
  border-radius: 3px;
  font-size: 12px;
  font-family: monospace;
}
.cfg-tip-content code {
  background: none;
  padding: 0;
  border-radius: 0;
  font-size: inherit;
  font-family: monospace;
}
.vendor-lock-bar {
  display: flex;
  align-items: center;
  gap: 12px;
  margin-bottom: 16px;
}
.default-tip {
  margin: 0 0 16px;
  padding: 10px 12px;
  border-left: 3px solid var(--module-accent);
  border-radius: 0 8px 8px 0;
  background: color-mix(in srgb, var(--module-accent) 7%, var(--bg-panel));
  color: var(--text-muted);
  font-size: 13px;
  line-height: 1.6;
}
.vendor-lock-bar .vendor-lock-tip {
  flex: 1;
  margin-bottom: 0;
}
.vendor-bulk-key-btn {
  white-space: nowrap;
  flex-shrink: 0;
  color: #fff !important;
}
.vendor-lock-tip {
  margin-bottom: 16px;
}
.model-row {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  margin-bottom: 4px;
}
.deepseek-settings {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
}
.field-tip {
  margin: 6px 0 0;
  font-size: 12px;
  color: #909399;
  line-height: 1.4;
}
.form-label-tip {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  white-space: nowrap;
}
.ph-section-title {
  font-size: 13px;
  font-weight: 600;
  color: #606266;
  padding: 4px 0 6px;
  border-bottom: 1px solid #ebeef5;
  margin-bottom: 4px;
}
.ph-tag {
  display: inline-block;
  font-size: 11px;
  padding: 1px 6px;
  border-radius: 3px;
  margin-right: 6px;
  font-weight: 600;
  vertical-align: middle;
}
.ph-tag-img {
  background: #ecf5ff;
  color: #409eff;
  border: 1px solid #b3d8ff;
}
.ph-tag-vid {
  background: #f0f9eb;
  color: #67c23a;
  border: 1px solid #b3e19d;
}
.protocol-help .ph-body {
  font-size: 13px;
  line-height: 1.7;
  color: #303133;
}
.protocol-help .ph-body pre {
  background: #f5f7fa;
  border-radius: 4px;
  padding: 8px 12px;
  font-size: 12px;
  line-height: 1.6;
  overflow-x: auto;
  margin: 6px 0 2px;
  white-space: pre-wrap;
  word-break: break-all;
}
.protocol-help .ph-body code {
  background: #f0f2f5;
  padding: 1px 5px;
  border-radius: 3px;
  font-size: 12px;
}
.tip-icon {
  font-size: 13px;
  color: #909399;
  cursor: pointer;
  flex-shrink: 0;
  transition: color 0.15s;
}
.tip-icon:hover {
  color: #409eff;
}
.endpoint-preview-box {
  background: #f0f7ff;
  border: 1px solid #c6e0ff;
  border-radius: 6px;
  padding: 10px 14px;
  margin: -4px 0 14px;
  font-size: 12px;
}
.ep-preview-header {
  display: flex;
  align-items: center;
  gap: 8px;
  font-weight: 600;
  color: #409eff;
  margin-bottom: 8px;
  font-size: 12px;
}
.ep-auto-badge {
  background: #e6f1ff;
  color: #409eff;
  border: 1px solid #b3d8ff;
  border-radius: 3px;
  padding: 0 5px;
  font-size: 11px;
  font-weight: 400;
}
.ep-row {
  display: flex;
  align-items: flex-start;
  margin-bottom: 5px;
  gap: 6px;
  line-height: 1.5;
}
.ep-row:last-of-type {
  margin-bottom: 0;
}
.ep-label {
  flex-shrink: 0;
  color: #606266;
  min-width: 68px;
}
.ep-url {
  word-break: break-all;
  color: #303133;
  background: rgba(255,255,255,0.7);
  border: 1px solid #dce8fa;
  border-radius: 3px;
  padding: 1px 6px;
  font-family: 'Menlo', 'Consolas', monospace;
  font-size: 11.5px;
  line-height: 1.6;
}
.ep-tip {
  margin: 8px 0 0;
  font-size: 11px;
  color: #909399;
  line-height: 1.4;
}
.ep-tip-warn {
  color: #e6a23c;
}
.ep-box-gemini {
  background: #fffbf0;
  border-color: #f5dfa0;
}
.ep-box-gemini .ep-preview-header {
  color: #b8860b;
}
.ep-badge-gemini {
  background: #fef6e0;
  color: #b8860b;
  border-color: #f0d080;
}
.config-tabs :deep(.prompt-editor) {
  border: 0 !important;
  border-radius: 0 !important;
  background: transparent !important;
}
.config-tabs :deep(.scene-model-map-page .page-header) {
  margin-bottom: 18px;
  padding: 0 !important;
  border: 0 !important;
  background: transparent !important;
}
.config-tabs :deep(.mediabridge-assets) {
  max-width: none;
}
.ai-records-tab :deep(.ai-records-page.ai-records-page--embedded) {
  --record-page: var(--bg-card);
  --record-surface: var(--bg-raised);
  --record-surface-raised: var(--bg-panel);
  --record-surface-soft: var(--bg-inner);
  --record-primary: var(--text-primary);
  --record-secondary: var(--text-muted);
  --record-muted: var(--text-subtle);
  --record-subtle: var(--text-faint);
  --record-border: var(--border-color);
  --record-accent: var(--brand);
}
.ai-records-tab :deep(.ai-records-page--embedded .content) {
  width: 100%;
  margin: 0 !important;
  padding: 0 !important;
}
.ai-records-tab :deep(.panel-footer .el-pager li.is-active) {
  color: #fff !important;
  background: var(--brand) !important;
}
.generation-settings {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 16px;
  max-width: none;
}
.settings-card {
  min-width: 0;
  padding: 22px;
  border: 1px solid var(--border-color);
  border-radius: 16px;
  background: var(--bg-panel);
}
.gs-section-title {
  margin-bottom: 10px;
  color: var(--text-primary);
  font-size: 16px;
  font-weight: 700;
}
.gs-desc {
  min-height: 66px;
  margin: 0 0 20px;
  color: var(--text-muted);
  font-size: 13px;
  line-height: 1.7;
}
.gs-row {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 10px;
  min-height: 42px;
}
.gs-label {
  min-width: 78px;
  color: var(--text-primary);
  font-size: 13px;
  font-weight: 500;
  white-space: nowrap;
}
.gs-unit {
  color: var(--text-muted);
  font-size: 13px;
  white-space: nowrap;
}
.gs-alert {
  margin-top: 14px;
}
.gs-control-stack {
  display: flex;
  flex-direction: column;
  gap: 10px;
}
.gs-select {
  width: 180px;
}
.gs-save-row {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 12px;
  margin-top: 18px;
}
.gs-saved-alert {
  width: fit-content;
}
.gs-tip-box {
  margin-top: 20px;
  padding: 14px 16px;
  border: 1px solid var(--border-color);
  border-radius: 12px;
  color: var(--text-muted);
  background: var(--bg-raised);
  font-size: 13px;
}
.gs-tip-title {
  margin-bottom: 8px;
  color: var(--text-primary);
  font-weight: 600;
}
.gs-tip-list {
  margin: 0 0 8px 16px;
  padding: 0;
  color: var(--text-muted);
  line-height: 1.8;
}
.gs-tip-note {
  color: var(--text-subtle);
  font-size: 12px;
}
@media (max-width: 1180px) {
  .generation-settings {
    grid-template-columns: 1fr;
  }
  .gs-desc {
    min-height: 0;
  }
}
</style>
