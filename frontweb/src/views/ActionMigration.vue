<template>
  <div class="action-migration-page">
    <header class="topbar">
      <div>
        <h1>动作迁移</h1>
        <p>用驱动视频提取动作结构，把动作迁移到参考人物上，生成结果可预检、重试和复盘。</p>
      </div>
      <div class="top-actions">
        <el-button :icon="Refresh" @click="refreshJobs">刷新</el-button>
        <el-button type="primary" :icon="Upload" @click="scrollToCreator">上传素材</el-button>
      </div>
    </header>

    <main class="workspace">
      <aside class="job-pane">
        <div class="pane-title">
          <span>任务</span>
          <el-tag size="small" effect="plain">{{ jobs.length }}</el-tag>
        </div>
        <el-scrollbar class="job-list">
          <button
            v-for="job in jobs"
            :key="job.id"
            class="job-item"
            :class="{ active: selectedJob?.id === job.id }"
            @click="selectJob(job.id)"
          >
            <strong>{{ job.title || '未命名任务' }}</strong>
            <span>{{ statusText(job.status) }} · {{ modeText(job.mode) }}</span>
            <small>{{ formatTime(job.updated_at || job.created_at) }}</small>
          </button>
          <el-empty v-if="!loadingJobs && jobs.length === 0" description="暂无动作迁移任务" />
        </el-scrollbar>
      </aside>

      <section class="main-pane">
        <section ref="creatorRef" class="creator-panel">
          <div class="section-head">
            <div>
              <h2>新建任务</h2>
              <p>建议选择 5-8 秒清晰动作片段，参考图使用单人全身或半身正面照。</p>
            </div>
            <el-tag :type="capability.ok ? 'success' : 'danger'" effect="plain">
              {{ capability.ok ? '模型可用' : '模型需配置' }}
            </el-tag>
          </div>

          <div v-if="!capability.ok" class="capability-warning">
            <el-icon><Warning /></el-icon>
            <span>{{ capability.message || '请在 AI 配置中选择支持 source_video_url 的视频模型。' }}</span>
          </div>

          <el-form label-position="top" class="create-form">
            <div class="form-grid">
              <el-form-item label="任务标题">
                <el-input v-model="form.title" maxlength="80" placeholder="例如：女主走廊奔跑动作迁移" />
              </el-form-item>
              <el-form-item label="剧集 ID">
                <el-input-number v-model="form.drama_id" :min="0" controls-position="right" />
              </el-form-item>
              <el-form-item label="项目角色">
                <el-select
                  v-model="form.character_id"
                  clearable
                  filterable
                  :disabled="!form.drama_id"
                  placeholder="可选：使用角色衣橱"
                  @change="onCharacterChange"
                >
                  <el-option
                    v-for="character in projectCharacters"
                    :key="character.id"
                    :label="character.name || '未命名'"
                    :value="character.id"
                  />
                </el-select>
              </el-form-item>
              <el-form-item label="角色造型">
                <el-select
                  v-model="form.character_look_id"
                  clearable
                  filterable
                  :disabled="!form.character_id"
                  placeholder="选择衣橱中的指定 Look"
                >
                  <el-option
                    v-for="look in projectLooks"
                    :key="look.id"
                    :label="`${look.name}${look.is_default ? '（默认）' : ''}`"
                    :value="look.id"
                  />
                </el-select>
              </el-form-item>
              <el-form-item label="迁移模式">
                <el-segmented v-model="form.mode" :options="modeOptions" />
              </el-form-item>
              <el-form-item label="输出规格">
                <div class="inline-fields">
                  <el-select v-model="form.aspect_ratio">
                    <el-option label="9:16 竖屏" value="9:16" />
                    <el-option label="16:9 横屏" value="16:9" />
                    <el-option label="1:1 方形" value="1:1" />
                    <el-option label="4:3 横屏" value="4:3" />
                  </el-select>
                  <el-select v-model="form.resolution">
                    <el-option label="480p 快速" value="480p" />
                    <el-option label="720p 精细" value="720p" />
                    <el-option label="1080p 高清" value="1080p" />
                  </el-select>
                </div>
              </el-form-item>
            </div>

            <div class="upload-grid">
              <label class="upload-box">
                <input type="file" accept="video/*" @change="onFileChange($event, 'driving')" />
                <video v-if="drivingPreview" :src="drivingPreview" muted controls />
                <div v-else class="upload-placeholder">
                  <el-icon><VideoCamera /></el-icon>
                  <strong>驱动视频</strong>
                  <span>上传要保留动作和镜头节奏的视频</span>
                </div>
                <small v-if="form.drivingFile">{{ fileSummary(form.drivingFile) }}</small>
              </label>

              <label class="upload-box">
                <input type="file" accept="image/*" @change="onFileChange($event, 'reference')" />
                <img v-if="referencePreview || selectedLookPreview" :src="referencePreview || selectedLookPreview" alt="" />
                <div v-else class="upload-placeholder">
                  <el-icon><Picture /></el-icon>
                  <strong>参考人物图（可选）</strong>
                  <span>已选角色造型时可不上传；未选造型时请上传</span>
                </div>
                <small v-if="form.referenceFile">{{ fileSummary(form.referenceFile) }}</small>
              </label>
            </div>

            <div class="form-grid">
              <el-form-item label="裁剪开始秒">
                <el-input-number v-model="form.start_time" :min="0" :step="0.5" controls-position="right" />
              </el-form-item>
              <el-form-item label="裁剪结束秒">
                <el-input-number v-model="form.end_time" :min="0" :step="0.5" controls-position="right" />
              </el-form-item>
            </div>
            <el-form-item label="补充提示词">
              <el-input
                v-model="form.prompt"
                type="textarea"
                :rows="3"
                placeholder="可补充角色、服装、场景、镜头风格；系统会自动加入动作迁移约束。"
              />
            </el-form-item>
            <div class="submit-row">
              <el-button :disabled="!canCreate" :loading="creating" type="primary" :icon="CircleCheck" @click="createJob">
                创建并预检
              </el-button>
              <el-button :disabled="!selectedJob || !canSubmitSelected" :loading="submitting" :icon="VideoPlay" @click="submitSelected">
                提交生成
              </el-button>
            </div>
          </el-form>
        </section>

        <section class="detail-panel" v-loading="loadingJob">
          <div v-if="!selectedJob" class="empty-detail">
            <el-empty description="选择任务查看预检和结果" />
          </div>
          <template v-else>
            <div class="section-head">
              <div>
                <h2>{{ selectedJob.title || '未命名任务' }}</h2>
                <p>{{ statusText(selectedJob.status) }} · {{ modeText(selectedJob.mode) }} · {{ formatTime(selectedJob.updated_at) }}</p>
              </div>
              <div class="task-actions">
                <el-button :icon="CircleCheck" @click="runPreflight">重新预检</el-button>
                <el-button type="primary" :disabled="!canSubmitSelected" :loading="submitting" :icon="VideoPlay" @click="submitSelected">
                  提交生成
                </el-button>
                <el-button :disabled="!selectedJob.current_video_generation_id" :icon="RefreshRight" @click="retrySelected">重试</el-button>
                <el-button type="danger" plain :icon="Delete" @click="deleteSelected">删除</el-button>
              </div>
            </div>

            <div class="preview-grid">
              <div class="media-panel">
                <h3>驱动结构</h3>
                <video v-if="assetUrl(selectedJob.structure_video_url || selectedJob.structure_video_path || selectedJob.driving_video_url || selectedJob.driving_video_path)" :src="assetUrl(selectedJob.structure_video_url || selectedJob.structure_video_path || selectedJob.driving_video_url || selectedJob.driving_video_path)" controls />
                <el-empty v-else description="无驱动视频" />
              </div>
              <div class="media-panel">
                <h3>参考人物</h3>
                <img v-if="assetUrl(selectedJob.reference_image_url || selectedJob.reference_image_path)" :src="assetUrl(selectedJob.reference_image_url || selectedJob.reference_image_path)" alt="" />
                <el-empty v-else description="无参考图" />
              </div>
              <div class="media-panel">
                <h3>当前结果</h3>
                <video v-if="currentResultUrl" :src="currentResultUrl" controls />
                <el-empty v-else description="暂无生成结果" />
              </div>
            </div>

            <div class="diagnostics">
              <div>
                <h3>预检</h3>
                <div v-if="issues.length" class="issue-list">
                  <div v-for="issue in issues" :key="`${issue.level}-${issue.code}`" :class="['issue', issue.level]">
                    <b>{{ issue.code }}</b>
                    <span>{{ issue.message }}</span>
                  </div>
                </div>
                <el-empty v-else description="预检未发现阻塞问题" />
              </div>

              <div>
                <h3>失败复盘</h3>
                <div v-if="failureText" class="failure-box">{{ failureText }}</div>
                <el-empty v-else description="暂无失败记录" />
              </div>
            </div>

            <div class="results">
              <h3>结果版本</h3>
              <el-table :data="selectedJob.results || []" size="small">
                <el-table-column prop="version" label="版本" width="80">
                  <template #default="{ row }">v{{ row.version }}</template>
                </el-table-column>
                <el-table-column prop="status" label="状态" width="120">
                  <template #default="{ row }">
                    <el-tag :type="statusTag(row.status)" effect="plain">{{ statusText(row.status) }}</el-tag>
                  </template>
                </el-table-column>
                <el-table-column prop="created_at" label="创建时间" min-width="170">
                  <template #default="{ row }">{{ formatTime(row.created_at) }}</template>
                </el-table-column>
                <el-table-column prop="error_msg" label="问题" min-width="220" show-overflow-tooltip />
              </el-table>
            </div>
          </template>
        </section>
      </section>
    </main>
  </div>
</template>

<script setup>
import { computed, onBeforeUnmount, onMounted, reactive, ref, watch } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import {
  CircleCheck,
  Delete,
  Picture,
  Refresh,
  RefreshRight,
  Upload,
  VideoCamera,
  VideoPlay,
  Warning
} from '@element-plus/icons-vue'
import { actionMigrationAPI } from '@/api/actionMigration'
import { dramaAPI } from '@/api/drama'
import { characterLookAPI } from '@/api/characterLooks'

const jobs = ref([])
const selectedJob = ref(null)
const loadingJobs = ref(false)
const loadingJob = ref(false)
const creating = ref(false)
const submitting = ref(false)
const creatorRef = ref(null)
const drivingPreview = ref('')
const referencePreview = ref('')
const pollTimer = ref(null)
const projectCharacters = ref([])
const projectLooks = ref([])

const capability = reactive({ ok: true, message: '' })
const form = reactive({
  title: '',
  drama_id: null,
  character_id: null,
  character_look_id: null,
  mode: 'balanced',
  aspect_ratio: '9:16',
  resolution: '480p',
  start_time: null,
  end_time: null,
  prompt: '',
  drivingFile: null,
  referenceFile: null
})

const modeOptions = [
  { label: '强换人', value: 'identity' },
  { label: '平衡', value: 'balanced' },
  { label: '强动作', value: 'motion' }
]

const canCreate = computed(() =>
  Boolean(form.drivingFile && (form.referenceFile || form.character_look_id) && !creating.value)
)
const selectedLookPreview = computed(() => {
  const look = projectLooks.value.find((item) => Number(item.id) === Number(form.character_look_id))
  return assetUrl(look?.local_path || look?.image_url || look?.ref_image)
})
const issues = computed(() => selectedJob.value?.preflight_report?.issues || [])
const canSubmitSelected = computed(() => selectedJob.value?.preflight_report?.ok && !['running', 'completed'].includes(selectedJob.value?.status))
const currentResultUrl = computed(() => assetUrl(selectedJob.value?.current_result?.video_url || selectedJob.value?.current_result?.local_path))
const failureText = computed(() => {
  const job = selectedJob.value
  if (!job) return ''
  const failed = (job.results || []).find((item) => item.status === 'failed' || item.error_msg)
  return job.error_msg || failed?.error_msg || ''
})

function assetUrl(value) {
  const raw = String(value || '').trim()
  if (!raw) return ''
  if (/^(https?:|blob:|data:)/i.test(raw)) return raw
  if (raw.startsWith('/static/')) return raw
  return `/static/${raw.replace(/^[/\\]+/, '').replace(/\\/g, '/')}`
}

function statusText(status) {
  return {
    draft: '草稿',
    ready: '可提交',
    running: '生成中',
    completed: '已完成',
    failed: '失败',
    cancelled: '已取消'
  }[status] || status || '未知'
}

function statusTag(status) {
  if (status === 'completed') return 'success'
  if (status === 'failed') return 'danger'
  if (status === 'running' || status === 'processing') return 'warning'
  return 'info'
}

function modeText(mode) {
  return {
    identity: '强换人',
    balanced: '平衡',
    motion: '强动作'
  }[mode] || mode || '平衡'
}

function formatTime(value) {
  if (!value) return ''
  return String(value).slice(0, 19).replace('T', ' ')
}

function fileSummary(file) {
  if (!file) return ''
  const mb = file.size / 1024 / 1024
  return `${file.name} · ${mb >= 1 ? mb.toFixed(1) + ' MB' : Math.round(file.size / 1024) + ' KB'}`
}

function revokePreview(kind) {
  const url = kind === 'driving' ? drivingPreview.value : referencePreview.value
  if (url?.startsWith('blob:')) URL.revokeObjectURL(url)
}

function onFileChange(event, kind) {
  const file = event.target.files?.[0]
  if (!file) return
  revokePreview(kind)
  if (kind === 'driving') {
    form.drivingFile = file
    drivingPreview.value = URL.createObjectURL(file)
  } else {
    form.referenceFile = file
    referencePreview.value = URL.createObjectURL(file)
  }
}

async function loadProjectCharacters() {
  form.character_id = null
  form.character_look_id = null
  projectCharacters.value = []
  projectLooks.value = []
  if (!form.drama_id) return
  try {
    const data = await dramaAPI.getCharacters(form.drama_id)
    projectCharacters.value = Array.isArray(data) ? data : (data?.items || data?.characters || [])
  } catch (error) {
    ElMessage.error(error?.message || '加载项目角色失败')
  }
}

async function onCharacterChange(characterId) {
  form.character_look_id = null
  projectLooks.value = []
  if (!characterId) return
  try {
    const data = await characterLookAPI.list(characterId)
    projectLooks.value = data?.items || []
    form.character_look_id = projectLooks.value.find((item) => item.is_default)?.id || null
  } catch (error) {
    ElMessage.error(error?.message || '加载角色衣橱失败')
  }
}

watch(() => form.drama_id, loadProjectCharacters)

function scrollToCreator() {
  creatorRef.value?.scrollIntoView({ behavior: 'smooth', block: 'start' })
}

async function loadCapability() {
  const data = await actionMigrationAPI.capability()
  capability.ok = Boolean(data?.capability?.ok)
  capability.message = data?.capability?.message || ''
}

async function refreshJobs() {
  loadingJobs.value = true
  try {
    const data = await actionMigrationAPI.listJobs({ limit: 50 })
    jobs.value = data.jobs || []
    if (!selectedJob.value && jobs.value[0]) await selectJob(jobs.value[0].id)
    if (selectedJob.value && !jobs.value.some((job) => job.id === selectedJob.value.id)) selectedJob.value = null
  } finally {
    loadingJobs.value = false
  }
}

async function selectJob(id) {
  loadingJob.value = true
  try {
    const data = await actionMigrationAPI.getJob(id)
    selectedJob.value = data.job
  } finally {
    loadingJob.value = false
  }
}

async function createJob() {
  if (!canCreate.value) return
  creating.value = true
  try {
    const body = new FormData()
    body.append('title', form.title || '动作迁移任务')
    if (form.drama_id) body.append('drama_id', String(form.drama_id))
    if (form.character_id) body.append('character_id', String(form.character_id))
    if (form.character_look_id) body.append('character_look_id', String(form.character_look_id))
    body.append('mode', form.mode)
    body.append('aspect_ratio', form.aspect_ratio)
    body.append('resolution', form.resolution)
    if (form.start_time != null) body.append('start_time', String(form.start_time))
    if (form.end_time != null) body.append('end_time', String(form.end_time))
    if (form.prompt?.trim()) body.append('prompt', form.prompt.trim())
    body.append('driving_video', form.drivingFile)
    if (form.referenceFile) body.append('reference_image', form.referenceFile)
    const data = await actionMigrationAPI.createJob(body)
    ElMessage.success('任务已创建，预检完成')
    await refreshJobs()
    await selectJob(data.job.id)
  } finally {
    creating.value = false
  }
}

async function runPreflight() {
  if (!selectedJob.value) return
  const data = await actionMigrationAPI.preflightJob(selectedJob.value.id)
  selectedJob.value = data.job
  ElMessage.success(data.report?.ok ? '预检通过' : '预检发现问题')
}

async function submitSelected() {
  if (!selectedJob.value || !canSubmitSelected.value) return
  submitting.value = true
  try {
    const data = await actionMigrationAPI.submitJob(selectedJob.value.id)
    selectedJob.value = data.job
    ElMessage.success('已提交生成')
    await refreshJobs()
  } finally {
    submitting.value = false
  }
}

async function retrySelected() {
  if (!selectedJob.value) return
  submitting.value = true
  try {
    const data = await actionMigrationAPI.retryJob(selectedJob.value.id)
    selectedJob.value = data.job
    ElMessage.success('已重新提交')
    await refreshJobs()
  } finally {
    submitting.value = false
  }
}

async function deleteSelected() {
  if (!selectedJob.value) return
  await ElMessageBox.confirm('删除后任务会从列表隐藏，生成记录仍保留在视频记录中。', '删除动作迁移任务', { type: 'warning' })
  await actionMigrationAPI.deleteJob(selectedJob.value.id)
  selectedJob.value = null
  await refreshJobs()
}

function startPolling() {
  pollTimer.value = window.setInterval(async () => {
    if (selectedJob.value && ['running', 'processing'].includes(selectedJob.value.status)) {
      await selectJob(selectedJob.value.id)
      await refreshJobs()
    }
  }, 5000)
}

onMounted(async () => {
  await loadCapability()
  await refreshJobs()
  startPolling()
})

onBeforeUnmount(() => {
  if (pollTimer.value) window.clearInterval(pollTimer.value)
  revokePreview('driving')
  revokePreview('reference')
})
</script>

<style scoped>
.action-migration-page {
  min-height: 100vh;
  background: #f6f7f9;
  color: #171717;
}

.topbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 24px;
  padding: 22px 28px;
  background: #ffffff;
  border-bottom: 1px solid #e5e7eb;
}

.topbar h1,
.section-head h2,
.media-panel h3,
.diagnostics h3,
.results h3 {
  margin: 0;
  letter-spacing: 0;
}

.topbar p,
.section-head p {
  margin: 6px 0 0;
  color: #64748b;
}

.top-actions,
.task-actions,
.submit-row,
.inline-fields {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
}

.workspace {
  display: grid;
  grid-template-columns: 300px minmax(0, 1fr);
  gap: 18px;
  padding: 18px;
}

.job-pane,
.creator-panel,
.detail-panel {
  background: #ffffff;
  border: 1px solid #e5e7eb;
  border-radius: 8px;
}

.job-pane {
  position: sticky;
  top: 18px;
  height: calc(100vh - 36px);
  overflow: hidden;
}

.pane-title {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 16px;
  border-bottom: 1px solid #e5e7eb;
  font-weight: 700;
}

.job-list {
  height: calc(100% - 57px);
}

.job-item {
  display: block;
  width: calc(100% - 20px);
  margin: 10px;
  padding: 12px;
  text-align: left;
  background: #ffffff;
  border: 1px solid #e5e7eb;
  border-radius: 8px;
  cursor: pointer;
}

.job-item.active {
  border-color: #2563eb;
  background: #eff6ff;
}

.job-item strong,
.job-item span,
.job-item small {
  display: block;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.job-item span,
.job-item small {
  margin-top: 5px;
  color: #64748b;
}

.main-pane {
  display: grid;
  gap: 18px;
  min-width: 0;
}

.creator-panel,
.detail-panel {
  padding: 18px;
}

.section-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 18px;
  margin-bottom: 16px;
}

.capability-warning {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 10px 12px;
  margin-bottom: 16px;
  color: #991b1b;
  background: #fef2f2;
  border: 1px solid #fecaca;
  border-radius: 8px;
}

.form-grid,
.upload-grid,
.preview-grid,
.diagnostics {
  display: grid;
  gap: 14px;
}

.form-grid {
  grid-template-columns: repeat(2, minmax(0, 1fr));
}

.upload-grid,
.preview-grid,
.diagnostics {
  grid-template-columns: repeat(3, minmax(0, 1fr));
}

.upload-grid {
  grid-template-columns: repeat(2, minmax(0, 1fr));
  margin-bottom: 16px;
}

.upload-box {
  position: relative;
  display: block;
  min-height: 220px;
  overflow: hidden;
  background: #f8fafc;
  border: 1px dashed #94a3b8;
  border-radius: 8px;
  cursor: pointer;
}

.upload-box input {
  position: absolute;
  inset: 0;
  opacity: 0;
  cursor: pointer;
}

.upload-box video,
.upload-box img,
.media-panel video,
.media-panel img {
  width: 100%;
  height: 220px;
  object-fit: contain;
  background: #0f172a;
}

.upload-box small {
  display: block;
  padding: 8px 10px;
  color: #475569;
  background: #ffffff;
}

.upload-placeholder {
  display: grid;
  place-items: center;
  align-content: center;
  min-height: 220px;
  padding: 18px;
  text-align: center;
  color: #475569;
}

.upload-placeholder .el-icon {
  margin-bottom: 10px;
  font-size: 32px;
  color: #2563eb;
}

.upload-placeholder strong,
.upload-placeholder span {
  display: block;
}

.upload-placeholder span {
  margin-top: 6px;
  font-size: 13px;
}

.inline-fields .el-select {
  flex: 1 1 150px;
}

.empty-detail {
  min-height: 320px;
  display: grid;
  place-items: center;
}

.media-panel {
  min-width: 0;
  overflow: hidden;
  border: 1px solid #e5e7eb;
  border-radius: 8px;
}

.media-panel h3 {
  padding: 10px 12px;
  font-size: 14px;
  border-bottom: 1px solid #e5e7eb;
}

.diagnostics {
  grid-template-columns: 1fr 1fr;
  margin-top: 16px;
}

.issue-list {
  display: grid;
  gap: 8px;
}

.issue,
.failure-box {
  padding: 10px 12px;
  border-radius: 8px;
  border: 1px solid #e5e7eb;
  background: #f8fafc;
}

.issue b {
  display: block;
  margin-bottom: 4px;
}

.issue.error {
  color: #991b1b;
  background: #fef2f2;
  border-color: #fecaca;
}

.issue.warning {
  color: #92400e;
  background: #fffbeb;
  border-color: #fde68a;
}

.failure-box {
  color: #991b1b;
  white-space: pre-wrap;
}

.results {
  margin-top: 16px;
}

@media (max-width: 1100px) {
  .workspace,
  .form-grid,
  .upload-grid,
  .preview-grid,
  .diagnostics {
    grid-template-columns: 1fr;
  }

  .job-pane {
    position: static;
    height: auto;
  }

  .job-list {
    height: 260px;
  }
}

@media (max-width: 720px) {
  .topbar,
  .section-head {
    display: block;
  }

  .top-actions,
  .task-actions {
    margin-top: 12px;
  }

  .workspace {
    padding: 10px;
  }
}
</style>
