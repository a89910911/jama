<template>
  <div class="ai-records-page" :class="{ 'ai-records-page--embedded': embedded }">
    <header v-if="!embedded" class="page-header">
      <div class="header-inner">
        <button class="brand-button" type="button" aria-label="返回项目列表" @click="goList">
          <BrandLogo />
        </button>
        <span class="header-divider" />
        <div class="heading">
          <div class="heading-line">
            <h1>{{ systemScope ? 'AI 任务记录' : 'AI 记录' }}</h1>
            <span class="live-dot" :class="{ active: stats.processing > 0 }" />
            <span class="live-label">{{ stats.processing > 0 ? `${stats.processing} 个请求进行中` : '记录已同步' }}</span>
          </div>
          <p>{{ scopeDescription }}</p>
        </div>
        <div class="header-actions">
          <el-button :loading="loading" @click="refreshAll">
            <el-icon><Refresh /></el-icon>
            刷新
          </el-button>
          <el-button @click="goBack">
            <el-icon><ArrowLeft /></el-icon>
            {{ systemScope ? '返回 AI 配置' : '返回项目' }}
          </el-button>
        </div>
      </div>
    </header>

    <main class="content">
      <section class="summary-grid" aria-label="AI 请求概览">
        <article class="summary-card summary-card--total">
          <div class="summary-icon"><DataAnalysis /></div>
          <div>
            <span>累计请求</span>
            <strong>{{ stats.total }}</strong>
            <small>今日 {{ stats.today }} 次</small>
          </div>
        </article>
        <article class="summary-card summary-card--success">
          <div class="summary-icon"><CircleCheckFilled /></div>
          <div>
            <span>成功率</span>
            <strong>{{ successRate }}<em>%</em></strong>
            <small>{{ stats.succeeded }} 次成功</small>
          </div>
        </article>
        <article class="summary-card summary-card--processing">
          <div class="summary-icon"><Loading /></div>
          <div>
            <span>进行中</span>
            <strong>{{ stats.processing }}</strong>
            <small>视频任务会持续更新</small>
          </div>
        </article>
        <article class="summary-card summary-card--latency">
          <div class="summary-icon"><Timer /></div>
          <div>
            <span>平均耗时</span>
            <strong>{{ formatDuration(stats.avg_duration_ms) }}</strong>
            <small>{{ stats.failed }} 次失败</small>
          </div>
        </article>
      </section>

      <section class="records-panel">
        <div class="panel-heading">
          <div>
            <h2>{{ systemScope ? '系统请求明细' : '请求明细' }}</h2>
            <p>请求中的密钥、令牌与大体积 Base64 内容会自动脱敏。</p>
          </div>
          <el-button
            v-if="stats.failed > 0"
            type="danger"
            plain
            :loading="clearing"
            @click="clearFailed"
          >
            清理失败记录
          </el-button>
        </div>

        <div class="filters">
          <el-input
            v-model="filters.keyword"
            class="keyword-input"
            clearable
            placeholder="搜索提示词、模型、场景或错误"
            @keyup.enter="applyFilters"
            @clear="applyFilters"
          >
            <template #prefix><el-icon><Search /></el-icon></template>
          </el-input>
          <el-select v-model="filters.service_type" clearable placeholder="全部能力" @change="applyFilters">
            <el-option v-for="item in serviceOptions" :key="item.value" :label="item.label" :value="item.value" />
          </el-select>
          <el-select v-model="filters.status" clearable placeholder="全部状态" @change="applyFilters">
            <el-option label="进行中" value="processing" />
            <el-option label="成功" value="succeeded" />
            <el-option label="失败" value="failed" />
          </el-select>
          <el-date-picker
            v-model="dateRange"
            type="datetimerange"
            range-separator="至"
            start-placeholder="开始时间"
            end-placeholder="结束时间"
            value-format="YYYY-MM-DDTHH:mm:ss.SSSZ"
            @change="applyFilters"
          />
          <el-button type="primary" @click="applyFilters">查询</el-button>
          <el-button @click="resetFilters">重置</el-button>
        </div>

        <el-table
          v-loading="loading"
          :data="items"
          row-key="id"
          class="records-table"
          :empty-text="systemScope ? '当前系统还没有 AI 任务记录' : '当前项目还没有 AI 请求记录'"
          @row-dblclick="openDetail"
        >
          <el-table-column label="时间" width="158">
            <template #default="{ row }">
              <div class="time-cell">
                <strong>{{ formatDate(row.created_at) }}</strong>
                <span>#{{ row.id }}</span>
              </div>
            </template>
          </el-table-column>
          <el-table-column v-if="systemScope" label="所属项目" min-width="150">
            <template #default="{ row }">
              <div class="project-cell">
                <strong>{{ row.drama_title || (row.drama_id ? `项目 #${row.drama_id}` : '未关联项目') }}</strong>
                <span>{{ row.drama_id ? `#${row.drama_id}` : '系统任务' }}</span>
              </div>
            </template>
          </el-table-column>
          <el-table-column label="能力" width="112">
            <template #default="{ row }">
              <span class="type-pill" :class="`type-pill--${row.service_type}`">
                <el-icon><component :is="serviceMeta(row.service_type).icon" /></el-icon>
                {{ serviceMeta(row.service_type).label }}
              </span>
            </template>
          </el-table-column>
          <el-table-column label="业务场景" min-width="150">
            <template #default="{ row }">
              <div class="scene-cell">
                <strong>{{ sceneLabel(row) }}</strong>
                <span v-if="row.related_type">{{ relatedLabel(row) }}</span>
              </div>
            </template>
          </el-table-column>
          <el-table-column label="请求内容" min-width="260">
            <template #default="{ row }">
              <button class="prompt-preview" type="button" @click="openDetail(row)">
                {{ row.request_preview || '—' }}
              </button>
            </template>
          </el-table-column>
          <el-table-column label="模型" min-width="170">
            <template #default="{ row }">
              <div class="model-cell">
                <strong>{{ row.model || '默认模型' }}</strong>
                <span>{{ row.provider || '未标记供应商' }}</span>
              </div>
            </template>
          </el-table-column>
          <el-table-column label="状态" width="108">
            <template #default="{ row }">
              <span class="status-pill" :class="`status-pill--${row.status}`">
                <i />
                {{ statusLabel(row.status) }}
              </span>
            </template>
          </el-table-column>
          <el-table-column label="耗时" width="100" align="right">
            <template #default="{ row }">
              <span class="duration">{{ row.status === 'processing' ? '—' : formatDuration(row.duration_ms) }}</span>
            </template>
          </el-table-column>
          <el-table-column label="" width="108" fixed="right">
            <template #default="{ row }">
              <div class="row-actions">
                <el-tooltip content="查看详情" placement="top">
                  <el-button circle text @click="openDetail(row)">
                    <el-icon><View /></el-icon>
                  </el-button>
                </el-tooltip>
                <el-tooltip content="删除记录" placement="top">
                  <el-button circle text type="danger" @click="deleteOne(row)">
                    <el-icon><Delete /></el-icon>
                  </el-button>
                </el-tooltip>
              </div>
            </template>
          </el-table-column>
        </el-table>

        <footer class="panel-footer">
          <span>共 {{ pagination.total }} 条记录</span>
          <el-pagination
            v-model:current-page="pagination.page"
            v-model:page-size="pagination.page_size"
            :total="pagination.total"
            :page-sizes="[10, 20, 50, 100]"
            layout="sizes, prev, pager, next"
            @current-change="loadList"
            @size-change="onPageSizeChange"
          />
        </footer>
      </section>
    </main>

    <el-drawer
      v-model="detailVisible"
      class="record-drawer"
      size="min(760px, 92vw)"
      :with-header="false"
      destroy-on-close
    >
      <template v-if="detail">
        <div class="drawer-header">
          <div>
            <div class="drawer-eyebrow">
              请求 #{{ detail.id }}
              <span class="status-pill" :class="`status-pill--${detail.status}`">
                <i />
                {{ statusLabel(detail.status) }}
              </span>
            </div>
            <h2>{{ sceneLabel(detail) }}</h2>
            <p>{{ serviceMeta(detail.service_type).label }} · {{ detail.provider || '未知供应商' }} / {{ detail.model || '默认模型' }}</p>
          </div>
          <el-button circle text aria-label="关闭" @click="detailVisible = false">
            <el-icon><Close /></el-icon>
          </el-button>
        </div>

        <div class="detail-meta">
          <div v-if="systemScope"><span>所属项目</span><strong>{{ detail.drama_title || (detail.drama_id ? `项目 #${detail.drama_id}` : '未关联项目') }}</strong></div>
          <div><span>发起时间</span><strong>{{ formatFullDate(detail.created_at) }}</strong></div>
          <div><span>完成时间</span><strong>{{ formatFullDate(detail.completed_at) || '—' }}</strong></div>
          <div><span>耗时</span><strong>{{ detail.status === 'processing' ? '进行中' : formatDuration(detail.duration_ms) }}</strong></div>
          <div><span>操作账号</span><strong>{{ detail.username || (detail.user_id ? `账号 #${detail.user_id}` : '系统任务') }}</strong></div>
          <div><span>业务键</span><strong>{{ detail.scene_key || detail.operation || '—' }}</strong></div>
          <div><span>关联对象</span><strong>{{ relatedLabel(detail) || '—' }}</strong></div>
        </div>

        <el-alert
          v-if="detail.error_message"
          class="error-alert"
          type="error"
          :closable="false"
          show-icon
          :title="detail.error_message"
        />

        <el-tabs v-model="detailTab" class="detail-tabs">
          <el-tab-pane label="请求内容" name="request">
            <pre>{{ formatPayload(detail.request_payload) }}</pre>
          </el-tab-pane>
          <el-tab-pane label="响应内容" name="response">
            <pre>{{ formatPayload(detail.response_payload) }}</pre>
          </el-tab-pane>
          <el-tab-pane label="记录信息" name="meta">
            <pre>{{ formatPayload(detailMetadata) }}</pre>
          </el-tab-pane>
        </el-tabs>
      </template>
      <div v-else v-loading="detailLoading" class="detail-loading" />
    </el-drawer>
  </div>
</template>

<script setup>
import { computed, markRaw, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { ElMessage, ElMessageBox } from 'element-plus'
import {
  ArrowLeft,
  ChatLineSquare,
  CircleCheckFilled,
  Close,
  DataAnalysis,
  Delete,
  Headset,
  Loading,
  Picture,
  Refresh,
  Search,
  Timer,
  VideoCamera,
  View,
} from '@element-plus/icons-vue'
import BrandLogo from '@/components/BrandLogo.vue'
import { aiRequestsAPI } from '@/api/aiRequests'
import { dramaAPI } from '@/api/drama'

const props = defineProps({
  scope: { type: String, default: 'project' },
  dramaId: { type: [Number, String], default: null },
  embedded: { type: Boolean, default: false },
})

const route = useRoute()
const router = useRouter()
const projectTitle = ref('')
const items = ref([])
const loading = ref(false)
const clearing = ref(false)
const dateRange = ref([])
const detailVisible = ref(false)
const detailLoading = ref(false)
const detail = ref(null)
const detailTab = ref('request')
let refreshTimer = null

const systemScope = computed(() => props.scope === 'system')
const projectId = computed(() => Number(props.dramaId || route.params.id || 0))
const scopeDescription = computed(() => systemScope.value
  ? '当前系统 · 查看所有项目及系统任务的文本、图片、视频和语音调用轨迹'
  : `${projectTitle.value || `项目 #${projectId.value}`} · 查看文本、图片、视频和语音的完整调用轨迹`
)
const filters = reactive({
  keyword: '',
  service_type: '',
  status: '',
})
const pagination = reactive({
  page: 1,
  page_size: 20,
  total: 0,
  total_pages: 0,
})
const stats = reactive({
  total: 0,
  succeeded: 0,
  failed: 0,
  processing: 0,
  today: 0,
  avg_duration_ms: 0,
  service_counts: {},
})

const serviceOptions = [
  { value: 'text', label: '文本' },
  { value: 'vision', label: '视觉理解' },
  { value: 'image', label: '图片' },
  { value: 'video', label: '视频' },
  { value: 'tts', label: '语音' },
]

const serviceMap = {
  text: { label: '文本', icon: markRaw(ChatLineSquare) },
  vision: { label: '视觉', icon: markRaw(View) },
  image: { label: '图片', icon: markRaw(Picture) },
  video: { label: '视频', icon: markRaw(VideoCamera) },
  tts: { label: '语音', icon: markRaw(Headset) },
  connection_test: { label: '连通测试', icon: markRaw(DataAnalysis) },
}

const sceneNames = {
  generate_text: '文本生成',
  stream_generate_text: '流式文本生成',
  vision_analysis: '图片理解',
  story_generation: '故事生成',
  storyboard_extraction: '分镜生成',
  role_extraction: '角色提取',
  scene_extraction: '场景提取',
  prop_extraction: '道具提取',
  frame_prompt: '画面提示词',
  layout_regenerate: '布局重建',
  image_polish: '图片提示词润色',
  role_image_polish: '角色提示词润色',
  scene_image_polish: '场景提示词润色',
  prop_image_polish: '道具提示词润色',
  continuity_snapshot: '连贯性快照',
  image_generation: '图片生成',
  video_generation: '视频生成',
  speech_synthesis: '语音合成',
}

const relatedNames = {
  video_generation: '视频任务',
  image_generation: '图片任务',
  storyboard: '分镜',
  episode: '分集',
  character: '角色',
  scene: '场景',
  prop: '道具',
  task: '任务',
}

const successRate = computed(() => {
  const finished = stats.succeeded + stats.failed
  return finished ? Math.round((stats.succeeded / finished) * 100) : 0
})

const detailMetadata = computed(() => {
  if (!detail.value) return {}
  const {
    request_payload,
    response_payload,
    request_preview,
    error_message,
    ...metadata
  } = detail.value
  return metadata
})

function serviceMeta(type) {
  return serviceMap[type] || { label: type || '未知', icon: markRaw(DataAnalysis) }
}

function statusLabel(status) {
  return {
    processing: '进行中',
    succeeded: '成功',
    failed: '失败',
  }[status] || status || '未知'
}

function sceneLabel(row) {
  const key = row.scene_key || row.operation
  return sceneNames[key] || key || 'AI 请求'
}

function relatedLabel(row) {
  if (!row?.related_type) return ''
  return `${relatedNames[row.related_type] || row.related_type}${row.related_id ? ` #${row.related_id}` : ''}`
}

function formatDuration(value) {
  const ms = Number(value || 0)
  if (!ms) return '0 ms'
  if (ms < 1000) return `${ms} ms`
  if (ms < 60000) return `${(ms / 1000).toFixed(ms < 10000 ? 1 : 0)} s`
  const minutes = Math.floor(ms / 60000)
  const seconds = Math.round((ms % 60000) / 1000)
  return `${minutes}m ${seconds}s`
}

function formatDate(value) {
  if (!value) return '—'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  const today = new Date()
  const sameDay = date.toDateString() === today.toDateString()
  return sameDay
    ? date.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false })
    : date.toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false })
}

function formatFullDate(value) {
  if (!value) return ''
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString('zh-CN', { hour12: false })
}

function formatPayload(value) {
  if (value == null || value === '') return '暂无内容'
  if (typeof value === 'string') return value
  try {
    return JSON.stringify(value, null, 2)
  } catch (_) {
    return String(value)
  }
}

function buildQuery() {
  return {
    page: pagination.page,
    page_size: pagination.page_size,
    keyword: filters.keyword || undefined,
    service_type: filters.service_type || undefined,
    status: filters.status || undefined,
    date_from: dateRange.value?.[0] || undefined,
    date_to: dateRange.value?.[1] || undefined,
  }
}

async function loadList() {
  if (!systemScope.value && !projectId.value) return
  loading.value = true
  try {
    const data = systemScope.value
      ? await aiRequestsAPI.systemList(buildQuery())
      : await aiRequestsAPI.list(projectId.value, buildQuery())
    items.value = data?.items || []
    Object.assign(pagination, data?.pagination || {})
  } finally {
    loading.value = false
  }
}

async function loadStats() {
  if (!systemScope.value && !projectId.value) return
  const data = systemScope.value
    ? await aiRequestsAPI.systemStats()
    : await aiRequestsAPI.stats(projectId.value)
  Object.assign(stats, data || {})
}

async function refreshAll() {
  await Promise.all([loadList(), loadStats()])
}

function applyFilters() {
  pagination.page = 1
  loadList()
}

function resetFilters() {
  Object.assign(filters, { keyword: '', service_type: '', status: '' })
  dateRange.value = []
  pagination.page = 1
  loadList()
}

function onPageSizeChange() {
  pagination.page = 1
  loadList()
}

async function openDetail(row) {
  detailVisible.value = true
  detailLoading.value = true
  detailTab.value = 'request'
  detail.value = null
  try {
    detail.value = systemScope.value
      ? await aiRequestsAPI.systemGet(row.id)
      : await aiRequestsAPI.get(projectId.value, row.id)
  } catch (_) {
    detailVisible.value = false
  } finally {
    detailLoading.value = false
  }
}

async function deleteOne(row) {
  try {
    await ElMessageBox.confirm(
      `确认删除 AI 请求 #${row.id} 的记录？此操作不会删除生成结果。`,
      '删除 AI 记录',
      { type: 'warning', confirmButtonText: '删除', cancelButtonText: '取消' }
    )
    if (systemScope.value) await aiRequestsAPI.systemDelete(row.id)
    else await aiRequestsAPI.delete(projectId.value, row.id)
    ElMessage.success('记录已删除')
    await refreshAll()
  } catch (error) {
    if (error !== 'cancel' && error !== 'close') throw error
  }
}

async function clearFailed() {
  try {
    await ElMessageBox.confirm(
      `确认清理${systemScope.value ? '当前系统' : '当前项目'}的 ${stats.failed} 条失败记录？`,
      '清理失败记录',
      { type: 'warning', confirmButtonText: '清理', cancelButtonText: '取消' }
    )
    clearing.value = true
    const result = systemScope.value
      ? await aiRequestsAPI.systemClear('failed')
      : await aiRequestsAPI.clear(projectId.value, 'failed')
    ElMessage.success(`已清理 ${result?.deleted || 0} 条记录`)
    pagination.page = 1
    await refreshAll()
  } catch (error) {
    if (error !== 'cancel' && error !== 'close') throw error
  } finally {
    clearing.value = false
  }
}

function goList() {
  router.push({ name: 'list' })
}

function goBack() {
  if (systemScope.value) {
    router.push({ name: 'ai-config', query: { tab: 'configs' } })
    return
  }
  const value = Array.isArray(route.query.returnTo) ? route.query.returnTo[0] : route.query.returnTo
  const target = typeof value === 'string' && value.startsWith('/') && !value.startsWith('//')
    ? value
    : `/film/${projectId.value}`
  router.push(target)
}

async function loadProject() {
  if (systemScope.value) {
    projectTitle.value = ''
    return
  }
  try {
    const data = await dramaAPI.get(projectId.value)
    projectTitle.value = data?.title || `项目 #${projectId.value}`
  } catch (_) {
    projectTitle.value = `项目 #${projectId.value}`
  }
}

function startRefreshTimer() {
  clearInterval(refreshTimer)
  refreshTimer = window.setInterval(() => {
    if (stats.processing > 0 && document.visibilityState === 'visible') refreshAll()
  }, 8000)
}

watch([systemScope, projectId], async () => {
  pagination.page = 1
  await Promise.all([loadProject(), refreshAll()])
}, { immediate: true })

onMounted(startRefreshTimer)
onBeforeUnmount(() => clearInterval(refreshTimer))
</script>

<style scoped>
.ai-records-page {
  min-height: 100vh;
  color: #eeeaf5;
  background:
    radial-gradient(circle at 12% 0%, rgba(224, 151, 56, .12), transparent 30%),
    radial-gradient(circle at 88% 8%, rgba(111, 78, 180, .14), transparent 32%),
    #0d0c10;
}
.page-header {
  position: sticky;
  z-index: 100;
  top: 0;
  border-bottom: 1px solid rgba(255, 255, 255, .08);
  background: rgba(13, 12, 16, .84);
  backdrop-filter: blur(18px);
}
.header-inner {
  display: flex;
  align-items: center;
  gap: 18px;
  width: min(1600px, calc(100% - 40px));
  min-height: 78px;
  margin: 0 auto;
}
.brand-button {
  display: flex;
  padding: 0;
  border: 0;
  color: inherit;
  background: transparent;
  cursor: pointer;
}
.header-divider {
  width: 1px;
  height: 34px;
  background: rgba(255, 255, 255, .1);
}
.heading {
  min-width: 0;
  flex: 1;
}
.heading-line {
  display: flex;
  align-items: center;
  gap: 9px;
}
.heading h1 {
  margin: 0;
  font-size: 20px;
  letter-spacing: -.02em;
}
.heading p {
  overflow: hidden;
  margin: 5px 0 0;
  color: #8e8999;
  font-size: 12px;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.live-dot {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: #5f5a69;
}
.live-dot.active {
  background: #e7a343;
  box-shadow: 0 0 0 5px rgba(231, 163, 67, .1);
  animation: pulse 1.8s infinite;
}
.live-label {
  color: #8e8999;
  font-size: 11px;
}
.header-actions {
  display: flex;
  gap: 8px;
}
.content {
  width: min(1600px, calc(100% - 40px));
  margin: 0 auto;
  padding: 28px 0 48px;
}
.summary-grid {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 14px;
  margin-bottom: 18px;
}
.summary-card {
  display: flex;
  align-items: center;
  gap: 15px;
  min-height: 112px;
  padding: 20px;
  border: 1px solid rgba(255, 255, 255, .075);
  border-radius: 16px;
  background: linear-gradient(145deg, rgba(31, 29, 36, .92), rgba(20, 19, 24, .92));
  box-shadow: 0 18px 50px rgba(0, 0, 0, .18);
}
.summary-icon {
  display: grid;
  width: 46px;
  height: 46px;
  flex: 0 0 auto;
  place-items: center;
  border-radius: 14px;
  font-size: 20px;
}
.summary-card--total .summary-icon { color: #e4aa57; background: rgba(228, 170, 87, .12); }
.summary-card--success .summary-icon { color: #65c99b; background: rgba(101, 201, 155, .11); }
.summary-card--processing .summary-icon { color: #9b8ce8; background: rgba(155, 140, 232, .12); }
.summary-card--latency .summary-icon { color: #67aee8; background: rgba(103, 174, 232, .11); }
.summary-card--processing .summary-icon :deep(svg) { animation: spin 2s linear infinite; }
.summary-card div:last-child {
  display: grid;
  grid-template-columns: auto auto;
  align-items: baseline;
  column-gap: 9px;
}
.summary-card span {
  grid-column: 1 / -1;
  margin-bottom: 2px;
  color: #8f8a98;
  font-size: 12px;
}
.summary-card strong {
  color: #f4f1f7;
  font-size: 28px;
  font-weight: 680;
  letter-spacing: -.04em;
}
.summary-card strong em {
  margin-left: 2px;
  color: #aaa4b2;
  font-size: 14px;
  font-style: normal;
}
.summary-card small {
  color: #6f6a78;
  font-size: 11px;
}
.records-panel {
  overflow: hidden;
  border: 1px solid rgba(255, 255, 255, .075);
  border-radius: 18px;
  background: rgba(22, 21, 26, .94);
  box-shadow: 0 24px 70px rgba(0, 0, 0, .2);
}
.panel-heading {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 20px;
  padding: 21px 22px 17px;
}
.panel-heading h2 {
  margin: 0;
  font-size: 16px;
}
.panel-heading p {
  margin: 5px 0 0;
  color: #736e7c;
  font-size: 11px;
}
.filters {
  display: grid;
  grid-template-columns: minmax(240px, 1fr) 140px 130px minmax(310px, auto) auto auto;
  gap: 9px;
  padding: 0 22px 18px;
}
.records-table {
  width: 100%;
  --el-table-bg-color: transparent;
  --el-table-tr-bg-color: transparent;
  --el-table-header-bg-color: rgba(255, 255, 255, .025);
  --el-table-row-hover-bg-color: rgba(231, 163, 67, .045);
  --el-table-border-color: rgba(255, 255, 255, .065);
  --el-table-text-color: #d4cfda;
  --el-table-header-text-color: #77717f;
}
.records-table :deep(th.el-table__cell) {
  height: 45px;
  font-size: 11px;
  font-weight: 600;
  letter-spacing: .03em;
}
.records-table :deep(td.el-table__cell) { padding: 12px 0; }
.time-cell,
.project-cell,
.scene-cell,
.model-cell {
  display: flex;
  min-width: 0;
  flex-direction: column;
  gap: 4px;
}
.time-cell strong,
.project-cell strong,
.scene-cell strong,
.model-cell strong {
  overflow: hidden;
  color: #d8d3de;
  font-size: 12px;
  font-weight: 580;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.time-cell span,
.project-cell span,
.scene-cell span,
.model-cell span {
  overflow: hidden;
  color: #716b79;
  font-size: 10px;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.type-pill,
.status-pill {
  display: inline-flex;
  align-items: center;
  width: fit-content;
  gap: 5px;
  border-radius: 999px;
  white-space: nowrap;
}
.type-pill {
  padding: 5px 8px;
  color: #b3adbb;
  background: rgba(255, 255, 255, .055);
  font-size: 10px;
}
.type-pill--text { color: #c5b9ee; background: rgba(139, 116, 216, .12); }
.type-pill--vision { color: #b9aaf0; background: rgba(139, 116, 216, .15); }
.type-pill--image { color: #edb96e; background: rgba(231, 163, 67, .12); }
.type-pill--video { color: #73b9e9; background: rgba(80, 161, 216, .12); }
.type-pill--tts { color: #75d1a8; background: rgba(81, 183, 138, .12); }
.prompt-preview {
  display: -webkit-box;
  overflow: hidden;
  width: 100%;
  padding: 0;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 2;
  border: 0;
  color: #aaa4b2;
  background: transparent;
  font: inherit;
  font-size: 11px;
  line-height: 1.55;
  text-align: left;
  cursor: pointer;
}
.prompt-preview:hover { color: #e1aa5e; }
.status-pill {
  padding: 5px 9px;
  font-size: 10px;
}
.status-pill i {
  width: 6px;
  height: 6px;
  border-radius: 50%;
}
.status-pill--processing { color: #d6b3ff; background: rgba(145, 94, 205, .13); }
.status-pill--processing i { background: #ad7fe1; box-shadow: 0 0 8px #ad7fe1; }
.status-pill--succeeded { color: #79cda9; background: rgba(67, 168, 125, .12); }
.status-pill--succeeded i { background: #64c697; }
.status-pill--failed { color: #ea8f8f; background: rgba(210, 80, 80, .12); }
.status-pill--failed i { background: #df7777; }
.duration {
  color: #8c8694;
  font-size: 11px;
  font-variant-numeric: tabular-nums;
}
.row-actions {
  display: flex;
  justify-content: flex-end;
}
.panel-footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  min-height: 62px;
  padding: 12px 22px;
  border-top: 1px solid rgba(255, 255, 255, .065);
  color: #77717f;
  font-size: 11px;
}
.drawer-header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 20px;
  padding: 24px 25px 20px;
  border-bottom: 1px solid rgba(255, 255, 255, .075);
}
.drawer-eyebrow {
  display: flex;
  align-items: center;
  gap: 10px;
  color: #8a8492;
  font-size: 11px;
  letter-spacing: .04em;
}
.drawer-header h2 {
  margin: 10px 0 5px;
  color: #f1edf5;
  font-size: 22px;
}
.drawer-header p {
  margin: 0;
  color: #837d8a;
  font-size: 12px;
}
.detail-meta {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 1px;
  margin: 20px 25px;
  overflow: hidden;
  border: 1px solid rgba(255, 255, 255, .075);
  border-radius: 12px;
  background: rgba(255, 255, 255, .075);
}
.detail-meta div {
  display: flex;
  min-width: 0;
  flex-direction: column;
  gap: 5px;
  padding: 13px 15px;
  background: #17161b;
}
.detail-meta span {
  color: #716b79;
  font-size: 10px;
}
.detail-meta strong {
  overflow: hidden;
  color: #c9c3ce;
  font-size: 11px;
  font-weight: 550;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.error-alert { margin: 0 25px 16px; }
.detail-tabs { margin: 0 25px; }
.detail-tabs pre {
  min-height: 260px;
  max-height: calc(100vh - 390px);
  margin: 8px 0 24px;
  padding: 17px;
  overflow: auto;
  border: 1px solid rgba(255, 255, 255, .075);
  border-radius: 12px;
  color: #c6c0cc;
  background: #0e0d11;
  font: 11px/1.7 ui-monospace, SFMono-Regular, Consolas, monospace;
  white-space: pre-wrap;
  word-break: break-word;
}
.detail-loading { min-height: 60vh; }

/* 可读性优化：减少纯黑、提高文字/边框对比度，并放大高频信息字号 */
.ai-records-page {
  --record-page: #171a22;
  --record-surface: #222630;
  --record-surface-raised: #282d38;
  --record-surface-soft: #2e3440;
  --record-primary: #f7f8fb;
  --record-secondary: #cbd1dc;
  --record-muted: #a4adbb;
  --record-subtle: #8d98a8;
  --record-border: #3c4452;
  --record-accent: #f0b45d;
  color: var(--record-primary);
  background:
    radial-gradient(circle at 12% -8%, rgba(232, 166, 73, .13), transparent 34%),
    radial-gradient(circle at 92% 0%, rgba(105, 121, 185, .12), transparent 32%),
    var(--record-page);
  -webkit-font-smoothing: antialiased;
  text-rendering: optimizeLegibility;
}
html.light .ai-records-page {
  --record-page: #f2f4f7;
  --record-surface: #ffffff;
  --record-surface-raised: #f8fafc;
  --record-surface-soft: #eef2f6;
  --record-primary: #1c2430;
  --record-secondary: #3e4a5d;
  --record-muted: #5d697a;
  --record-subtle: #737f90;
  --record-border: #d4dbe5;
  --record-accent: #a9630a;
  background:
    radial-gradient(circle at 12% -8%, rgba(222, 146, 40, .1), transparent 34%),
    radial-gradient(circle at 92% 0%, rgba(92, 111, 177, .08), transparent 32%),
    var(--record-page);
}
.ai-records-page.ai-records-page--embedded {
  min-height: 0;
  background: transparent;
}
.ai-records-page--embedded .content {
  width: 100%;
  padding: 0;
}
.page-header {
  border-bottom-color: var(--record-border);
  background: color-mix(in srgb, var(--record-page) 92%, transparent);
  box-shadow: 0 6px 24px rgba(0, 0, 0, .12);
}
.header-divider { background: var(--record-border); }
.heading h1 { color: var(--record-primary); }
.heading p,
.live-label { color: var(--record-muted); font-size: 13px; }
.live-dot { background: var(--record-subtle); }
.summary-card {
  border-color: var(--record-border);
  background: linear-gradient(145deg, var(--record-surface-raised), var(--record-surface));
  box-shadow: 0 12px 34px rgba(0, 0, 0, .16);
}
html.light .summary-card { box-shadow: 0 10px 28px rgba(38, 50, 68, .08); }
.summary-card span {
  color: var(--record-muted);
  font-size: 13px;
}
.summary-card strong { color: var(--record-primary); }
.summary-card strong em { color: var(--record-secondary); }
.summary-card small {
  color: var(--record-subtle);
  font-size: 12px;
}
.records-panel {
  border-color: var(--record-border);
  background: var(--record-surface);
  box-shadow: 0 18px 50px rgba(0, 0, 0, .18);
}
html.light .records-panel { box-shadow: 0 16px 44px rgba(38, 50, 68, .09); }
.panel-heading h2 { color: var(--record-primary); font-size: 18px; }
.panel-heading p {
  color: var(--record-muted);
  font-size: 12px;
  line-height: 1.6;
}
.filters :deep(.el-input__wrapper),
.filters :deep(.el-select__wrapper),
.filters :deep(.el-range-editor.el-input__wrapper) {
  min-height: 38px;
  color: var(--record-primary);
  background: var(--record-surface-raised);
  box-shadow: 0 0 0 1px var(--record-border) inset;
}
.filters :deep(.el-input__wrapper:hover),
.filters :deep(.el-select__wrapper:hover),
.filters :deep(.el-range-editor.el-input__wrapper:hover) {
  box-shadow: 0 0 0 1px color-mix(in srgb, var(--record-accent) 70%, var(--record-border)) inset;
}
.filters :deep(.el-input__inner),
.filters :deep(.el-select__selected-item),
.filters :deep(.el-range-input) {
  color: var(--record-primary);
  font-size: 13px;
}
.filters :deep(.el-input__inner::placeholder),
.filters :deep(.el-range-input::placeholder),
.filters :deep(.el-select__placeholder) {
  color: var(--record-subtle);
}
.filters :deep(.el-range-separator),
.filters :deep(.el-input__prefix),
.filters :deep(.el-input__suffix) {
  color: var(--record-muted);
}
.records-table {
  --el-table-bg-color: var(--record-surface);
  --el-table-tr-bg-color: var(--record-surface);
  --el-table-header-bg-color: var(--record-surface-raised);
  --el-table-row-hover-bg-color: var(--record-surface-soft);
  --el-table-border-color: var(--record-border);
  --el-table-text-color: var(--record-secondary);
  --el-table-header-text-color: var(--record-muted);
}
.records-table :deep(th.el-table__cell) {
  height: 48px;
  color: var(--record-secondary);
  font-size: 12px;
  font-weight: 650;
}
.records-table :deep(td.el-table__cell) { padding: 14px 0; }
.records-table :deep(.el-table__inner-wrapper::before) { background-color: var(--record-border); }
.records-table :deep(.el-table__empty-text) {
  color: var(--record-muted);
  font-size: 13px;
}
.time-cell strong,
.project-cell strong,
.scene-cell strong,
.model-cell strong {
  color: var(--record-primary);
  font-size: 13px;
}
.time-cell span,
.project-cell span,
.scene-cell span,
.model-cell span {
  color: var(--record-muted);
  font-size: 12px;
}
.type-pill {
  border: 1px solid color-mix(in srgb, currentColor 30%, transparent);
  padding: 5px 9px;
  color: var(--record-secondary);
  background: var(--record-surface-soft);
  font-size: 12px;
}
.type-pill--text { color: #d8ccff; background: rgba(139, 116, 216, .2); }
.type-pill--vision { color: #d2c4ff; background: rgba(139, 116, 216, .22); }
.type-pill--image { color: #ffd18d; background: rgba(231, 163, 67, .2); }
.type-pill--video { color: #a8d9fa; background: rgba(80, 161, 216, .2); }
.type-pill--tts { color: #a5e8ca; background: rgba(81, 183, 138, .2); }
html.light .type-pill--text,
html.light .type-pill--vision { color: #5e42ad; }
html.light .type-pill--image { color: #8b5004; }
html.light .type-pill--video { color: #176596; }
html.light .type-pill--tts { color: #14704a; }
.prompt-preview {
  color: var(--record-secondary);
  font-size: 13px;
  line-height: 1.65;
}
.prompt-preview:hover { color: var(--record-accent); }
.status-pill {
  border: 1px solid color-mix(in srgb, currentColor 32%, transparent);
  padding: 5px 9px;
  font-size: 12px;
  font-weight: 600;
}
.status-pill--processing { color: #dec3ff; background: rgba(145, 94, 205, .2); }
.status-pill--succeeded { color: #a1e1c2; background: rgba(67, 168, 125, .2); }
.status-pill--failed { color: #ffb1b1; background: rgba(210, 80, 80, .2); }
html.light .status-pill--processing { color: #7040a5; }
html.light .status-pill--succeeded { color: #176c49; }
html.light .status-pill--failed { color: #a83232; }
.duration {
  color: var(--record-secondary);
  font-size: 12px;
}
.row-actions :deep(.el-button) { color: var(--record-muted); }
.row-actions :deep(.el-button:hover) {
  color: var(--record-primary);
  background: var(--record-surface-soft);
}
.panel-footer {
  border-top-color: var(--record-border);
  color: var(--record-muted);
  background: var(--record-surface-raised);
  font-size: 12px;
}
.panel-footer :deep(.el-pagination) {
  --el-pagination-text-color: var(--record-secondary);
  --el-pagination-button-color: var(--record-secondary);
  --el-pagination-button-bg-color: var(--record-surface-soft);
  --el-pagination-hover-color: var(--record-accent);
}
.panel-footer :deep(.el-pager li.is-active) {
  color: #1f2732;
  background: #f0b45d;
}
.drawer-header { border-bottom-color: var(--record-border); }
.drawer-eyebrow { color: var(--record-muted); font-size: 12px; }
.drawer-header h2 { color: var(--record-primary); }
.drawer-header p { color: var(--record-muted); font-size: 13px; }
.detail-meta {
  border-color: var(--record-border);
  background: var(--record-border);
}
.detail-meta div { background: var(--record-surface); }
.detail-meta span { color: var(--record-muted); font-size: 11px; }
.detail-meta strong { color: var(--record-primary); font-size: 13px; }
.detail-tabs :deep(.el-tabs__item) {
  color: var(--record-muted);
  font-size: 13px;
}
.detail-tabs :deep(.el-tabs__item.is-active),
.detail-tabs :deep(.el-tabs__item:hover) { color: var(--record-accent); }
.detail-tabs :deep(.el-tabs__nav-wrap::after) { background: var(--record-border); }
.detail-tabs pre {
  border-color: var(--record-border);
  color: var(--record-secondary);
  background: color-mix(in srgb, var(--record-page) 82%, #000);
  font-size: 12.5px;
  line-height: 1.75;
}
html.light .detail-tabs pre { background: #f7f9fc; }
@keyframes spin { to { transform: rotate(360deg); } }
@keyframes pulse {
  50% { opacity: .55; box-shadow: 0 0 0 8px rgba(231, 163, 67, .04); }
}
@media (max-width: 1180px) {
  .summary-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .filters { grid-template-columns: minmax(220px, 1fr) 140px 130px; }
  .filters :deep(.el-date-editor) { width: 100%; }
}
@media (max-width: 720px) {
  .header-inner,
  .content { width: calc(100% - 24px); }
  .header-inner { min-height: 70px; gap: 10px; }
  .header-divider,
  .live-label,
  .heading p,
  .header-actions .el-button:first-child { display: none; }
  .heading h1 { font-size: 17px; }
  .content { padding-top: 16px; }
  .summary-grid { grid-template-columns: 1fr 1fr; gap: 9px; }
  .summary-card { min-height: 92px; padding: 13px; }
  .summary-icon { width: 38px; height: 38px; }
  .summary-card strong { font-size: 21px; }
  .summary-card small { display: none; }
  .filters { grid-template-columns: 1fr 1fr; padding: 0 14px 14px; }
  .keyword-input,
  .filters :deep(.el-date-editor) { grid-column: 1 / -1; }
  .panel-heading { padding: 17px 14px 14px; }
  .panel-heading p { display: none; }
  .panel-footer { align-items: flex-start; flex-direction: column; padding: 12px 14px; }
  .panel-footer :deep(.el-pagination__sizes) { display: none; }
  .detail-meta { grid-template-columns: 1fr; margin: 14px; }
  .drawer-header { padding: 18px 14px; }
  .detail-tabs { margin: 0 14px; }
}
</style>

<style>
.record-drawer.el-drawer {
  --record-page: #171a22;
  --record-surface: #222630;
  --record-surface-raised: #282d38;
  --record-surface-soft: #2e3440;
  --record-primary: #f7f8fb;
  --record-secondary: #cbd1dc;
  --record-muted: #a4adbb;
  --record-border: #3c4452;
  --record-accent: #f0b45d;
  color: var(--record-primary);
  background: var(--record-surface);
  box-shadow: -18px 0 48px rgba(0, 0, 0, .28);
}
.record-drawer .el-drawer__body { padding: 0; }
html.light .record-drawer.el-drawer {
  --record-page: #f2f4f7;
  --record-surface: #ffffff;
  --record-surface-raised: #f8fafc;
  --record-surface-soft: #eef2f6;
  --record-primary: #1c2430;
  --record-secondary: #3e4a5d;
  --record-muted: #5d697a;
  --record-border: #d4dbe5;
  --record-accent: #a9630a;
  box-shadow: -18px 0 48px rgba(38, 50, 68, .18);
}
</style>
