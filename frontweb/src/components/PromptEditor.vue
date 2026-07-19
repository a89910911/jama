<template>
  <div class="prompt-editor">
    <el-alert
      :title="isProjectMode ? '项目提示词优先于系统提示词；删除项目覆盖后会自动恢复使用系统提示词。' : '这里展示系统内全部提示词，包括图片、视频、负向提示词和技术模板。'"
      type="info"
      :closable="false"
      show-icon
      class="intro-alert"
    />

    <div class="toolbar">
      <el-input
        v-model="filters.keyword"
        clearable
        placeholder="搜索名称、key、分类或业务场景"
        class="search-input"
      />
      <el-select v-model="filters.category" clearable placeholder="全部分类">
        <el-option v-for="value in categoryOptions" :key="value" :label="value" :value="value" />
      </el-select>
      <el-select v-model="filters.sceneKey" clearable placeholder="全部业务场景">
        <el-option v-for="value in sceneOptions" :key="value" :label="value" :value="value" />
      </el-select>
      <el-select v-model="filters.role" clearable placeholder="全部类型">
        <el-option v-for="value in roleOptions" :key="value" :label="roleLabel(value)" :value="value" />
      </el-select>
      <el-select v-model="filters.locale" clearable placeholder="全部语言">
        <el-option label="中文" value="zh" />
        <el-option label="English" value="en" />
        <el-option label="通用" value="universal" />
      </el-select>
      <el-button :loading="loading" @click="refresh">刷新</el-button>
    </div>

    <div v-loading="loading" class="editor-layout">
      <aside class="prompt-list">
        <div class="list-summary">共 {{ filteredPrompts.length }} 条（{{ definitionCount }} 个提示词定义）</div>
        <button
          v-for="item in filteredPrompts"
          :key="rowKey(item)"
          type="button"
          :class="['prompt-list-item', { active: currentRowKey === rowKey(item) }]"
          @click="selectPrompt(item)"
        >
          <span class="item-title">{{ item.name }}</span>
          <span class="item-key">{{ item.prompt_key }} · {{ localeLabel(item.locale) }}</span>
          <span class="item-tags">
            <el-tag size="small" effect="plain">{{ item.category }}</el-tag>
            <el-tag
              v-if="isProjectMode"
              :type="item.effective_source === 'project' ? 'warning' : 'info'"
              size="small"
            >
              {{ item.effective_source === 'project' ? '项目覆盖' : '继承系统' }}
            </el-tag>
            <el-tag v-else :type="item.system_content === item.seed_content ? 'info' : 'warning'" size="small">
              {{ item.system_content === item.seed_content ? '出厂默认' : '已修改' }}
            </el-tag>
          </span>
          <i v-if="dirtyRows[rowKey(item)]" class="dirty-dot" />
        </button>
        <el-empty v-if="!filteredPrompts.length && !loading" description="没有匹配的提示词" :image-size="70" />
      </aside>

      <main v-if="currentPrompt" class="editor-panel">
        <header class="editor-header">
          <div>
            <h3>{{ currentPrompt.name }}</h3>
            <code>{{ currentPrompt.prompt_key }}</code>
          </div>
          <div class="header-tags">
            <el-tag>{{ localeLabel(currentPrompt.locale) }}</el-tag>
            <el-tag effect="plain">{{ roleLabel(currentPrompt.message_role) }}</el-tag>
            <el-tag v-if="currentPrompt.scene_key" effect="plain">{{ currentPrompt.scene_key }}</el-tag>
            <el-tag v-if="isHighRisk" type="danger">高风险</el-tag>
          </div>
        </header>

        <el-alert
          v-if="isHighRisk"
          title="高风险配置，非专业人员请勿编辑。修改 JSON 协议、变量、负向词或技术模板可能导致生成失败。"
          type="error"
          :closable="false"
          show-icon
          class="risk-alert"
        />

        <div class="meta-grid">
          <div><span>分类</span>{{ currentPrompt.category }}</div>
          <div><span>业务场景</span>{{ currentPrompt.scene_key || '无专用路由' }}</div>
          <div>
            <span>当前来源</span>
            {{ isProjectMode ? (currentPrompt.effective_source === 'project' ? '项目覆盖' : '系统继承') : '系统' }}
          </div>
          <div><span>版本</span>{{ activeVersion }}</div>
        </div>

        <section v-if="variables.length" class="variable-section">
          <div class="section-title">可用模板变量</div>
          <div class="variable-list">
            <el-tag v-for="variable in variables" :key="variable.name" effect="plain">
              {{ formatVariable(variable.name) }}{{ variable.required ? '（必填）' : '' }}
            </el-tag>
          </div>
        </section>

        <div v-if="isHighRisk && !riskUnlocked[rowKey(currentPrompt)]" class="unlock-box">
          <p>请确认你理解修改风险后再进入编辑。所有内容均可编辑，但必填模板变量不能删除。</p>
          <el-button type="danger" plain @click="unlockRisk">确认风险并进入编辑</el-button>
        </div>

        <el-input
          v-else
          v-model="editContent"
          type="textarea"
          :rows="20"
          resize="vertical"
          class="prompt-textarea"
          @input="markDirty"
        />

        <div class="actions">
          <el-button @click="preview">预览最终内容</el-button>
          <el-button
            :disabled="isProjectMode ? currentPrompt.effective_source !== 'project' : currentPrompt.system_content === currentPrompt.seed_content"
            :loading="resetting"
            @click="resetPrompt"
          >
            {{ isProjectMode ? '恢复继承系统' : '恢复出厂默认' }}
          </el-button>
          <el-button
            type="primary"
            :disabled="!dirtyRows[rowKey(currentPrompt)] || (isHighRisk && !riskUnlocked[rowKey(currentPrompt)])"
            :loading="saving"
            @click="savePrompt"
          >
            {{ isProjectMode ? '保存项目覆盖' : '保存系统提示词' }}
          </el-button>
        </div>
      </main>
      <el-empty v-else description="请选择提示词" class="editor-panel" />
    </div>

    <el-dialog v-model="previewVisible" title="最终提示词预览" width="70%">
      <div class="preview-meta">
        来源：{{ previewData.scope || '-' }} · 语言：{{ localeLabel(previewData.locale) }} · 版本：{{ previewData.version || '-' }}
      </div>
      <pre class="preview-content">{{ previewData.content }}</pre>
    </el-dialog>
  </div>
</template>

<script setup>
import { computed, onMounted, reactive, ref, watch } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { promptsAPI } from '@/api/prompts'
import {
  effectivePromptContent,
  filterPromptItems,
  promptRowKey,
} from '@/utils/promptTemplateUi'

const props = defineProps({
  dramaId: { type: [Number, String], default: null },
})

const loading = ref(false)
const saving = ref(false)
const resetting = ref(false)
const prompts = ref([])
const currentRowKey = ref('')
const editContent = ref('')
const dirtyRows = reactive({})
const riskUnlocked = reactive({})
const previewVisible = ref(false)
const previewData = ref({})
const filters = reactive({
  keyword: '',
  category: '',
  sceneKey: '',
  role: '',
  locale: '',
})

const isProjectMode = computed(() => props.dramaId !== null && props.dramaId !== undefined && props.dramaId !== '')
const rowKey = promptRowKey
const currentPrompt = computed(() => prompts.value.find((item) => rowKey(item) === currentRowKey.value) || null)
const isHighRisk = computed(() => currentPrompt.value?.risk_level === 'high')
const variables = computed(() => currentPrompt.value?.variable_schema?.variables || [])
const activeVersion = computed(() => {
  if (!currentPrompt.value) return '-'
  if (isProjectMode.value && currentPrompt.value.project_version != null) return currentPrompt.value.project_version
  return currentPrompt.value.system_version
})
const categoryOptions = computed(() => [...new Set(prompts.value.map((item) => item.category).filter(Boolean))])
const sceneOptions = computed(() => [...new Set(prompts.value.map((item) => item.scene_key).filter(Boolean))])
const roleOptions = computed(() => [...new Set(prompts.value.map((item) => item.message_role).filter(Boolean))])
const definitionCount = computed(() => new Set(filteredPrompts.value.map((item) => item.prompt_key)).size)
const filteredPrompts = computed(() => {
  return filterPromptItems(prompts.value, filters)
})

function localeLabel(locale) {
  return { zh: '中文', en: 'English', universal: '通用' }[locale] || locale || '-'
}

function roleLabel(role) {
  return {
    system: '系统提示词',
    user_template: '用户模板',
    format_contract: '格式协议',
    image_prompt: '图片模板',
    video_prompt: '视频模板',
    negative_prompt: '负向提示词',
    suffix: '技术补充',
  }[role] || role || '-'
}

function formatVariable(name) {
  return `{{${name}}}`
}

function sourceContent(item) {
  return effectivePromptContent(item, isProjectMode.value)
}

async function confirmDiscardDirty(message = '当前提示词有未保存修改，继续后将丢失，确认继续？') {
  const key = currentRowKey.value
  if (!key || !dirtyRows[key]) return true
  try {
    await ElMessageBox.confirm(message, '未保存修改', {
      type: 'warning',
      confirmButtonText: '放弃修改',
      cancelButtonText: '继续编辑',
    })
    delete dirtyRows[key]
    return true
  } catch {
    return false
  }
}

async function selectPrompt(item, { force = false } = {}) {
  const targetKey = rowKey(item)
  if (!force && targetKey !== currentRowKey.value && !(await confirmDiscardDirty())) return
  currentRowKey.value = rowKey(item)
  editContent.value = sourceContent(item) || ''
}

async function load() {
  loading.value = true
  try {
    const data = isProjectMode.value
      ? await promptsAPI.listProject(props.dramaId)
      : await promptsAPI.list()
    prompts.value = data.prompts || []
    Object.keys(dirtyRows).forEach((key) => delete dirtyRows[key])
    const selected = prompts.value.find((item) => rowKey(item) === currentRowKey.value)
      || filteredPrompts.value[0]
      || prompts.value[0]
    if (selected) await selectPrompt(selected, { force: true })
  } finally {
    loading.value = false
  }
}

async function refresh() {
  if (!(await confirmDiscardDirty('当前提示词有未保存修改，刷新后将丢失，确认刷新？'))) return
  await load()
}

function markDirty() {
  if (!currentPrompt.value) return
  dirtyRows[rowKey(currentPrompt.value)] = editContent.value !== (sourceContent(currentPrompt.value) || '')
}

async function unlockRisk() {
  await ElMessageBox.confirm(
    '该提示词属于高风险技术配置。错误修改可能导致 JSON 解析失败、图片/视频生成异常。确认继续编辑？',
    '高风险提示',
    { type: 'warning', confirmButtonText: '确认并编辑' }
  )
  riskUnlocked[rowKey(currentPrompt.value)] = true
}

async function savePrompt() {
  const item = currentPrompt.value
  if (!item || !editContent.value.trim()) {
    ElMessage.warning('提示词内容不能为空')
    return
  }
  if (isHighRisk.value) {
    await ElMessageBox.confirm('确认保存这项高风险提示词修改？', '二次确认', { type: 'warning' })
  }
  saving.value = true
  try {
    if (isProjectMode.value) {
      await promptsAPI.updateProject(props.dramaId, item.prompt_key, {
        locale: item.locale,
        content: editContent.value,
        version: item.project_version,
      })
    } else {
      await promptsAPI.update(item.prompt_key, {
        locale: item.locale,
        content: editContent.value,
        version: item.system_version,
      })
    }
    ElMessage.success(isProjectMode.value ? '项目提示词已保存' : '系统提示词已保存')
    await load()
  } finally {
    saving.value = false
  }
}

async function resetPrompt() {
  const item = currentPrompt.value
  if (!item) return
  const label = isProjectMode.value ? '删除项目覆盖并恢复继承系统提示词' : '恢复为出厂默认内容'
  await ElMessageBox.confirm(`确认${label}？`, '恢复提示词', { type: 'warning' })
  resetting.value = true
  try {
    if (isProjectMode.value) {
      await promptsAPI.deleteProject(props.dramaId, item.prompt_key, {
        locale: item.locale,
        version: item.project_version,
      })
    } else {
      await promptsAPI.reset(item.prompt_key, {
        locale: item.locale,
        version: item.system_version,
      })
    }
    ElMessage.success('已恢复')
    await load()
  } finally {
    resetting.value = false
  }
}

async function preview() {
  const item = currentPrompt.value
  if (!item) return
  const sampleVariables = Object.fromEntries(variables.value.map((variable) => [variable.name, variable.example || `[${variable.name}]`]))
  previewData.value = isProjectMode.value
    ? await promptsAPI.previewProject(props.dramaId, item.prompt_key, {
        locale: item.locale,
        variables: sampleVariables,
        content: editContent.value,
      })
    : await promptsAPI.preview(item.prompt_key, {
        locale: item.locale,
        variables: sampleVariables,
        content: editContent.value,
      })
  previewVisible.value = true
}

watch(() => props.dramaId, load)
onMounted(load)
</script>

<style scoped>
.prompt-editor { height: 100%; min-height: 620px; }
.intro-alert { margin-bottom: 14px; }
.toolbar { display: flex; gap: 10px; flex-wrap: wrap; margin-bottom: 14px; }
.toolbar .el-select { width: 150px; }
.search-input { width: 280px; }
.editor-layout { display: grid; grid-template-columns: 320px minmax(0, 1fr); min-height: 570px; border: 1px solid var(--el-border-color); border-radius: 10px; overflow: hidden; }
.prompt-list { max-height: 70vh; overflow: auto; border-right: 1px solid var(--el-border-color); background: var(--el-fill-color-lighter); }
.list-summary { position: sticky; top: 0; z-index: 1; padding: 10px 14px; color: var(--el-text-color-secondary); font-size: 12px; background: var(--el-bg-color); border-bottom: 1px solid var(--el-border-color); }
.prompt-list-item { position: relative; display: flex; width: 100%; flex-direction: column; gap: 5px; padding: 12px 14px; text-align: left; color: inherit; background: transparent; border: 0; border-bottom: 1px solid var(--el-border-color-lighter); cursor: pointer; }
.prompt-list-item:hover, .prompt-list-item.active { background: var(--el-color-primary-light-9); }
.prompt-list-item.active { box-shadow: inset 3px 0 var(--el-color-primary); }
.item-title { font-size: 14px; font-weight: 600; }
.item-key { color: var(--el-text-color-secondary); font: 11px/1.4 Consolas, monospace; overflow-wrap: anywhere; }
.item-tags { display: flex; flex-wrap: wrap; gap: 5px; }
.dirty-dot { position: absolute; top: 12px; right: 10px; width: 7px; height: 7px; border-radius: 50%; background: var(--el-color-warning); }
.editor-panel { min-width: 0; padding: 20px; overflow: auto; }
.editor-header { display: flex; align-items: flex-start; justify-content: space-between; gap: 18px; margin-bottom: 14px; }
.editor-header h3 { margin: 0 0 5px; font-size: 18px; }
.editor-header code { color: var(--el-text-color-secondary); font-size: 12px; }
.header-tags { display: flex; flex-wrap: wrap; justify-content: flex-end; gap: 6px; }
.risk-alert { margin-bottom: 14px; }
.meta-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 8px 20px; margin-bottom: 16px; font-size: 13px; }
.meta-grid span { display: inline-block; width: 76px; color: var(--el-text-color-secondary); }
.section-title { margin-bottom: 8px; color: var(--el-text-color-secondary); font-size: 12px; }
.variable-section { margin-bottom: 14px; }
.variable-list { display: flex; flex-wrap: wrap; gap: 6px; }
.unlock-box { padding: 24px; text-align: center; background: var(--el-color-danger-light-9); border: 1px dashed var(--el-color-danger-light-5); border-radius: 8px; }
.unlock-box p { margin: 0 0 14px; color: var(--el-text-color-regular); }
.prompt-textarea :deep(textarea) { font: 12.5px/1.65 Consolas, Monaco, monospace; }
.actions { display: flex; justify-content: flex-end; gap: 8px; margin-top: 14px; }
.preview-meta { margin-bottom: 10px; color: var(--el-text-color-secondary); font-size: 12px; }
.preview-content { max-height: 60vh; margin: 0; padding: 14px; overflow: auto; white-space: pre-wrap; overflow-wrap: anywhere; background: var(--el-fill-color-lighter); border-radius: 8px; font: 12px/1.6 Consolas, monospace; }
@media (max-width: 900px) {
  .editor-layout { grid-template-columns: 1fr; }
  .prompt-list { max-height: 280px; border-right: 0; border-bottom: 1px solid var(--el-border-color); }
  .editor-header { flex-direction: column; }
}
</style>
