<template>
  <div class="holycrab-assets tab-content">
    <el-alert type="info" :closable="false" show-icon class="intro">
      <template #title>
        <span>
          管理 HolyCrab 账号下可供 Seedance 2.0 使用的图片、视频和音频素材。
          列表、详情、播放、下载、URL 导入、本地上传和删除均通过后端代理完成，API Key 不会发送到第三方页面。
        </span>
      </template>
    </el-alert>

    <el-form label-width="116px" class="connection-form">
      <el-form-item label="HolyCrab 配置">
        <el-select
          v-model="configId"
          placeholder="请选择已保存的 HolyCrab 视频配置"
          style="width: 100%"
          @change="onConfigChange"
        >
          <el-option
            v-for="item in holyCrabConfigs"
            :key="item.id"
            :value="item.id"
            :label="`${item.name}${item.is_default ? '（默认）' : ''}`"
            :disabled="!item.is_active"
          />
        </el-select>
        <p class="field-hint">
          复用“AI 配置”中的 <code>holycrab</code> 视频配置和 <code>X-User-Token</code>；无需单独保存密钥。
        </p>
      </el-form-item>
    </el-form>

    <el-empty
      v-if="holyCrabConfigs.length === 0"
      description="尚未配置 HolyCrab，请先在 AI 配置中添加或使用一键配置 HolyCrab"
    />

    <template v-else>
      <div class="toolbar">
        <el-input
          v-model="filters.name"
          clearable
          placeholder="按素材名称搜索"
          class="name-filter"
          @keyup.enter="search"
        />
        <el-select v-model="filters.status" placeholder="全部状态" class="status-filter" @change="search">
          <el-option label="全部状态" value="" />
          <el-option label="已结束（成功或失败）" value="1" />
          <el-option label="处理中" value="processing" />
        </el-select>
        <el-button type="primary" :loading="loading" @click="search">查询</el-button>
        <el-button :loading="loading" @click="refresh">刷新</el-button>
        <div class="toolbar-spacer" />
        <el-button type="success" @click="openUpload">上传本地文件</el-button>
        <el-button type="primary" plain @click="openUrlImport">从 URL 导入</el-button>
      </div>

      <el-table v-loading="loading" :data="assetRows" stripe class="asset-table">
        <el-table-column label="预览" width="76">
          <template #default="{ row }">
            <el-image
              v-if="row.assetType === 'Image' && assetUrl(row)"
              :src="assetUrl(row)"
              :preview-src-list="[assetUrl(row)]"
              fit="cover"
              preview-teleported
              class="asset-thumb"
            >
              <template #error><div class="thumb-fallback">图片</div></template>
            </el-image>
            <div v-else class="thumb-fallback">{{ typeLabel(row.assetType) }}</div>
          </template>
        </el-table-column>
        <el-table-column prop="name" label="名称" min-width="180" show-overflow-tooltip />
        <el-table-column prop="uniqId" label="uniqId" min-width="220" show-overflow-tooltip />
        <el-table-column label="类型" width="88">
          <template #default="{ row }">{{ typeLabel(row.assetType) }}</template>
        </el-table-column>
        <el-table-column label="状态" width="104">
          <template #default="{ row }">
            <el-tag :type="statusTagType(row.status)" size="small">
              {{ statusLabel(row.status) }}
            </el-tag>
          </template>
        </el-table-column>
        <el-table-column label="时长" width="76">
          <template #default="{ row }">{{ row.duration == null ? '—' : `${row.duration}s` }}</template>
        </el-table-column>
        <el-table-column label="创建时间" min-width="164">
          <template #default="{ row }">{{ formatTime(row.createTime) }}</template>
        </el-table-column>
        <el-table-column label="操作" width="232" fixed="right">
          <template #default="{ row }">
            <el-button
              v-if="isPlayableAsset(row)"
              link
              type="success"
              size="small"
              @click="openPlayer(row)"
            >播放</el-button>
            <el-button link type="primary" size="small" @click="downloadAsset(row)">下载</el-button>
            <el-button link type="primary" size="small" @click="showDetail(row)">详情</el-button>
            <el-button link type="danger" size="small" @click="removeAsset(row)">删除</el-button>
          </template>
        </el-table-column>
      </el-table>

      <div class="pagination-row">
        <span class="total-hint">共 {{ total }} 条素材</span>
        <el-pagination
          v-model:current-page="page"
          v-model:page-size="pageSize"
          :page-sizes="[20, 50, 100]"
          :total="total"
          layout="sizes, prev, pager, next, jumper"
          @current-change="refresh"
          @size-change="onPageSizeChange"
        />
      </div>
    </template>

    <el-dialog v-model="urlDialog" title="从 URL 导入 HolyCrab 素材" width="560px" append-to-body align-center destroy-on-close>
      <el-form label-width="86px">
        <el-form-item label="素材 URL" required>
          <el-input
            v-model="urlForm.url"
            type="textarea"
            :rows="3"
            placeholder="https://example.com/asset.png"
          />
        </el-form-item>
        <el-form-item label="素材名称">
          <el-input v-model="urlForm.name" clearable placeholder="可选，不填时由 URL 推断" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="urlDialog = false">取消</el-button>
        <el-button type="primary" :loading="dialogLoading" @click="submitUrlImport">导入</el-button>
      </template>
    </el-dialog>

    <el-dialog v-model="uploadDialog" title="上传本地素材到 HolyCrab" width="560px" append-to-body align-center destroy-on-close>
      <el-form label-width="96px">
        <el-form-item label="本地文件" required>
          <el-upload
            v-model:file-list="uploadFileList"
            :auto-upload="false"
            :limit="1"
            accept="image/*,video/*,audio/*"
            :on-change="onUploadFileChange"
            :on-remove="onUploadFileRemove"
          >
            <el-button type="primary" plain>选择图片、视频或音频</el-button>
          </el-upload>
        </el-form-item>
        <el-form-item label="素材名称">
          <el-input v-model="uploadForm.name" clearable placeholder="默认使用文件名" />
        </el-form-item>
        <el-form-item label="时长（秒）">
          <el-input-number v-model="uploadForm.duration" :min="1" :max="86400" controls-position="right" />
          <span class="duration-hint">仅音频、视频需要；图片会自动忽略</span>
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="uploadDialog = false">取消</el-button>
        <el-button type="primary" :loading="dialogLoading" @click="submitUpload">上传</el-button>
      </template>
    </el-dialog>

    <el-dialog v-model="detailDialog" title="HolyCrab 素材详情" width="680px" append-to-body align-center destroy-on-close>
      <el-input :model-value="detailJson" type="textarea" :rows="18" readonly class="mono" />
      <template #footer><el-button type="primary" @click="detailDialog = false">关闭</el-button></template>
    </el-dialog>

    <el-dialog
      v-model="mediaDialog"
      :title="mediaRow ? `播放：${mediaRow.name || mediaRow.uniqId}` : '播放素材'"
      width="820px"
      append-to-body
      align-center
      destroy-on-close
      @closed="mediaRow = null"
    >
      <div v-if="mediaRow" class="media-player-wrap">
        <video
          v-if="String(mediaRow.assetType).toLowerCase() === 'video'"
          :src="assetContentUrl(mediaRow)"
          controls
          playsinline
          preload="metadata"
          class="video-player"
        />
        <audio
          v-else-if="String(mediaRow.assetType).toLowerCase() === 'audio'"
          :src="assetContentUrl(mediaRow)"
          controls
          preload="metadata"
          class="audio-player"
        />
        <div class="media-meta">
          <span>{{ typeLabel(mediaRow.assetType) }}</span>
          <code>{{ mediaRow.uniqId }}</code>
        </div>
      </div>
      <template #footer>
        <el-button v-if="mediaRow" type="primary" plain @click="downloadAsset(mediaRow)">下载素材</el-button>
        <el-button type="primary" @click="mediaDialog = false">关闭</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup>
import { computed, reactive, ref, watch } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { aiAPI } from '@/api/ai'

const props = defineProps({
  configs: { type: Array, default: () => [] },
})

const holyCrabConfigs = computed(() =>
  (props.configs || []).filter((item) => {
    const provider = String(item.provider || '').toLowerCase()
    const protocol = String(item.api_protocol || '').toLowerCase()
    const baseUrl = String(item.base_url || '').toLowerCase()
    return (
      provider === 'holycrab' ||
      provider === 'holycrab.ai' ||
      protocol === 'holycrab' ||
      baseUrl.includes('holycrab.ai')
    )
  })
)

const configId = ref(null)
const loading = ref(false)
const dialogLoading = ref(false)
const assetRows = ref([])
const total = ref(0)
const page = ref(1)
const pageSize = ref(50)
const filters = reactive({ name: '', status: '' })

const urlDialog = ref(false)
const urlForm = reactive({ url: '', name: '' })
const uploadDialog = ref(false)
const uploadFile = ref(null)
const uploadFileList = ref([])
const uploadForm = reactive({ name: '', duration: null })
const detailDialog = ref(false)
const detailJson = ref('')
const mediaDialog = ref(false)
const mediaRow = ref(null)

watch(
  holyCrabConfigs,
  (rows) => {
    if (!rows.length) {
      configId.value = null
      assetRows.value = []
      total.value = 0
      return
    }
    if (!rows.some((item) => item.id === configId.value && item.is_active)) {
      const selected = rows.find((item) => item.is_default && item.is_active) || rows.find((item) => item.is_active) || rows[0]
      configId.value = selected.id
      page.value = 1
      refresh()
    }
  },
  { immediate: true }
)

function requestBody(action, extra = {}) {
  return { action, config_id: configId.value, ...extra }
}

async function refresh() {
  if (!configId.value) return
  loading.value = true
  try {
    const data = await aiAPI.holyCrabAsset(
      requestBody('list', {
        page: page.value,
        page_size: pageSize.value,
        name: filters.name.trim(),
        status: filters.status,
      })
    )
    assetRows.value = Array.isArray(data?.records) ? data.records : []
    total.value = Number(data?.total) || 0
  } catch (_) {
    assetRows.value = []
    total.value = 0
  } finally {
    loading.value = false
  }
}

function search() {
  page.value = 1
  refresh()
}

function onConfigChange() {
  page.value = 1
  refresh()
}

function onPageSizeChange() {
  page.value = 1
  refresh()
}

function currentConfig() {
  return holyCrabConfigs.value.find((item) => item.id === configId.value)
}

function assetUrl(row) {
  const raw = String(row?.url || '').trim()
  if (!raw) return ''
  if (/^https?:\/\//i.test(raw)) return raw
  try {
    return new URL(raw, currentConfig()?.base_url || 'https://abgzfc.holycrab.ai').toString()
  } catch (_) {
    return raw
  }
}

function assetContentUrl(row, download = false) {
  const cfg = encodeURIComponent(String(configId.value || ''))
  const uniqId = encodeURIComponent(String(row?.uniqId || ''))
  const query = download ? '?download=1' : ''
  return `/api/v1/ai-configs/holycrab-assets/${cfg}/${uniqId}/content${query}`
}

function isPlayableAsset(row) {
  const type = String(row?.assetType || '').toLowerCase()
  return type === 'video' || type === 'audio'
}

function openPlayer(row) {
  mediaRow.value = row
  mediaDialog.value = true
}

function downloadAsset(row) {
  const link = document.createElement('a')
  link.href = assetContentUrl(row, true)
  link.download = ''
  document.body.appendChild(link)
  link.click()
  link.remove()
}

function typeLabel(value) {
  return { Image: '图片', Video: '视频', Audio: '音频' }[value] || value || '素材'
}

function statusLabel(value) {
  const status = String(value || '').toLowerCase()
  if (status === 'success') return '成功'
  if (status === 'failed') return '失败'
  if (status === 'processing') return '处理中'
  return value || '未知'
}

function statusTagType(value) {
  const status = String(value || '').toLowerCase()
  if (status === 'success') return 'success'
  if (status === 'failed') return 'danger'
  return 'warning'
}

function formatTime(value) {
  if (!value) return '—'
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? String(value) : date.toLocaleString('zh-CN', { hour12: false })
}

function openUrlImport() {
  urlForm.url = ''
  urlForm.name = ''
  urlDialog.value = true
}

async function submitUrlImport() {
  if (!urlForm.url.trim()) {
    ElMessage.warning('请输入素材 URL')
    return
  }
  dialogLoading.value = true
  try {
    await aiAPI.holyCrabAsset(
      requestBody('create_from_url', { url: urlForm.url.trim(), name: urlForm.name.trim() })
    )
    ElMessage.success('素材已提交，HolyCrab 正在处理')
    urlDialog.value = false
    search()
  } finally {
    dialogLoading.value = false
  }
}

function openUpload() {
  uploadFile.value = null
  uploadFileList.value = []
  uploadForm.name = ''
  uploadForm.duration = null
  uploadDialog.value = true
}

function onUploadFileChange(file) {
  uploadFile.value = file?.raw || null
  if (!uploadForm.name && file?.name) {
    uploadForm.name = String(file.name).replace(/\.[^.]+$/, '')
  }
}

function onUploadFileRemove() {
  uploadFile.value = null
}

async function submitUpload() {
  if (!uploadFile.value) {
    ElMessage.warning('请选择需要上传的素材文件')
    return
  }
  const form = new FormData()
  form.append('action', 'upload')
  form.append('config_id', String(configId.value))
  form.append('file', uploadFile.value)
  if (uploadForm.name.trim()) form.append('name', uploadForm.name.trim())
  if (uploadForm.duration) form.append('duration_seconds', String(uploadForm.duration))

  dialogLoading.value = true
  try {
    await aiAPI.uploadHolyCrabAsset(form)
    ElMessage.success('文件上传成功，HolyCrab 正在处理素材')
    uploadDialog.value = false
    search()
  } finally {
    dialogLoading.value = false
  }
}

async function showDetail(row) {
  dialogLoading.value = true
  try {
    const data = await aiAPI.holyCrabAsset(requestBody('get', { uniq_id: row.uniqId }))
    detailJson.value = JSON.stringify(data, null, 2)
    detailDialog.value = true
  } finally {
    dialogLoading.value = false
  }
}

async function removeAsset(row) {
  try {
    await ElMessageBox.confirm(
      `确定删除 HolyCrab 素材“${row.name || row.uniqId}”吗？此操作会删除云端素材。`,
      '删除素材',
      { type: 'warning', confirmButtonText: '确定删除', confirmButtonClass: 'el-button--danger' }
    )
  } catch (_) {
    return
  }
  await aiAPI.holyCrabAsset(requestBody('delete', { uniq_id: row.uniqId }))
  ElMessage.success('素材已删除')
  if (assetRows.value.length === 1 && page.value > 1) page.value -= 1
  refresh()
}
</script>

<style scoped>
.holycrab-assets {
  max-width: 1240px;
}
.intro {
  margin-bottom: 16px;
}
.connection-form {
  max-width: 720px;
}
.field-hint {
  margin: 6px 0 0;
  color: var(--el-text-color-secondary);
  font-size: 12px;
  line-height: 1.5;
}
.toolbar {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 10px;
  margin: 14px 0;
}
.name-filter {
  width: 240px;
}
.status-filter {
  width: 190px;
}
.toolbar-spacer {
  flex: 1;
}
.asset-table {
  width: 100%;
}
.asset-thumb,
.thumb-fallback {
  width: 48px;
  height: 48px;
  border-radius: 6px;
}
.thumb-fallback {
  display: flex;
  align-items: center;
  justify-content: center;
  color: var(--el-text-color-secondary);
  background: var(--el-fill-color-light);
  font-size: 12px;
}
.pagination-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  margin-top: 16px;
}
.total-hint,
.duration-hint {
  color: var(--el-text-color-secondary);
  font-size: 12px;
}
.duration-hint {
  margin-left: 10px;
}
.mono :deep(textarea) {
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
}
.media-player-wrap {
  display: flex;
  flex-direction: column;
  gap: 12px;
}
.video-player {
  width: 100%;
  max-height: 64vh;
  border-radius: 8px;
  background: #000;
}
.audio-player {
  width: 100%;
}
.media-meta {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  color: var(--el-text-color-secondary);
  font-size: 12px;
}
.media-meta code {
  overflow: hidden;
  text-overflow: ellipsis;
}
@media (max-width: 900px) {
  .toolbar-spacer {
    display: none;
  }
  .pagination-row {
    align-items: flex-start;
    flex-direction: column;
  }
}
</style>
