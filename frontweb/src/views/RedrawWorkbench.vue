<template>
  <div class="redraw-page">
    <header class="topbar">
      <div>
        <h1>转绘工作台</h1>
        <p>结构源锁镜头，资产包锁身份，结果版本可追踪。</p>
      </div>
      <div class="top-actions">
        <el-button :icon="Refresh" @click="refreshAll">刷新</el-button>
        <el-button :icon="Plus" type="primary" @click="jobDialog = true">新建任务</el-button>
      </div>
    </header>

    <main class="workspace">
      <aside class="job-pane">
        <div class="pane-title">
          <span>任务</span>
          <el-tag size="small" round>{{ jobs.length }}</el-tag>
        </div>
        <el-scrollbar class="job-list">
          <button
            v-for="job in jobs"
            :key="job.id"
            class="job-item"
            :class="{ active: selectedJob?.id === job.id }"
            @click="selectJob(job.id)"
          >
            <strong>{{ job.title || `任务 #${job.id}` }}</strong>
            <span>{{ statusText(job.status) }} · {{ job.stats?.done || 0 }}/{{ job.stats?.total || 0 }}</span>
            <el-progress :percentage="jobProgress(job)" :show-text="false" :stroke-width="6" />
          </button>
        </el-scrollbar>
      </aside>

      <section class="main-pane" v-loading="loadingJob">
        <div v-if="!selectedJob" class="empty-state">
          <el-empty description="选择或创建一个转绘任务" />
        </div>

        <template v-else>
          <div class="job-header">
            <div>
              <h2>{{ selectedJob.title }}</h2>
              <p>{{ selectedJob.overall_goal || '未填写整体目标' }}</p>
            </div>
            <div class="job-actions">
              <el-button :icon="Download" @click="importEpisodeCards">导入分镜</el-button>
              <el-button :icon="CircleCheck" @click="submitReadyJob">提交可用镜头</el-button>
              <el-button :icon="RefreshRight" @click="reconcileJob">同步状态</el-button>
              <el-button :icon="Tools" @click="repairJob">修复结果</el-button>
              <el-button :icon="Plus" type="primary" plain @click="cardDialog = true">添加镜头</el-button>
            </div>
          </div>

          <div class="stats-strip">
            <div><b>{{ selectedJob.stats?.total || 0 }}</b><span>总镜头</span></div>
            <div><b>{{ selectedJob.stats?.done || 0 }}</b><span>完成</span></div>
            <div><b>{{ selectedJob.stats?.running || 0 }}</b><span>运行中</span></div>
            <div><b>{{ selectedJob.stats?.failed || 0 }}</b><span>失败</span></div>
          </div>

          <el-table
            class="cards-table"
            :data="selectedJob.cards || []"
            height="310"
            highlight-current-row
            @current-change="onCardSelect"
          >
            <el-table-column prop="sort_order" label="#" width="64" />
            <el-table-column prop="title" label="镜头" min-width="180">
              <template #default="{ row }">
                <div class="shot-name">
                  <strong>{{ row.title || row.card_key || `镜头 #${row.id}` }}</strong>
                  <span>{{ row.card_key }}</span>
                </div>
              </template>
            </el-table-column>
            <el-table-column prop="status" label="状态" width="110">
              <template #default="{ row }">
                <el-tag :type="statusTag(row.status)" effect="plain">{{ statusText(row.status) }}</el-tag>
              </template>
            </el-table-column>
            <el-table-column label="结构源" width="110">
              <template #default="{ row }">
                <el-tag :type="row.structure_video_path ? 'success' : 'warning'" effect="plain">
                  {{ row.structure_strength || 'balanced' }}
                </el-tag>
              </template>
            </el-table-column>
            <el-table-column label="结果" width="90">
              <template #default="{ row }">
                <el-icon v-if="row.current_result?.video_url || row.current_result?.local_path" class="ok"><VideoCamera /></el-icon>
                <span v-else class="muted">无</span>
              </template>
            </el-table-column>
            <el-table-column prop="error_msg" label="问题" min-width="220" show-overflow-tooltip />
          </el-table>

          <section v-if="selectedCard" class="detail-grid">
            <div class="editor-panel">
              <div class="panel-head">
                <h3>{{ selectedCard.title || `镜头 #${selectedCard.id}` }}</h3>
                <div>
                  <el-button size="small" @click="saveCard">保存</el-button>
                  <el-button size="small" :icon="MagicStick" @click="makeStructure">结构源</el-button>
                  <el-button size="small" :icon="CircleCheck" @click="preflightCard">预检</el-button>
                  <el-button size="small" type="primary" :icon="VideoPlay" @click="submitCard">提交</el-button>
                </div>
              </div>

              <el-form label-position="top" class="card-form">
                <div class="form-row">
                  <el-form-item label="源视频">
                    <el-input v-model="cardForm.source_video_path" placeholder="本地相对路径、/static 地址或绝对路径" />
                  </el-form-item>
                  <el-form-item label="结构视频">
                    <el-input v-model="cardForm.structure_video_path" placeholder="生成后自动填入" />
                  </el-form-item>
                </div>
                <div class="form-row">
                  <el-form-item label="结构强度">
                    <el-segmented v-model="cardForm.structure_strength" :options="strengthOptions" />
                  </el-form-item>
                  <el-form-item label="时长">
                    <el-input-number v-model="cardForm.duration" :min="1" :max="30" controls-position="right" />
                  </el-form-item>
                </div>
                <el-form-item label="镜头提示词">
                  <el-input v-model="cardForm.prompt" type="textarea" :rows="4" />
                </el-form-item>
                <div class="json-row">
                  <el-form-item label="角色参考 JSON">
                    <el-input v-model="jsonText.character_refs" type="textarea" :rows="7" />
                  </el-form-item>
                  <el-form-item label="场景参考 JSON">
                    <el-input v-model="jsonText.scene_ref" type="textarea" :rows="7" />
                  </el-form-item>
                  <el-form-item label="道具参考 JSON">
                    <el-input v-model="jsonText.prop_refs" type="textarea" :rows="7" />
                  </el-form-item>
                </div>
              </el-form>

              <div v-if="selectedCard.preflight_report" class="issues">
                <div v-for="issue in selectedCard.preflight_report.issues || []" :key="issue.code" :class="['issue', issue.level]">
                  <b>{{ issue.code }}</b>
                  <span>{{ issue.message }}</span>
                </div>
              </div>
            </div>

            <div class="preview-panel">
              <el-tabs v-model="previewTab">
                <el-tab-pane label="结果" name="result">
                  <video v-if="currentVideoUrl" :src="currentVideoUrl" controls />
                  <el-empty v-else description="暂无结果" />
                </el-tab-pane>
                <el-tab-pane label="结构源" name="structure">
                  <video v-if="structureVideoUrl" :src="structureVideoUrl" controls />
                  <el-empty v-else description="暂无结构视频" />
                </el-tab-pane>
                <el-tab-pane label="源视频" name="source">
                  <video v-if="sourceVideoUrl" :src="sourceVideoUrl" controls />
                  <el-empty v-else description="源视频不是可直接预览地址" />
                </el-tab-pane>
              </el-tabs>

              <div class="versions">
                <h4>结果版本</h4>
                <button v-for="r in selectedCard.results || []" :key="r.id" class="version-row" @click="previewResult = r">
                  <span>v{{ r.version }} · {{ statusText(r.status) }}</span>
                  <small>{{ r.created_at?.slice(0, 19).replace('T', ' ') }}</small>
                </button>
              </div>
            </div>
          </section>
        </template>
      </section>
    </main>

    <el-dialog v-model="jobDialog" title="新建转绘任务" width="520px">
      <el-form label-position="top">
        <el-form-item label="任务名"><el-input v-model="newJob.title" /></el-form-item>
        <el-form-item label="剧集 ID"><el-input-number v-model="newJob.drama_id" :min="0" /></el-form-item>
        <el-form-item label="分集 ID"><el-input-number v-model="newJob.episode_id" :min="0" /></el-form-item>
        <el-form-item label="整体目标"><el-input v-model="newJob.overall_goal" type="textarea" :rows="3" /></el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="jobDialog = false">取消</el-button>
        <el-button type="primary" @click="createJob">创建</el-button>
      </template>
    </el-dialog>

    <el-dialog v-model="cardDialog" title="添加镜头" width="560px">
      <el-form label-position="top">
        <el-form-item label="镜头标题"><el-input v-model="newCard.title" /></el-form-item>
        <el-form-item label="源视频"><el-input v-model="newCard.source_video_path" /></el-form-item>
        <el-form-item label="提示词"><el-input v-model="newCard.prompt" type="textarea" :rows="4" /></el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="cardDialog = false">取消</el-button>
        <el-button type="primary" @click="createCard">添加</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup>
import { computed, onMounted, reactive, ref } from 'vue'
import { ElMessage } from 'element-plus'
import {
  CircleCheck,
  Download,
  MagicStick,
  Plus,
  Refresh,
  RefreshRight,
  Tools,
  VideoCamera,
  VideoPlay
} from '@element-plus/icons-vue'
import { redrawAPI } from '@/api/redraw'

const jobs = ref([])
const selectedJob = ref(null)
const selectedCard = ref(null)
const previewResult = ref(null)
const previewTab = ref('result')
const loadingJob = ref(false)
const jobDialog = ref(false)
const cardDialog = ref(false)

const newJob = reactive({ title: '转绘任务', drama_id: null, episode_id: null, overall_goal: '', aspect_ratio: '9:16', resolution: '480p' })
const newCard = reactive({ title: '', source_video_path: '', prompt: '' })
const cardForm = reactive({})
const jsonText = reactive({ character_refs: '[]', scene_ref: 'null', prop_refs: '[]' })
const strengthOptions = [
  { label: '保结构', value: 'keep' },
  { label: '平衡', value: 'balanced' },
  { label: '强替换', value: 'replace' }
]

const currentVideoUrl = computed(() => mediaUrl(previewResult.value?.video_url || previewResult.value?.local_path || selectedCard.value?.current_result?.video_url || selectedCard.value?.current_result?.local_path))
const structureVideoUrl = computed(() => mediaUrl(selectedCard.value?.structure_video_path))
const sourceVideoUrl = computed(() => mediaUrl(selectedCard.value?.source_video_path))

function mediaUrl(value) {
  const raw = String(value || '').trim()
  if (!raw) return ''
  if (/^https?:\/\//i.test(raw) || raw.startsWith('/static/')) return raw
  if (/^[A-Za-z]:\\/.test(raw)) return ''
  return `/static/${raw.replace(/^[/\\]+/, '').replace(/\\/g, '/')}`
}

function statusText(status) {
  return {
    draft: '草稿',
    ready: '可提交',
    running: '生成中',
    processing: '生成中',
    completed: '完成',
    failed: '失败',
    partial: '部分完成'
  }[status] || status || '未知'
}

function statusTag(status) {
  if (status === 'completed') return 'success'
  if (status === 'failed') return 'danger'
  if (status === 'running' || status === 'processing') return 'warning'
  if (status === 'ready') return 'primary'
  return 'info'
}

function jobProgress(job) {
  const total = Number(job.stats?.total || 0)
  return total ? Math.round((Number(job.stats?.done || 0) / total) * 100) : 0
}

function hydrateCardForm(card) {
  Object.assign(cardForm, {
    title: card.title || '',
    source_video_path: card.source_video_path || '',
    structure_video_path: card.structure_video_path || '',
    structure_strength: card.structure_strength || 'balanced',
    duration: card.duration || null,
    prompt: card.prompt || '',
    negative_prompt: card.negative_prompt || ''
  })
  jsonText.character_refs = JSON.stringify(card.character_refs || [], null, 2)
  jsonText.scene_ref = JSON.stringify(card.scene_ref || null, null, 2)
  jsonText.prop_refs = JSON.stringify(card.prop_refs || [], null, 2)
  previewResult.value = card.current_result || card.results?.[0] || null
}

async function loadJobs() {
  jobs.value = await redrawAPI.listJobs()
}

async function selectJob(id) {
  loadingJob.value = true
  try {
    selectedJob.value = await redrawAPI.getJob(id)
    selectedCard.value = selectedJob.value.cards?.[0] || null
    if (selectedCard.value) hydrateCardForm(selectedCard.value)
  } finally {
    loadingJob.value = false
  }
}

function onCardSelect(card) {
  selectedCard.value = card
  if (card) hydrateCardForm(card)
}

async function refreshAll() {
  await loadJobs()
  if (selectedJob.value?.id) await selectJob(selectedJob.value.id)
}

async function createJob() {
  const job = await redrawAPI.createJob(newJob)
  jobDialog.value = false
  await loadJobs()
  await selectJob(job.id)
}

async function createCard() {
  if (!selectedJob.value) return
  await redrawAPI.createCard(selectedJob.value.id, newCard)
  Object.assign(newCard, { title: '', source_video_path: '', prompt: '' })
  cardDialog.value = false
  await refreshAll()
}

function parseEditorJson(text, fallback) {
  try {
    return JSON.parse(text)
  } catch (_) {
    return fallback
  }
}

async function saveCard() {
  if (!selectedCard.value) return
  await redrawAPI.updateCard(selectedCard.value.id, {
    ...cardForm,
    character_refs: parseEditorJson(jsonText.character_refs, []),
    scene_ref: parseEditorJson(jsonText.scene_ref, null),
    prop_refs: parseEditorJson(jsonText.prop_refs, [])
  })
  ElMessage.success('已保存')
  await refreshAll()
}

async function makeStructure() {
  if (!selectedCard.value) return
  await saveCard()
  await redrawAPI.generateStructure(selectedCard.value.id, cardForm.structure_strength)
  ElMessage.success('结构视频已生成')
  await refreshAll()
}

async function preflightCard() {
  if (!selectedCard.value) return
  await saveCard()
  const report = await redrawAPI.preflightCard(selectedCard.value.id)
  ElMessage[report.ok ? 'success' : 'warning'](report.ok ? '预检通过' : '预检发现阻断项')
  await refreshAll()
}

async function submitCard() {
  if (!selectedCard.value) return
  await saveCard()
  await redrawAPI.submitCard(selectedCard.value.id)
  ElMessage.success('已提交生成')
  await refreshAll()
}

async function submitReadyJob() {
  if (!selectedJob.value) return
  const res = await redrawAPI.submitJob(selectedJob.value.id)
  ElMessage.success(`已提交 ${res.submitted} 个镜头`)
  await refreshAll()
}

async function importEpisodeCards() {
  if (!selectedJob.value) return
  const rows = await redrawAPI.importEpisodeCards(selectedJob.value.id)
  ElMessage.success(`已导入 ${rows.length} 个镜头`)
  await refreshAll()
}

async function reconcileJob() {
  if (!selectedJob.value) return
  await redrawAPI.reconcileJob(selectedJob.value.id)
  ElMessage.success('状态已同步')
  await refreshAll()
}

async function repairJob() {
  if (!selectedJob.value) return
  const res = await redrawAPI.repairJob(selectedJob.value.id)
  ElMessage.success(`已修复 ${res.repaired?.length || 0} 个结果指针`)
  await refreshAll()
}

onMounted(async () => {
  await loadJobs()
  if (jobs.value[0]) await selectJob(jobs.value[0].id)
})
</script>

<style scoped>
.redraw-page {
  min-height: 100vh;
  background: #f6f7f9;
  color: #111827;
  padding: 20px;
}

.topbar,
.workspace,
.job-header,
.panel-head,
.top-actions,
.job-actions,
.form-row,
.json-row {
  display: flex;
  gap: 12px;
}

.topbar {
  align-items: center;
  justify-content: space-between;
  margin-bottom: 16px;
}

.topbar h1,
.job-header h2,
.panel-head h3 {
  margin: 0;
  letter-spacing: 0;
}

.topbar p,
.job-header p {
  margin: 6px 0 0;
  color: #667085;
}

.workspace {
  align-items: stretch;
}

.job-pane,
.main-pane,
.editor-panel,
.preview-panel {
  background: #fff;
  border: 1px solid #e5e7eb;
  border-radius: 8px;
}

.job-pane {
  width: 292px;
  padding: 14px;
  flex-shrink: 0;
}

.pane-title {
  display: flex;
  justify-content: space-between;
  margin-bottom: 10px;
  font-weight: 700;
}

.job-list {
  height: calc(100vh - 150px);
}

.job-item,
.version-row {
  width: 100%;
  border: 0;
  background: transparent;
  text-align: left;
  padding: 10px;
  border-radius: 8px;
  cursor: pointer;
}

.job-item {
  display: grid;
  gap: 7px;
  border: 1px solid transparent;
}

.job-item span,
.shot-name span,
.muted,
.version-row small {
  color: #667085;
}

.job-item.active {
  background: #eef4ff;
  border-color: #84adff;
}

.main-pane {
  flex: 1;
  min-width: 0;
  padding: 16px;
}

.job-header,
.panel-head {
  align-items: center;
  justify-content: space-between;
}

.stats-strip {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 10px;
  margin: 14px 0;
}

.stats-strip div {
  background: #f8fafc;
  border: 1px solid #e5e7eb;
  border-radius: 8px;
  padding: 12px;
}

.stats-strip b {
  display: block;
  font-size: 24px;
}

.stats-strip span {
  color: #667085;
}

.detail-grid {
  display: grid;
  grid-template-columns: minmax(0, 1.4fr) minmax(360px, 0.8fr);
  gap: 14px;
  margin-top: 14px;
}

.editor-panel,
.preview-panel {
  padding: 14px;
}

.form-row > *,
.json-row > * {
  flex: 1;
}

.json-row {
  align-items: stretch;
}

.preview-panel video {
  width: 100%;
  max-height: 420px;
  background: #0f172a;
  border-radius: 8px;
}

.versions {
  margin-top: 12px;
}

.version-row {
  display: flex;
  justify-content: space-between;
  border: 1px solid #e5e7eb;
  margin-bottom: 6px;
}

.issue {
  display: flex;
  gap: 8px;
  padding: 8px 10px;
  border-radius: 8px;
  margin-top: 6px;
}

.issue.error {
  background: #fef2f2;
  color: #991b1b;
}

.issue.warning {
  background: #fffbeb;
  color: #92400e;
}

.ok {
  color: #16a34a;
}

.empty-state {
  min-height: 520px;
  display: grid;
  place-items: center;
}

@media (max-width: 1180px) {
  .workspace,
  .detail-grid {
    display: block;
  }

  .job-pane {
    width: auto;
    margin-bottom: 12px;
  }

  .job-list {
    height: 220px;
  }

  .preview-panel {
    margin-top: 12px;
  }
}
</style>
