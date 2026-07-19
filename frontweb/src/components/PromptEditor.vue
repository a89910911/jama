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
      <el-select v-model="filters.category" clearable placeholder="全部一级分类">
        <el-option v-for="value in categoryOptions" :key="value" :label="value" :value="value" />
      </el-select>
      <el-select v-model="filters.subcategory" clearable placeholder="全部二级分类">
        <el-option v-for="value in subcategoryOptions" :key="value" :label="value" :value="value" />
      </el-select>
      <el-select
        v-if="detailCategoryOptions.length"
        v-model="filters.detailCategory"
        clearable
        placeholder="全部三级分类"
      >
        <el-option v-for="value in detailCategoryOptions" :key="value" :label="value" :value="value" />
      </el-select>
      <el-select v-model="filters.sceneKey" clearable filterable placeholder="全部业务场景">
        <el-option
          v-for="item in sceneOptions"
          :key="item.value"
          :label="item.label"
          :value="item.value"
        />
      </el-select>
      <el-select v-model="filters.templateKind" clearable placeholder="全部模板类型">
        <el-option
          v-for="value in templateKindOptions"
          :key="value"
          :label="templateKindLabel(value)"
          :value="value"
        />
      </el-select>
      <el-button :loading="loading" @click="refresh">刷新</el-button>
    </div>

    <div v-loading="loading" class="editor-layout">
      <div class="prompt-list-column">
        <aside class="prompt-list">
          <div class="list-summary">
            共 {{ filteredPrompts.length }} 条（{{ mainCount }} 个主模板，{{ conditionalChildCount }} 个条件子模板，其中 {{ fallbackCount }} 个回退，{{ independentTechnicalCount }} 个独立技术模板）
          </div>
          <section v-for="category in promptSections" :key="category.key" class="category-section">
            <header class="category-section-header">
              <span class="category-section-number">{{ String(category.order).padStart(2, '0') }}</span>
              <span class="category-section-title">{{ category.label }}</span>
            </header>

            <div
              v-for="subcategory in category.subcategories"
              :key="subcategory.key"
              class="prompt-subcategory"
            >
              <div class="prompt-subcategory-title">
                <span>{{ subcategory.label }}</span>
                <span>{{ subcategoryTemplateCount(subcategory) }} 条</span>
              </div>

              <div
                v-for="detail in subcategory.details"
                :key="detail.key"
                class="prompt-detail-category"
              >
                <div v-if="detail.label" class="prompt-detail-category-title">
                  <span>{{ detail.label }}</span>
                  <span>{{ groupTemplateCount(detail.groups) }} 条</span>
                </div>

                <div v-for="group in detail.groups" :key="group.key" class="prompt-group">
                  <button
                    type="button"
                    :class="['business-bundle-toggle', { active: isBundleActive(group) }]"
                    @click="toggleGroup(group.key)"
                  >
                    <span>{{ isGroupExpanded(group) ? '▾' : '▸' }}</span>
                    <span class="bundle-heading">
                      <strong>{{ group.label }}</strong>
                      <code>{{ group.scene_key }}</code>
                    </span>
                    <span class="bundle-count">{{ group.items.length }} 部分</span>
                  </button>
                  <div v-show="isGroupExpanded(group)" class="bundle-component-list">
                    <button
                      v-for="item in group.items"
                      :key="rowKey(item)"
                      type="button"
                      :class="['prompt-list-item', 'bundle-component-item', { active: currentRowKey === rowKey(item) }]"
                      @click="selectPrompt(item)"
                    >
                      <span class="component-slot">{{ item.business_slot_label }}</span>
                      <span class="item-title">{{ item.name }}</span>
                      <span class="item-key">{{ item.prompt_key }}</span>
                      <span class="item-tags">
                        <el-tag size="small" :type="templateTypeTagType(item)" effect="plain">
                          {{ templateTypeLabel(item) }}
                        </el-tag>
                        <el-tag size="small" effect="plain">{{ item.injection_channel }}</el-tag>
                        <el-tag
                          v-if="isProjectMode"
                          :type="item.effective_source === 'project' ? 'warning' : 'info'"
                          size="small"
                        >
                          {{ item.effective_source === 'project' ? '项目覆盖' : '继承系统' }}
                        </el-tag>
                        <el-tag
                          v-else
                          :type="item.system_content === item.seed_content ? 'info' : 'warning'"
                          size="small"
                        >
                          {{ item.system_content === item.seed_content ? '出厂默认' : '已修改' }}
                        </el-tag>
                      </span>
                      <i v-if="dirtyRows[rowKey(item)]" class="dirty-dot" />
                    </button>
                  </div>
                </div>
              </div>
            </div>
          </section>
          <el-empty v-if="!filteredPrompts.length && !loading" description="没有匹配的提示词" :image-size="70" />
        </aside>
      </div>

      <main v-if="currentPrompt" class="editor-panel">
        <header class="editor-header">
          <div>
            <h3>{{ currentPrompt.name }}</h3>
            <code>{{ currentPrompt.prompt_key }}</code>
          </div>
          <div class="header-tags">
            <el-tag :type="templateTypeTagType(currentPrompt)" effect="plain">
              {{ templateTypeLabel(currentPrompt) }}
            </el-tag>
            <el-tag effect="plain">{{ roleLabel(currentPrompt.message_role) }}</el-tag>
            <el-tag v-if="currentPrompt.scene_key" effect="plain">
              {{ currentPrompt.business_scene_label || currentPrompt.scene_key }}
            </el-tag>
            <el-tag v-if="isHighRisk" type="danger">高风险</el-tag>
          </div>
        </header>

        <el-alert
          title="高风险配置，非专业人员请勿编辑。修改 JSON 协议、变量、负向词或技术模板可能导致生成失败。"
          type="error"
          :closable="false"
          show-icon
          class="risk-alert"
        />

        <div class="business-scene-strip">
          <div>
            <span class="business-scene-caption">业务场景</span>
            <strong>{{ currentPrompt.business_scene_label || currentPrompt.scene_key }}</strong>
            <code>{{ currentPrompt.scene_key }}</code>
          </div>
          <div class="business-scene-model">
            <span>{{ currentPrompt.business_scene_config_name || '暂无可用 AI 配置' }}</span>
            <code>{{ currentPrompt.business_scene_model || '未选择模型' }}</code>
            <el-tag
              :type="currentPrompt.business_scene_mapping_source === 'scene' ? 'warning' : 'info'"
              size="small"
            >
              {{ currentPrompt.business_scene_mapping_source === 'scene' ? '场景指定' : '继承默认' }}
            </el-tag>
          </div>
          <el-button v-if="authState.user?.is_super_admin" size="small" @click="goSceneSettings">配置场景模型</el-button>
        </div>

        <div class="meta-grid">
          <div><span>一级分类</span>{{ currentPrompt.category }}</div>
          <div><span>二级分类</span>{{ currentPrompt.subcategory || '未分类' }}</div>
          <div v-if="currentPrompt.detail_category">
            <span>三级分类</span>{{ currentPrompt.detail_category }}
          </div>
          <div>
            <span>制作顺序</span>{{ String(currentPrompt.workflow_order || 0).padStart(2, '0') }}
          </div>
          <div><span>场景组件</span>{{ currentPrompt.business_slot_label || '模板组件' }}</div>
          <div><span>模板类型</span>{{ templateTypeLabel(currentPrompt) }}</div>
          <div><span>AI 消息角色</span>{{ roleLabel(currentPrompt.message_role) }}</div>
          <div><span>内容用途</span>{{ contentTypeLabel(currentPrompt.content_type) }}</div>
          <div>
            <span>当前来源</span>
            {{ isProjectMode ? (currentPrompt.effective_source === 'project' ? '项目覆盖' : '系统继承') : '系统' }}
          </div>
          <div><span>版本</span>{{ activeVersion }}</div>
          <div><span>注入位置</span>{{ currentPrompt.injection_channel || roleLabel(currentPrompt.message_role) }}</div>
          <div><span>组合关系</span>{{ relationshipLabel }}</div>
        </div>

        <el-alert
          v-if="currentPrompt.relation_note"
          :title="currentPrompt.relation_note"
          type="warning"
          :closable="false"
          class="relation-alert"
        />

        <section v-if="variables.length" class="variable-section">
          <div class="section-title">可用模板变量</div>
          <div class="variable-list">
            <el-tag v-for="variable in variables" :key="variable.name" effect="plain">
              {{ formatVariable(variable.name) }}{{ variable.required ? '（必填）' : '' }}
            </el-tag>
          </div>
        </section>

        <el-input
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
            :disabled="!dirtyRows[rowKey(currentPrompt)]"
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
        来源：{{ previewData.scope || '-' }} · 版本：{{ previewData.version || '-' }}
      </div>
      <pre class="preview-content">{{ previewData.content }}</pre>
    </el-dialog>
  </div>
</template>

<script setup>
import { computed, onMounted, reactive, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { ElMessage, ElMessageBox } from 'element-plus'
import { promptsAPI } from '@/api/prompts'
import { authState } from '@/stores/auth'
import {
  effectivePromptContent,
  filterPromptItems,
  groupPromptItems,
  groupPromptSections,
  promptBundleKey,
  promptRowKey,
} from '@/utils/promptTemplateUi'

const props = defineProps({
  dramaId: { type: [Number, String], default: null },
})

const route = useRoute()
const router = useRouter()
const loading = ref(false)
const saving = ref(false)
const resetting = ref(false)
const prompts = ref([])
const currentRowKey = ref('')
const editContent = ref('')
const dirtyRows = reactive({})
const expandedGroups = reactive({})
const previewVisible = ref(false)
const previewData = ref({})
const filters = reactive({
  keyword: '',
  category: '',
  subcategory: '',
  detailCategory: '',
  sceneKey: '',
  templateKind: '',
})

const isProjectMode = computed(() => props.dramaId !== null && props.dramaId !== undefined && props.dramaId !== '')
const rowKey = promptRowKey
const currentPrompt = computed(() => prompts.value.find((item) => rowKey(item) === currentRowKey.value) || null)
const parentPrompt = computed(() => {
  if (!currentPrompt.value?.parent_prompt_key) return null
  return prompts.value.find((item) => item.prompt_key === currentPrompt.value.parent_prompt_key) || null
})
const isHighRisk = computed(() => currentPrompt.value?.risk_level === 'high')
const variables = computed(() => currentPrompt.value?.variable_schema?.variables || [])
const activeVersion = computed(() => {
  if (!currentPrompt.value) return '-'
  if (isProjectMode.value && currentPrompt.value.project_version != null) return currentPrompt.value.project_version
  return currentPrompt.value.system_version
})
const categoryOptions = computed(() => [...new Set(prompts.value.map((item) => item.category).filter(Boolean))])
const subcategoryOptions = computed(() => {
  const scoped = filters.category
    ? prompts.value.filter((item) => item.category === filters.category)
    : prompts.value
  return [...new Set(scoped.map((item) => item.subcategory).filter(Boolean))]
})
const detailCategoryOptions = computed(() => {
  const scoped = prompts.value.filter((item) => {
    if (filters.category && item.category !== filters.category) return false
    if (filters.subcategory && item.subcategory !== filters.subcategory) return false
    return true
  })
  return [...new Set(scoped.map((item) => item.detail_category).filter(Boolean))]
})
const sceneOptions = computed(() => {
  const byKey = new Map()
  for (const item of prompts.value) {
    if (!item.scene_key || byKey.has(item.scene_key)) continue
    byKey.set(item.scene_key, {
      value: item.scene_key,
      label: `${item.business_scene_label || item.scene_key} (${item.scene_key})`,
      order: Number(item.business_scene_order || 0),
    })
  }
  return [...byKey.values()].sort((a, b) => a.order - b.order)
})
const templateKindOptions = computed(() => {
  const available = new Set(prompts.value.map((item) => item.template_kind).filter(Boolean))
  return ['main', 'conditional_child', 'independent_technical']
    .filter((value) => available.has(value))
})
const filteredPrompts = computed(() => {
  return filterPromptItems(prompts.value, filters)
})
const promptGroups = computed(() => groupPromptItems(filteredPrompts.value, prompts.value))
const promptSections = computed(() => groupPromptSections(promptGroups.value))
const kindCount = (kind) => filteredPrompts.value.filter((item) => item.template_kind === kind).length
const mainCount = computed(() => kindCount('main'))
const conditionalChildCount = computed(() => kindCount('conditional_child'))
const independentTechnicalCount = computed(() => kindCount('independent_technical'))
const fallbackCount = computed(() => filteredPrompts.value.filter((item) => item.template_subtype === 'fallback').length)
const filtersActive = computed(() => Object.values(filters).some((value) => String(value || '').trim()))
const relationshipLabel = computed(() => {
  if (parentPrompt.value) return `由“${parentPrompt.value.name}”管理`
  if (currentPrompt.value?.template_kind === 'independent_technical') return '独立使用，不依赖主模板'
  if (currentPrompt.value?.template_subtype === 'fallback') return '特殊条件子模板；满足回退条件时使用'
  return '无上级主模板'
})

function roleLabel(role) {
  return ['system', 'user', 'assistant'].includes(role) ? role : '-'
}

function contentTypeLabel(type) {
  return {
    system: '系统规则',
    user_template: '用户输入模板',
    format_contract: '格式协议',
    image_prompt: '图片正向提示词',
    video_prompt: '视频正向提示词',
    negative_prompt: '负向提示词',
    suffix: '技术补充',
  }[type] || type || '-'
}

function templateKindLabel(kind) {
  return {
    main: '主模板',
    conditional_child: '条件子模板',
    independent_technical: '独立技术模板',
  }[kind] || kind || '主模板'
}

function templateTypeLabel(item) {
  if (item?.template_subtype === 'fallback') return '条件子模板（回退）'
  return templateKindLabel(item?.template_kind)
}

function templateTypeTagType(item) {
  if (item?.template_subtype === 'fallback') return 'danger'
  return {
    main: 'primary',
    conditional_child: 'warning',
    independent_technical: 'success',
  }[item?.template_kind] || 'info'
}

function formatVariable(name) {
  return `{{${name}}}`
}

function groupTemplateCount(groups) {
  return (groups || []).reduce((count, group) => {
    return count + (group.items?.length || 0)
  }, 0)
}

function subcategoryTemplateCount(subcategory) {
  return (subcategory?.details || [])
    .reduce((count, detail) => count + groupTemplateCount(detail.groups), 0)
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
  expandedGroups[promptBundleKey(item, prompts.value)] = true
  editContent.value = sourceContent(item) || ''
}

function toggleGroup(key) {
  expandedGroups[key] = !expandedGroups[key]
}

function isGroupExpanded(group) {
  if (filtersActive.value) return true
  if (expandedGroups[group.key]) return true
  return group.items.some((item) => rowKey(item) === currentRowKey.value)
}

function isBundleActive(group) {
  return group.items.some((item) => rowKey(item) === currentRowKey.value)
}

function applySceneQueryFilter() {
  const sceneKey = String(route.query.scene_key || '')
  if (sceneKey && prompts.value.some((item) => item.scene_key === sceneKey)) {
    filters.sceneKey = sceneKey
  }
}

async function load() {
  loading.value = true
  try {
    const data = isProjectMode.value
      ? await promptsAPI.listProject(props.dramaId)
      : await promptsAPI.list()
    prompts.value = data.prompts || []
    applySceneQueryFilter()
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

async function savePrompt() {
  const item = currentPrompt.value
  if (!item || !editContent.value.trim()) {
    ElMessage.warning('提示词内容不能为空')
    return
  }
  saving.value = true
  try {
    if (isProjectMode.value) {
      await promptsAPI.updateProject(props.dramaId, item.prompt_key, {
        content: editContent.value,
        version: item.project_version,
      })
    } else {
      await promptsAPI.update(item.prompt_key, {
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
        version: item.project_version,
      })
    } else {
      await promptsAPI.reset(item.prompt_key, {
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
        variables: sampleVariables,
        content: editContent.value,
      })
    : await promptsAPI.preview(item.prompt_key, {
        variables: sampleVariables,
        content: editContent.value,
      })
  previewVisible.value = true
}

function goSceneSettings() {
  if (!currentPrompt.value?.scene_key) return
  router.push({
    path: '/ai-config',
    query: {
      tab: 'sceneModelMap',
      scene_key: currentPrompt.value.scene_key,
      returnTo: route.fullPath,
    },
  })
}

watch(() => props.dramaId, load)
watch(() => route.query.scene_key, applySceneQueryFilter)
watch(() => filters.category, () => {
  if (filters.subcategory && !subcategoryOptions.value.includes(filters.subcategory)) {
    filters.subcategory = ''
  }
  if (filters.detailCategory && !detailCategoryOptions.value.includes(filters.detailCategory)) {
    filters.detailCategory = ''
  }
})
watch(() => filters.subcategory, () => {
  if (filters.detailCategory && !detailCategoryOptions.value.includes(filters.detailCategory)) {
    filters.detailCategory = ''
  }
})
onMounted(load)
</script>

<style scoped>
.prompt-editor { height: 100%; min-height: 620px; }
.intro-alert { margin-bottom: 14px; }
.toolbar { display: flex; gap: 10px; flex-wrap: wrap; margin-bottom: 14px; }
.toolbar .el-select { width: 170px; }
.search-input { width: 280px; }
.editor-layout { display: grid; grid-template-columns: 320px minmax(0, 1fr); min-height: 570px; border: 1px solid var(--el-border-color); border-radius: 10px; overflow: hidden; }
.prompt-list-column { position: relative; min-width: 0; }
.prompt-list { position: absolute; inset: 0; overflow-y: auto; border-right: 1px solid var(--el-border-color); background: var(--el-fill-color-lighter); }
.list-summary { position: sticky; top: 0; z-index: 1; padding: 10px 14px; color: var(--el-text-color-secondary); font-size: 12px; background: var(--el-bg-color); border-bottom: 1px solid var(--el-border-color); }
.category-section { border-bottom: 1px solid var(--el-border-color); }
.category-section-header { display: flex; align-items: center; gap: 8px; padding: 11px 12px; background: var(--el-fill-color); border-bottom: 1px solid var(--el-border-color); }
.category-section-number { display: inline-flex; width: 26px; height: 22px; align-items: center; justify-content: center; color: var(--el-color-primary); background: var(--el-color-primary-light-9); border-radius: 6px; font: 700 11px/1 Consolas, monospace; }
.category-section-title { flex: 1; font-size: 13px; font-weight: 700; }
.prompt-subcategory-title { display: flex; align-items: center; justify-content: space-between; gap: 8px; padding: 8px 14px; color: var(--el-text-color-secondary); background: var(--el-fill-color-light); border-bottom: 1px solid var(--el-border-color-lighter); font-size: 12px; font-weight: 600; }
.prompt-detail-category-title { display: flex; align-items: center; justify-content: space-between; gap: 8px; padding: 7px 14px 7px 24px; color: var(--el-text-color-secondary); background: var(--el-bg-color); border-bottom: 1px dashed var(--el-border-color); font-size: 11px; font-weight: 600; }
.prompt-group { border-bottom: 1px solid var(--el-border-color-lighter); }
.business-bundle-toggle { display: flex; width: 100%; align-items: center; gap: 8px; padding: 10px 12px; color: inherit; background: var(--el-bg-color); border: 0; cursor: pointer; text-align: left; }
.business-bundle-toggle:hover, .business-bundle-toggle.active { background: var(--el-color-primary-light-9); }
.business-bundle-toggle.active { box-shadow: inset 3px 0 var(--el-color-primary); }
.bundle-heading { display: flex; min-width: 0; flex: 1; flex-direction: column; gap: 3px; }
.bundle-heading strong { font-size: 13px; }
.bundle-heading code { color: var(--el-text-color-secondary); font: 10px/1.3 Consolas, monospace; overflow-wrap: anywhere; }
.bundle-count { color: var(--el-text-color-secondary); font-size: 10px; white-space: nowrap; }
.bundle-component-list { background: color-mix(in srgb, var(--el-fill-color-light) 55%, transparent); }
.prompt-list-item { position: relative; display: flex; width: 100%; flex-direction: column; gap: 5px; padding: 12px 14px; text-align: left; color: inherit; background: transparent; border: 0; border-bottom: 1px solid var(--el-border-color-lighter); cursor: pointer; }
.prompt-list-item:hover, .prompt-list-item.active { background: var(--el-color-primary-light-9); }
.prompt-list-item.active { box-shadow: inset 3px 0 var(--el-color-primary); }
.child-group-toggle { display: flex; width: 100%; align-items: center; gap: 7px; padding: 8px 14px; color: var(--el-text-color-secondary); background: var(--el-fill-color-light); border: 0; cursor: pointer; font-size: 12px; text-align: left; }
.child-group-toggle:hover { color: var(--el-color-primary); background: var(--el-color-primary-light-9); }
.child-count { margin-left: auto; white-space: nowrap; }
.child-list { background: color-mix(in srgb, var(--el-fill-color-light) 60%, transparent); }
.prompt-list-item.child-item { padding-left: 28px; background: var(--el-bg-color); }
.prompt-list-item.child-item:hover, .prompt-list-item.child-item.active { background: var(--el-color-primary-light-9); }
.prompt-list-item.bundle-component-item { padding-left: 28px; background: var(--el-bg-color); }
.component-slot { width: fit-content; padding: 2px 6px; color: var(--el-color-primary); background: var(--el-color-primary-light-9); border-radius: 4px; font-size: 10px; font-weight: 600; }
.item-title { font-size: 14px; font-weight: 600; }
.item-key { color: var(--el-text-color-secondary); font: 11px/1.4 Consolas, monospace; overflow-wrap: anywhere; }
.item-tags { display: flex; flex-wrap: wrap; gap: 5px; }
.dirty-dot { position: absolute; top: 12px; right: 10px; width: 7px; height: 7px; border-radius: 50%; background: var(--el-color-warning); }
.editor-panel { min-width: 0; padding: 20px; }
.editor-header { display: flex; align-items: flex-start; justify-content: space-between; gap: 18px; margin-bottom: 14px; }
.editor-header h3 { margin: 0 0 5px; font-size: 18px; }
.editor-header code { color: var(--el-text-color-secondary); font-size: 12px; }
.header-tags { display: flex; flex-wrap: wrap; justify-content: flex-end; gap: 6px; }
.risk-alert { margin-bottom: 14px; }
.relation-alert { margin-bottom: 14px; }
.business-scene-strip { display: grid; grid-template-columns: minmax(0, 1fr) minmax(0, 1fr) auto; align-items: center; gap: 14px; margin-bottom: 14px; padding: 12px 14px; background: var(--el-fill-color-lighter); border: 1px solid var(--el-border-color-lighter); border-radius: 8px; }
.business-scene-strip > div { display: flex; min-width: 0; flex-wrap: wrap; align-items: center; gap: 6px; }
.business-scene-strip strong { font-size: 13px; }
.business-scene-strip code { color: var(--el-text-color-secondary); font: 11px/1.4 Consolas, monospace; overflow-wrap: anywhere; }
.business-scene-caption { color: var(--el-text-color-secondary); font-size: 11px; }
.business-scene-model { justify-content: flex-end; font-size: 12px; }
.meta-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 8px 20px; margin-bottom: 16px; font-size: 13px; }
.meta-grid span { display: inline-block; width: 76px; color: var(--el-text-color-secondary); }
.section-title { margin-bottom: 8px; color: var(--el-text-color-secondary); font-size: 12px; }
.variable-section { margin-bottom: 14px; }
.variable-list { display: flex; flex-wrap: wrap; gap: 6px; }
.prompt-textarea :deep(textarea) { font: 12.5px/1.65 Consolas, Monaco, monospace; }
.actions { display: flex; justify-content: flex-end; gap: 8px; margin-top: 14px; }
.preview-meta { margin-bottom: 10px; color: var(--el-text-color-secondary); font-size: 12px; }
.preview-content { max-height: 60vh; margin: 0; padding: 14px; overflow: auto; white-space: pre-wrap; overflow-wrap: anywhere; background: var(--el-fill-color-lighter); border-radius: 8px; font: 12px/1.6 Consolas, monospace; }
@media (max-width: 900px) {
  .editor-layout { grid-template-columns: 1fr; }
  .prompt-list-column { height: 280px; }
  .prompt-list { border-right: 0; border-bottom: 1px solid var(--el-border-color); }
  .editor-header { flex-direction: column; }
  .business-scene-strip { grid-template-columns: 1fr; }
  .business-scene-model { justify-content: flex-start; }
}
</style>
