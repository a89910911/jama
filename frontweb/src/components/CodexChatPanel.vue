<template>
  <div class="codex-chat-launcher" :class="{ 'is-compact': compact }">
    <el-button
      type="primary"
      plain
      :disabled="!dramaId"
      @click="openPanel"
    >
      <el-icon><ChatDotRound /></el-icon>
      Codex AI 助手
    </el-button>
    <span v-if="!compact" class="codex-launcher-tip">
      对话生成文字和图片，不使用 AI 设置中的模型
    </span>

    <el-drawer
      v-model="visible"
      append-to-body
      class="codex-chat-drawer"
      size="460px"
      :with-header="false"
      @closed="disconnectEvents"
    >
      <div class="codex-chat-shell">
        <header class="codex-chat-header">
          <div>
            <div class="codex-chat-title">
              Codex AI 助手
              <span :class="['codex-status-dot', statusClass]" />
            </div>
            <div class="codex-chat-context">
              {{ episodeNumber ? `当前第 ${episodeNumber} 集` : '当前项目' }}
              · {{ statusText }}
            </div>
          </div>
          <div class="codex-header-actions">
            <el-popover
              placement="bottom-end"
              :width="360"
              trigger="click"
            >
              <template #reference>
                <el-button text>
                  <el-icon><QuestionFilled /></el-icon>
                  使用说明
                </el-button>
              </template>
              <div class="codex-help">
                <strong>怎样说，Codex 更容易准确执行？</strong>
                <ol>
                  <li v-for="tip in conversationTips" :key="tip">{{ tip }}</li>
                </ol>
              </div>
            </el-popover>
            <el-button
              text
              :disabled="loading || !!runningTaskId"
              @click="createNewSession"
            >
              新对话
            </el-button>
          </div>
        </header>

        <div ref="messageListRef" class="codex-message-list">
          <div v-if="loading" class="codex-empty">
            <el-icon class="is-loading"><Loading /></el-icon>
            正在加载对话…
          </div>
          <div v-else-if="!messages.length" class="codex-empty">
            <el-icon :size="34"><MagicStick /></el-icon>
            <p>告诉 Codex 你想创作什么。</p>
            <span>例如：一个少女在森林里遇见会说话的狐狸，帮我生成当前集剧本。</span>
          </div>

          <article
            v-for="message in messages"
            :key="message.id"
            :class="['codex-message', `is-${message.role}`]"
          >
            <div class="codex-message-role">
              {{ message.role === 'user' ? '你' : 'Codex' }}
              <el-tooltip
                v-if="messageActionLabel(message)"
                :content="message.metadata?.intent_plan?.reason || '本次对话识别出的执行方式'"
                placement="top"
              >
                <span class="codex-action-badge">
                  {{ messageActionLabel(message) }}
                </span>
              </el-tooltip>
              <span v-if="message.status === 'processing'" class="codex-processing">
                <el-icon class="is-loading"><Loading /></el-icon>
                {{ phaseMessage || '正在生成…' }}
              </span>
              <span v-else-if="message.status === 'failed'" class="codex-failed">生成失败</span>
              <span v-else-if="message.status === 'cancelled'" class="codex-cancelled">已停止</span>
            </div>
            <GenerationProgressBar
              v-if="message.status === 'processing' && message.task_id === runningTaskId"
              class="codex-task-progress"
              compact
              :percentage="runningProgress.progress"
              :message="runningProgress.progressMessage || phaseMessage"
              :estimated="runningProgress.progressEstimated"
            />
            <div class="codex-message-content">
              {{ displayContent(message) }}
            </div>
            <div
              v-if="messageImages(message).length"
              class="codex-generated-images"
            >
              <figure
                v-for="image in messageImages(message)"
                :key="`${image.target_type || 'image'}-${image.target_id || image.image_generation_id}`"
                class="codex-generated-image-item"
              >
                <img
                  class="codex-generated-image"
                  :src="image.url"
                  :alt="image.name || 'Codex 生成图片'"
                />
                <figcaption v-if="image.name">
                  {{ image.name }}
                </figcaption>
              </figure>
            </div>
            <div v-if="message.role === 'assistant' && message.content_type === 'script' && message.status === 'completed'" class="codex-result-note">
              <el-icon><CircleCheck /></el-icon>
              剧本已写入{{ episodeNumber ? `第 ${episodeNumber} 集` : '项目' }}
            </div>
            <div v-if="message.role === 'assistant' && message.action_type === 'generate_storyboards' && message.status === 'completed'" class="codex-result-note">
              <el-icon><CircleCheck /></el-icon>
              全部分镜已写入{{ episodeNumber ? `第 ${episodeNumber} 集` : '当前剧集' }}
            </div>
            <div v-if="message.role === 'assistant' && message.action_type === 'update_storyboard_details' && message.status === 'completed'" class="codex-result-note">
              <el-icon><CircleCheck /></el-icon>
              分镜说明已写入{{ episodeNumber ? `第 ${episodeNumber} 集` : '当前剧集' }}
            </div>
            <div v-if="message.role === 'assistant' && message.action_type === 'optimize_storyboard_prompt' && message.status === 'completed'" class="codex-result-note">
              <el-icon><CircleCheck /></el-icon>
              分镜提示词已写入提示词编辑区
            </div>
            <div v-if="message.role === 'assistant' && message.action_type === 'optimize_resource_prompt' && message.status === 'completed'" class="codex-result-note">
              <el-icon><CircleCheck /></el-icon>
              资源图片提示词已写入资源库
            </div>
          </article>
        </div>

        <div class="codex-composer">
          <div class="codex-intents">
            <el-tooltip
              v-for="item in intentOptions"
              :key="item.value"
              :content="item.description"
              placement="top"
              :show-after="250"
            >
              <button
                type="button"
                :class="{ active: intentHint === item.value }"
                :disabled="!!runningTaskId"
                :aria-label="`${item.label}：${item.description}`"
                @click="applyIntent(item)"
              >
                {{ item.label }}
              </button>
            </el-tooltip>
          </div>
          <div class="codex-intent-tip">
            快捷按钮会填入可编辑示例；修改示例后，Codex 会重新理解你的自然语言需求。
          </div>
          <el-input
            ref="inputRef"
            v-model="input"
            type="textarea"
            :rows="3"
            resize="none"
            maxlength="50000"
            placeholder="输入你的创作要求…"
            :disabled="!!runningTaskId || !sessionId"
            @input="onInputChanged"
            @keydown.ctrl.enter.prevent="send"
            @keydown.meta.enter.prevent="send"
          />
          <div class="codex-composer-actions">
            <span>Ctrl / ⌘ + Enter 发送</span>
            <el-button
              v-if="runningTaskId"
              type="danger"
              plain
              :loading="cancelling"
              @click="cancel"
            >
              停止生成
            </el-button>
            <el-button
              v-else
              type="primary"
              :disabled="!input.trim() || !sessionId"
              @click="send"
            >
              发送
              <el-icon class="el-icon--right"><Promotion /></el-icon>
            </el-button>
          </div>
        </div>
      </div>
    </el-drawer>
  </div>
</template>

<script setup>
import { computed, nextTick, onBeforeUnmount, ref, watch } from 'vue'
import { ElMessage } from 'element-plus'
import {
  ChatDotRound,
  CircleCheck,
  Loading,
  MagicStick,
  Promotion,
  QuestionFilled,
} from '@element-plus/icons-vue'
import { codexChatAPI } from '@/api/codexChat'
import { taskAPI } from '@/api/task'
import GenerationProgressBar from '@/components/GenerationProgressBar.vue'
import { applyGenerationProgress } from '@/utils/generationProgress'
import {
  CODEX_CONVERSATION_TIPS,
  codexActionLabel,
  codexIntentOptions,
  codexMessageImages,
  parseCodexTaskResult,
  shouldRefreshDrama,
  upsertChatMessage,
} from '@/utils/codexChatUi'

const props = defineProps({
  dramaId: { type: [Number, String], default: null },
  episodeId: { type: [Number, String], default: null },
  episodeNumber: { type: [Number, String], default: null },
  episodeCount: { type: Number, default: 1 },
  storyStyle: { type: String, default: '' },
  storyType: { type: String, default: '' },
  compact: { type: Boolean, default: false },
})

const emit = defineEmits(['completed'])

const visible = ref(false)
const loading = ref(false)
const status = ref({ available: false, starting: false, error: '' })
const sessionId = ref('')
const messages = ref([])
const input = ref('')
const intentHint = ref('')
const intentExample = ref('')
const runningTaskId = ref('')
const phaseMessage = ref('')
const runningProgress = ref({
  progress: 1,
  progressMessage: '',
  progressEstimated: true,
  progressStartedAt: Date.now(),
})
const cancelling = ref(false)
const eventSource = ref(null)
const lastEventId = ref(0)
const streamText = ref({})
const messageListRef = ref(null)
const inputRef = ref(null)
let pollTimer = null
const conversationTips = CODEX_CONVERSATION_TIPS

const intentOptions = computed(() => codexIntentOptions({
  episodeId: props.episodeId,
  episodeNumber: props.episodeNumber,
}))

const statusClass = computed(() => {
  if (status.value.available) return 'is-ready'
  if (status.value.starting) return 'is-starting'
  return 'is-error'
})

const statusText = computed(() => {
  if (status.value.available) return 'Codex 已连接'
  if (status.value.starting) return 'Codex 启动中'
  return status.value.error || 'Codex 未连接'
})

function upsertMessage(message) {
  messages.value = upsertChatMessage(messages.value, message)
}

function resetRunningProgress(message = '正在准备…') {
  runningProgress.value = {
    progress: 1,
    progressMessage: message,
    progressEstimated: true,
    progressStartedAt: Date.now(),
  }
}

function displayContent(message) {
  if (message.content) return message.content
  if (message.action_type === 'chat' && streamText.value[message.id]) {
    return streamText.value[message.id]
  }
  if (message.status === 'processing') return ''
  return ''
}

function messageImages(message) {
  return codexMessageImages(message)
}

function messageActionLabel(message) {
  return codexActionLabel(message?.action_type)
}

async function applyIntent(item) {
  if (!item || runningTaskId.value) return
  intentHint.value = item.value
  intentExample.value = item.example
  input.value = item.example
  await nextTick()
  inputRef.value?.focus?.()
}

function onInputChanged(value) {
  if (intentHint.value && value !== intentExample.value) {
    intentHint.value = ''
    intentExample.value = ''
  }
}

async function scrollToBottom() {
  await nextTick()
  const el = messageListRef.value
  if (el) el.scrollTop = el.scrollHeight
}

async function loadMessages() {
  if (!sessionId.value) return
  messages.value = await codexChatAPI.listMessages(sessionId.value)
  const active = [...messages.value].reverse().find((item) => item.status === 'processing' && item.task_id)
  runningTaskId.value = active?.task_id || ''
  if (runningTaskId.value) {
    resetRunningProgress(active?.status_message || '正在恢复生成任务…')
    startTaskPolling()
  }
  await scrollToBottom()
}

async function ensureSession(forceNew = false) {
  if (!props.dramaId) return
  if (!forceNew) {
    const sessions = await codexChatAPI.listSessions(props.dramaId, props.episodeId)
    if (sessions?.length) sessionId.value = sessions[0].id
  }
  if (!sessionId.value || forceNew) {
    const created = await codexChatAPI.createSession(props.dramaId, {
      episode_id: props.episodeId || undefined,
    })
    sessionId.value = created.id
  }
  await loadMessages()
  connectEvents()
}

async function checkStatus() {
  try {
    status.value = await codexChatAPI.status()
  } catch (error) {
    status.value = { available: false, error: error.message || 'Codex 不可用' }
  }
}

async function openPanel() {
  visible.value = true
  loading.value = true
  try {
    await Promise.all([checkStatus(), ensureSession(false)])
  } catch (error) {
    ElMessage.error(error.message || '加载 Codex 对话失败')
  } finally {
    loading.value = false
  }
}

async function createNewSession() {
  loading.value = true
  disconnectEvents()
  sessionId.value = ''
  messages.value = []
  input.value = ''
  intentHint.value = ''
  intentExample.value = ''
  try {
    await ensureSession(true)
  } catch (error) {
    ElMessage.error(error.message || '创建对话失败')
  } finally {
    loading.value = false
  }
}

function handleServerEvent(type, payload, event) {
  lastEventId.value = Number(event?.lastEventId || lastEventId.value || 0)
  if (type === 'message.started') {
    upsertMessage(payload.user_message)
    upsertMessage(payload.assistant_message)
    runningTaskId.value = payload.task_id || ''
    phaseMessage.value = '正在准备…'
    resetRunningProgress(phaseMessage.value)
    startTaskPolling()
  } else if (type === 'message.delta') {
    const id = payload.message_id
    streamText.value = {
      ...streamText.value,
      [id]: `${streamText.value[id] || ''}${payload.delta || ''}`,
    }
  } else if (type === 'phase.changed') {
    phaseMessage.value = payload.message || '正在生成…'
  } else if (type === 'intent.resolved') {
    upsertMessage(payload.user_message)
    upsertMessage(payload.assistant_message)
    phaseMessage.value = payload.label
      ? `已理解为“${payload.label}”，正在执行…`
      : '已理解需求，正在执行…'
  } else if (type === 'message.completed') {
    upsertMessage(payload.message)
    runningTaskId.value = ''
    phaseMessage.value = ''
    stopTaskPolling()
    if (payload.refresh_drama) emit('completed', payload)
  } else if (type === 'turn.failed' || type === 'turn.interrupted') {
    runningTaskId.value = ''
    phaseMessage.value = ''
    stopTaskPolling()
    loadMessages().catch(() => {})
  }
  scrollToBottom()
}

function connectEvents() {
  disconnectEvents()
  if (!sessionId.value || typeof EventSource === 'undefined') return
  const source = new EventSource(codexChatAPI.eventsUrl(sessionId.value, lastEventId.value), {
    withCredentials: true,
  })
  const eventTypes = [
    'message.started',
    'message.delta',
    'phase.changed',
    'intent.resolved',
    'image.completed',
    'message.completed',
    'turn.failed',
    'turn.interrupted',
  ]
  for (const type of eventTypes) {
    source.addEventListener(type, (event) => {
      try {
        handleServerEvent(type, JSON.parse(event.data || '{}'), event)
      } catch (_) {}
    })
  }
  source.onerror = () => {
    status.value = { ...status.value, available: false, error: '事件连接正在重试' }
  }
  source.onopen = () => {
    status.value = { ...status.value, available: true, error: '' }
  }
  eventSource.value = source
}

function disconnectEvents() {
  eventSource.value?.close?.()
  eventSource.value = null
}

async function send() {
  const content = input.value.trim()
  if (!content || !sessionId.value || runningTaskId.value) return
  try {
    const result = await codexChatAPI.sendMessage(sessionId.value, {
      content,
      intent_hint: intentHint.value || undefined,
      episode_count: props.episodeId ? 1 : props.episodeCount,
      style: props.storyStyle || undefined,
      type: props.storyType || undefined,
    })
    input.value = ''
    intentHint.value = ''
    intentExample.value = ''
    upsertMessage(result.user_message)
    upsertMessage(result.assistant_message)
    runningTaskId.value = result.task_id
    phaseMessage.value = '正在准备…'
    resetRunningProgress(phaseMessage.value)
    startTaskPolling()
    await scrollToBottom()
  } catch (error) {
    ElMessage.error(error.message || '发送失败')
  }
}

async function cancel() {
  if (!runningTaskId.value || cancelling.value) return
  cancelling.value = true
  try {
    await taskAPI.cancel(runningTaskId.value, { reason: '用户已取消' })
    runningTaskId.value = ''
    stopTaskPolling()
    await loadMessages()
  } catch (error) {
    ElMessage.error(error.message || '停止生成失败')
  } finally {
    cancelling.value = false
  }
}

function stopTaskPolling() {
  if (pollTimer) clearTimeout(pollTimer)
  pollTimer = null
}

function startTaskPolling() {
  stopTaskPolling()
  if (!runningTaskId.value) return
  const tick = async () => {
    const taskId = runningTaskId.value
    if (!taskId) return
    try {
      const task = await taskAPI.get(taskId)
      applyGenerationProgress(runningProgress.value, task, { kind: task.type })
      if (task.status === 'completed' || task.status === 'failed') {
        runningTaskId.value = ''
        stopTaskPolling()
        await loadMessages()
        if (task.status === 'completed') {
          const result = parseCodexTaskResult(task.result)
          emit('completed', { ...result, refresh_drama: shouldRefreshDrama(result) })
        }
        return
      }
      phaseMessage.value = task.message || phaseMessage.value
    } catch (_) {}
    pollTimer = setTimeout(tick, 2000)
  }
  pollTimer = setTimeout(tick, 2000)
}

watch(
  () => [props.dramaId, props.episodeId],
  () => {
    disconnectEvents()
    stopTaskPolling()
    sessionId.value = ''
    messages.value = []
    runningTaskId.value = ''
    intentHint.value = ''
    intentExample.value = ''
    lastEventId.value = 0
    if (visible.value) {
      loading.value = true
      ensureSession(false).catch((error) => {
        ElMessage.error(error.message || '切换剧集对话失败')
      }).finally(() => {
        loading.value = false
      })
    }
  }
)

onBeforeUnmount(() => {
  disconnectEvents()
  stopTaskPolling()
})
</script>

<style scoped>
.codex-chat-launcher {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-top: 12px;
}
.codex-chat-launcher.is-compact {
  margin-top: 0;
}

.codex-launcher-tip {
  color: var(--el-text-color-secondary);
  font-size: 12px;
}

.codex-chat-shell {
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 0;
}

.codex-chat-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 18px 18px 14px;
  border-bottom: 1px solid var(--el-border-color-lighter);
}

.codex-chat-title {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 17px;
  font-weight: 700;
}

.codex-chat-context {
  margin-top: 4px;
  color: var(--el-text-color-secondary);
  font-size: 12px;
}

.codex-header-actions {
  display: flex;
  align-items: center;
  gap: 2px;
}

.codex-help strong {
  color: var(--el-text-color-primary);
  font-size: 14px;
}

.codex-help ol {
  margin: 10px 0 0;
  padding-left: 20px;
  color: var(--el-text-color-regular);
  font-size: 12px;
  line-height: 1.65;
}

.codex-help li + li {
  margin-top: 5px;
}

.codex-status-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: #f56c6c;
}

.codex-status-dot.is-ready {
  background: #67c23a;
}

.codex-status-dot.is-starting {
  background: #e6a23c;
}

.codex-message-list {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  padding: 16px;
  background: var(--el-fill-color-lighter);
}

.codex-empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  min-height: 260px;
  color: var(--el-text-color-secondary);
  text-align: center;
}

.codex-empty p {
  margin: 12px 0 4px;
  color: var(--el-text-color-primary);
  font-weight: 600;
}

.codex-empty span {
  max-width: 320px;
  font-size: 12px;
  line-height: 1.6;
}

.codex-message {
  width: fit-content;
  max-width: 88%;
  margin-bottom: 14px;
  padding: 11px 13px;
  border: 1px solid var(--el-border-color-lighter);
  border-radius: 12px;
  background: var(--el-bg-color);
}

.codex-message.is-user {
  margin-left: auto;
  border-color: var(--el-color-primary-light-7);
  background: var(--el-color-primary-light-9);
}

.codex-message-role {
  display: flex;
  align-items: center;
  gap: 7px;
  margin-bottom: 5px;
  color: var(--el-text-color-secondary);
  font-size: 11px;
}

.codex-action-badge {
  display: inline-flex;
  align-items: center;
  max-width: 150px;
  padding: 1px 6px;
  overflow: hidden;
  border-radius: 999px;
  color: var(--el-color-primary);
  background: var(--el-color-primary-light-9);
  text-overflow: ellipsis;
  white-space: nowrap;
}

.codex-processing,
.codex-failed,
.codex-cancelled {
  display: inline-flex;
  align-items: center;
  gap: 3px;
}

.codex-failed {
  color: var(--el-color-danger);
}

.codex-cancelled {
  color: var(--el-color-warning);
}

.codex-message-content {
  color: var(--el-text-color-primary);
  font-size: 14px;
  line-height: 1.65;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}

.codex-task-progress {
  margin: 2px 0 8px;
}

.codex-generated-images {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 8px;
  margin-top: 10px;
}

.codex-generated-image-item {
  min-width: 0;
  margin: 0;
}

.codex-generated-image {
  display: block;
  width: 100%;
  aspect-ratio: 3 / 4;
  object-fit: cover;
  border-radius: 9px;
}

.codex-generated-image-item figcaption {
  margin-top: 4px;
  overflow: hidden;
  color: var(--el-text-color-secondary);
  font-size: 11px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.codex-result-note {
  display: flex;
  align-items: center;
  gap: 5px;
  margin-top: 9px;
  color: var(--el-color-success);
  font-size: 12px;
}

.codex-composer {
  padding: 12px 14px 14px;
  border-top: 1px solid var(--el-border-color-lighter);
  background: var(--el-bg-color);
}

.codex-intents {
  display: flex;
  gap: 6px;
  margin-bottom: 8px;
  overflow-x: auto;
}

.codex-intents button {
  flex: none;
  padding: 5px 9px;
  border: 1px solid var(--el-border-color);
  border-radius: 999px;
  color: var(--el-text-color-regular);
  background: var(--el-bg-color);
  cursor: pointer;
  font-size: 12px;
}

.codex-intents button.active {
  border-color: var(--el-color-primary);
  color: var(--el-color-primary);
  background: var(--el-color-primary-light-9);
}

.codex-intents button:disabled {
  cursor: not-allowed;
  opacity: 0.5;
}

.codex-intent-tip {
  margin: -2px 0 8px;
  color: var(--el-text-color-placeholder);
  font-size: 11px;
  line-height: 1.4;
}

.codex-composer-actions {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-top: 8px;
}

.codex-composer-actions > span {
  color: var(--el-text-color-placeholder);
  font-size: 11px;
}

:global(.codex-chat-drawer .el-drawer__body) {
  padding: 0;
  overflow: hidden;
}

@media (max-width: 640px) {
  .codex-launcher-tip {
    display: none;
  }

  :global(.codex-chat-drawer) {
    width: 100% !important;
  }
}
</style>
