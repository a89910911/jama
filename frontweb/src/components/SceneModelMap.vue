<template>
  <div class="scene-model-map-page">
    <div class="page-header">
      <div>
        <h3>业务场景与模型</h3>
        <p class="page-desc">
          所有程序内置业务场景均在此展示。未单独配置的场景自动继承对应服务类型的默认 AI 配置。
        </p>
      </div>
      <el-button :loading="loading" @click="load">刷新</el-button>
    </div>

    <div class="filters">
      <el-input
        v-model="filters.keyword"
        clearable
        placeholder="搜索场景、场景键、模板或模型"
        class="keyword-filter"
      />
      <el-select v-model="filters.category" clearable placeholder="全部分类">
        <el-option v-for="item in categoryOptions" :key="item" :label="item" :value="item" />
      </el-select>
      <el-select v-model="filters.serviceType" clearable placeholder="全部服务类型">
        <el-option
          v-for="item in serviceTypeOptions"
          :key="item"
          :label="serviceTypeLabel(item)"
          :value="item"
        />
      </el-select>
    </div>

    <el-table v-loading="loading" :data="filteredList" stripe style="width: 100%">
      <el-table-column label="分类" min-width="190">
        <template #default="{ row }">
          <div class="category-path">
            <span v-for="(item, index) in row.category_path" :key="`${item}-${index}`">
              <i v-if="index">/</i>{{ item }}
            </span>
          </div>
        </template>
      </el-table-column>

      <el-table-column label="业务场景" min-width="240">
        <template #default="{ row }">
          <strong class="scene-label">{{ row.label }}</strong>
          <code class="scene-key">{{ row.key }}</code>
          <p class="scene-description">{{ row.description }}</p>
        </template>
      </el-table-column>

      <el-table-column label="业务模板包" min-width="210">
        <template #default="{ row }">
          <div class="bundle-summary">
            <span>{{ row.prompt_count }} 个组成部分</span>
            <el-tag
              v-for="component in row.prompt_components.slice(0, 3)"
              :key="component.prompt_key"
              size="small"
              effect="plain"
            >
              {{ component.business_slot_label }}
            </el-tag>
            <el-tag v-if="row.prompt_count > 3" size="small" type="info">
              +{{ row.prompt_count - 3 }}
            </el-tag>
          </div>
        </template>
      </el-table-column>

      <el-table-column label="服务类型" width="130">
        <template #default="{ row }">
          <el-tag :type="serviceTypeTagType(row.service_type)" size="small">
            {{ serviceTypeLabel(row.service_type) }}
          </el-tag>
        </template>
      </el-table-column>

      <el-table-column label="当前有效配置" min-width="210">
        <template #default="{ row }">
          <div v-if="row.effective_config_name" class="effective-config">
            <span>{{ row.effective_config_name }}</span>
            <code>{{ row.effective_model || '配置默认模型' }}</code>
          </div>
          <el-tag v-else type="danger" size="small">暂无可用配置</el-tag>
        </template>
      </el-table-column>

      <el-table-column label="来源" width="110">
        <template #default="{ row }">
          <el-tag :type="row.mapping_source === 'scene' ? 'warning' : 'info'" size="small">
            {{ row.mapping_source === 'scene' ? '场景指定' : '继承默认' }}
          </el-tag>
        </template>
      </el-table-column>

      <el-table-column label="操作" width="210" fixed="right">
        <template #default="{ row }">
          <el-button link type="primary" size="small" @click="viewPrompts(row)">查看提示词</el-button>
          <el-button link type="primary" size="small" @click="openEdit(row)">配置模型</el-button>
          <el-button
            link
            type="danger"
            size="small"
            :disabled="!row.mapping_exists"
            @click="resetMapping(row)"
          >
            恢复默认
          </el-button>
        </template>
      </el-table-column>
    </el-table>

    <el-empty v-if="!loading && filteredList.length === 0" description="没有匹配的业务场景" />

    <el-dialog
      v-model="dialogVisible"
      title="配置业务场景模型"
      width="580px"
      :close-on-click-modal="false"
    >
      <el-form v-if="editingScene" label-width="120px">
        <el-form-item label="业务场景">
          <div class="dialog-scene">
            <strong>{{ editingScene.label }}</strong>
            <code>{{ editingScene.key }}</code>
          </div>
        </el-form-item>
        <el-form-item label="分类">
          {{ editingScene.category_path.join(' / ') }}
        </el-form-item>
        <el-form-item label="服务类型">
          <el-tag :type="serviceTypeTagType(editingScene.service_type)" size="small">
            {{ serviceTypeLabel(editingScene.service_type) }}
          </el-tag>
        </el-form-item>
        <el-form-item label="AI 配置">
          <el-select
            v-model="form.config_id"
            clearable
            placeholder="留空则继承该服务类型的默认配置"
            style="width: 100%"
            @change="form.model_override = ''"
          >
            <el-option
              v-for="config in filteredConfigs"
              :key="config.id"
              :label="`${config.name} (${config.provider})`"
              :value="config.id"
            />
          </el-select>
        </el-form-item>
        <el-form-item label="模型覆盖">
          <el-select
            v-model="form.model_override"
            clearable
            placeholder="留空则使用配置默认模型"
            style="width: 100%"
            :disabled="!selectedConfigModels.length"
          >
            <el-option
              v-for="model in selectedConfigModels"
              :key="model"
              :label="model"
              :value="model"
            />
          </el-select>
        </el-form-item>
        <el-form-item label="说明">
          <el-input v-model="form.description" placeholder="场景配置说明" />
        </el-form-item>
      </el-form>

      <template #footer>
        <el-button @click="dialogVisible = false">取消</el-button>
        <el-button type="primary" :loading="saving" @click="save">保存</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup>
import { computed, onMounted, reactive, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { ElMessage, ElMessageBox } from 'element-plus'
import { sceneModelMapAPI } from '@/api/sceneModelMap'
import { aiAPI } from '@/api/ai'
import { parseModelList } from '@/utils/modelSelection'

const route = useRoute()
const router = useRouter()
const loading = ref(false)
const saving = ref(false)
const list = ref([])
const configs = ref([])
const dialogVisible = ref(false)
const editingScene = ref(null)
const filters = reactive({
  keyword: '',
  category: '',
  serviceType: '',
})
const form = reactive({
  config_id: null,
  model_override: '',
  description: '',
})

const categoryOptions = computed(() => [...new Set(list.value.map((item) => item.category))])
const serviceTypeOptions = computed(() => [...new Set(list.value.map((item) => item.service_type))])
const filteredList = computed(() => {
  const keyword = filters.keyword.trim().toLowerCase()
  return list.value.filter((item) => {
    if (filters.category && item.category !== filters.category) return false
    if (filters.serviceType && item.service_type !== filters.serviceType) return false
    if (!keyword) return true
    return [
      item.label,
      item.key,
      item.description,
      item.category_path?.join(' '),
      item.effective_config_name,
      item.effective_model,
      ...(item.prompt_components || []).flatMap((component) => [
        component.name,
        component.prompt_key,
      ]),
    ].some((value) => String(value || '').toLowerCase().includes(keyword))
  })
})
const filteredConfigs = computed(() => {
  if (!editingScene.value) return []
  const type = editingScene.value.service_type
  return configs.value.filter((config) => {
    if (!config.is_active) return false
    if (config.service_type === type) return true
    return type === 'storyboard_image' && config.service_type === 'image'
  })
})
const selectedConfigModels = computed(() => {
  const config = form.config_id
    ? configs.value.find((item) => item.id === form.config_id)
    : null
  return config ? parseModelList(config.model, config.default_model) : []
})

function serviceTypeLabel(type) {
  return {
    text: '文本/对话',
    image: '文本生成图片',
    storyboard_image: '分镜图片',
    video: '视频生成',
    tts: '语音合成',
  }[type] || type
}

function serviceTypeTagType(type) {
  return {
    text: 'primary',
    image: 'success',
    storyboard_image: 'warning',
    video: 'danger',
    tts: 'info',
  }[type] || ''
}

async function load() {
  loading.value = true
  try {
    const [overview, configRows] = await Promise.all([
      sceneModelMapAPI.overview(),
      aiAPI.list(),
    ])
    list.value = overview || []
    configs.value = configRows || []
    const querySceneKey = String(route.query.scene_key || '')
    if (querySceneKey && list.value.some((item) => item.key === querySceneKey)) {
      filters.keyword = querySceneKey
    }
  } catch (err) {
    ElMessage.error(`加载业务场景失败：${err.message || '未知错误'}`)
  } finally {
    loading.value = false
  }
}

function openEdit(row) {
  editingScene.value = row
  form.config_id = row.config_id || null
  form.model_override = row.model_override || ''
  form.description = row.mapping_description || row.description || ''
  dialogVisible.value = true
}

async function save() {
  if (!editingScene.value) return
  saving.value = true
  try {
    const body = {
      service_type: editingScene.value.service_type,
      config_id: form.config_id || null,
      model_override: form.model_override || null,
      description: form.description || editingScene.value.description,
    }
    if (editingScene.value.mapping_exists) {
      await sceneModelMapAPI.update(editingScene.value.key, body)
    } else {
      await sceneModelMapAPI.create({ key: editingScene.value.key, ...body })
    }
    dialogVisible.value = false
    ElMessage.success('业务场景模型已保存')
    await load()
  } finally {
    saving.value = false
  }
}

async function resetMapping(row) {
  await ElMessageBox.confirm(
    `确认让“${row.label}”恢复继承默认 AI 配置？`,
    '恢复默认',
    { type: 'warning' }
  )
  await sceneModelMapAPI.delete(row.key)
  ElMessage.success('已恢复继承默认配置')
  await load()
}

function viewPrompts(row) {
  router.replace({
    path: '/ai-config',
    query: {
      ...route.query,
      tab: 'prompts',
      scene_key: row.key,
    },
  })
}

onMounted(load)
watch(() => route.query.scene_key, (value) => {
  const sceneKey = String(value || '')
  if (sceneKey) filters.keyword = sceneKey
})
</script>

<style scoped>
.scene-model-map-page { min-width: 0; }
.page-header { display: flex; align-items: flex-start; justify-content: space-between; gap: 16px; margin-bottom: 16px; }
.page-header h3 { margin: 0 0 6px; font-size: 17px; }
.page-desc { margin: 0; color: var(--el-text-color-secondary); font-size: 13px; line-height: 1.6; }
.filters { display: flex; flex-wrap: wrap; gap: 10px; margin-bottom: 14px; }
.filters .el-select { width: 170px; }
.keyword-filter { width: 300px; }
.category-path { display: flex; flex-wrap: wrap; gap: 4px; color: var(--el-text-color-regular); font-size: 12px; }
.category-path i { margin-right: 4px; color: var(--el-text-color-placeholder); font-style: normal; }
.scene-label { display: block; margin-bottom: 4px; font-size: 13px; }
.scene-key { display: block; width: fit-content; color: var(--el-color-primary); font: 11px/1.4 Consolas, monospace; overflow-wrap: anywhere; }
.scene-description { margin: 4px 0 0; color: var(--el-text-color-secondary); font-size: 11px; line-height: 1.4; }
.bundle-summary { display: flex; flex-wrap: wrap; align-items: center; gap: 5px; font-size: 12px; }
.effective-config { display: flex; flex-direction: column; gap: 4px; font-size: 12px; }
.effective-config code { color: var(--el-text-color-secondary); font: 11px/1.4 Consolas, monospace; overflow-wrap: anywhere; }
.dialog-scene { display: flex; flex-direction: column; gap: 4px; }
.dialog-scene code { color: var(--el-text-color-secondary); font-size: 11px; }
@media (max-width: 720px) {
  .page-header { flex-direction: column; }
  .keyword-filter, .filters .el-select { width: 100%; }
}
</style>
