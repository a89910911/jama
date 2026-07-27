<template>
  <section class="wardrobe-panel" v-loading="loading">
    <div class="wardrobe-head">
      <div>
        <strong>角色衣橱</strong>
        <span>{{ character?.name || '' }} · {{ looks.length }} 套造型</span>
      </div>
      <el-button size="small" type="primary" plain @click="createLook">新增造型</el-button>
    </div>

    <div v-if="looks.length" class="wardrobe-body">
      <div class="look-list">
        <button
          v-for="look in looks"
          :key="look.id"
          type="button"
          class="look-card"
          :class="{ active: selectedId === look.id }"
          @click="selectLook(look)"
        >
          <div class="look-thumb">
            <img v-if="mediaUrl(look)" :src="mediaUrl(look)" alt="" />
            <span v-else>无图</span>
          </div>
          <div class="look-card-copy">
            <b>{{ look.name }}</b>
            <small>{{ categoryLabel(look.category) }}</small>
          </div>
          <el-tag v-if="look.is_default" size="small" type="success">默认</el-tag>
        </button>
      </div>

      <div v-if="selected" class="look-editor">
        <div class="look-preview">
          <img v-if="mediaUrl(selected)" :src="mediaUrl(selected)" alt="" />
          <div v-else class="look-preview-empty">尚未生成造型参考图</div>
          <div class="look-image-actions">
            <el-button size="small" :loading="generating" @click="generateImage">AI 生成</el-button>
            <el-button size="small" @click="fileInput?.click()">上传图片</el-button>
            <input
              ref="fileInput"
              hidden
              type="file"
              accept="image/*"
              @change="uploadImage"
            />
          </div>
        </div>

        <el-form label-position="top" size="small" class="look-form">
          <div class="form-row">
            <el-form-item label="造型名称">
              <el-input v-model="form.name" maxlength="40" />
            </el-form-item>
            <el-form-item label="类型">
              <el-select v-model="form.category">
                <el-option label="日常装" value="daily" />
                <el-option label="战斗装" value="battle" />
                <el-option label="古装" value="historical" />
                <el-option label="受伤状态" value="injured" />
                <el-option label="礼服" value="formal" />
                <el-option label="自定义" value="custom" />
              </el-select>
            </el-form-item>
          </div>
          <el-form-item label="造型描述">
            <el-input
              v-model="form.appearance"
              type="textarea"
              :rows="3"
              placeholder="服装、发型、妆容、伤情、随身物件等可变视觉特征"
            />
          </el-form-item>
          <el-form-item label="生图提示词">
            <el-input
              v-model="form.polished_prompt"
              type="textarea"
              :rows="3"
              placeholder="只描述当前造型；固定身份特征由角色身份锚点提供"
            />
          </el-form-item>
          <el-form-item label="负面提示词">
            <el-input v-model="form.negative_prompt" type="textarea" :rows="2" />
          </el-form-item>
          <div class="editor-actions">
            <el-button type="primary" :loading="saving" @click="saveLook">保存造型</el-button>
            <el-button
              v-if="!selected.is_default"
              type="success"
              plain
              @click="setDefault"
            >
              设为默认
            </el-button>
            <el-button
              v-if="looks.length > 1"
              type="danger"
              plain
              @click="removeLook"
            >
              归档
            </el-button>
            <span class="revision">版本 v{{ selected.visual_revision || 1 }}</span>
          </div>
        </el-form>
      </div>
    </div>

    <el-empty v-else description="暂无造型" />
  </section>
</template>

<script setup>
import { computed, reactive, ref, watch } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { characterLookAPI } from '@/api/characterLooks'
import { taskAPI } from '@/api/task'

const props = defineProps({
  character: { type: Object, required: true },
})

const emit = defineEmits(['changed'])
const looks = ref([])
const selectedId = ref(null)
const loading = ref(false)
const saving = ref(false)
const generating = ref(false)
const fileInput = ref(null)
const form = reactive({
  name: '',
  category: 'daily',
  appearance: '',
  polished_prompt: '',
  negative_prompt: '',
})

const selected = computed(() =>
  looks.value.find((look) => Number(look.id) === Number(selectedId.value)) || null
)

function mediaUrl(item) {
  const raw = String(item?.local_path || item?.image_url || item?.ref_image || '').trim()
  if (!raw) return ''
  if (/^(https?:|data:|blob:)/i.test(raw) || raw.startsWith('/static/')) return raw
  return `/static/${raw.replace(/^[/\\]+/, '').replace(/\\/g, '/')}`
}

function categoryLabel(value) {
  return {
    default: '默认造型',
    daily: '日常装',
    battle: '战斗装',
    historical: '古装',
    injured: '受伤状态',
    formal: '礼服',
    custom: '自定义',
    legacy_stage: '旧阶段迁移',
  }[value] || value || '自定义'
}

function fillForm(look) {
  form.name = look?.name || ''
  form.category = look?.category || 'custom'
  form.appearance = look?.appearance || ''
  form.polished_prompt = look?.polished_prompt || ''
  form.negative_prompt = look?.negative_prompt || ''
}

function selectLook(look) {
  selectedId.value = look.id
  fillForm(look)
}

async function loadLooks(preferredId = null) {
  if (!props.character?.id) return
  loading.value = true
  try {
    const data = await characterLookAPI.list(props.character.id)
    looks.value = data?.items || []
    const next = looks.value.find((item) => Number(item.id) === Number(preferredId))
      || looks.value.find((item) => Number(item.id) === Number(selectedId.value))
      || looks.value[0]
    if (next) selectLook(next)
  } finally {
    loading.value = false
  }
}

async function createLook() {
  try {
    const data = await characterLookAPI.create(props.character.id, {
      name: `造型 ${looks.value.length + 1}`,
      category: 'custom',
      appearance: selected.value?.appearance || props.character?.appearance || '',
    })
    ElMessage.success('已新增造型')
    await loadLooks(data?.look?.id)
    emit('changed', data)
  } catch (error) {
    ElMessage.error(error?.message || '新增造型失败')
  }
}

async function saveLook() {
  if (!selected.value) return
  if (!form.name.trim()) {
    ElMessage.warning('请填写造型名称')
    return
  }
  saving.value = true
  try {
    const data = await characterLookAPI.update(selected.value.id, {
      name: form.name.trim(),
      category: form.category,
      appearance: form.appearance.trim() || null,
      polished_prompt: form.polished_prompt.trim() || null,
      negative_prompt: form.negative_prompt.trim() || null,
      expected_revision: selected.value.visual_revision,
    })
    ElMessage.success('造型已保存，相关分镜已标记待刷新')
    await loadLooks(data?.look?.id || selected.value.id)
    emit('changed', data)
  } catch (error) {
    ElMessage.error(error?.message || '保存造型失败，请刷新后重试')
  } finally {
    saving.value = false
  }
}

async function setDefault() {
  if (!selected.value) return
  try {
    const data = await characterLookAPI.setDefault(selected.value.id)
    ElMessage.success('默认造型已更新')
    await loadLooks(selected.value.id)
    emit('changed', data)
  } catch (error) {
    ElMessage.error(error?.message || '设置默认造型失败')
  }
}

async function generateImage() {
  if (!selected.value) return
  generating.value = true
  try {
    const data = await characterLookAPI.generateImage(selected.value.id)
    const taskId = data?.image_generation?.task_id || data?.task_id
    ElMessage.success('造型图生成任务已提交')
    emit('changed', data)
    if (taskId) {
      for (let index = 0; index < 300; index += 1) {
        await new Promise((resolve) => window.setTimeout(resolve, 1500))
        const task = await taskAPI.get(taskId)
        if (task?.status === 'completed') {
          if (task?.result?.superseded) {
            ElMessage.warning('造型已在生成期间更新，本次结果仅保留在历史中')
          } else {
            ElMessage.success('造型参考图生成完成')
          }
          break
        }
        if (task?.status === 'failed') throw new Error(task.error || '造型图生成失败')
      }
    }
    await loadLooks(selected.value?.id)
  } catch (error) {
    ElMessage.error(error?.message || '造型图生成失败')
  } finally {
    generating.value = false
  }
}

async function uploadImage(event) {
  const file = event.target.files?.[0]
  event.target.value = ''
  if (!file || !selected.value) return
  try {
    const data = await characterLookAPI.uploadImage(selected.value.id, file)
    ElMessage.success('造型参考图已更新')
    await loadLooks(selected.value.id)
    emit('changed', data)
  } catch (error) {
    ElMessage.error(error?.message || '上传失败')
  }
}

async function removeLook() {
  if (!selected.value) return
  const replacement = looks.value.find((look) => look.id !== selected.value.id)
  if (!replacement) return
  try {
    await ElMessageBox.confirm(
      `归档“${selected.value.name}”后，其绑定会替换为“${replacement.name}”。是否继续？`,
      '归档造型',
      { type: 'warning' }
    )
    const data = await characterLookAPI.remove(selected.value.id, replacement.id)
    ElMessage.success('造型已归档并完成绑定替换')
    selectedId.value = replacement.id
    await loadLooks(replacement.id)
    emit('changed', data)
  } catch (error) {
    if (error === 'cancel') return
    ElMessage.error(error?.message || '归档失败')
  }
}

watch(() => props.character?.id, () => loadLooks(), { immediate: true })
</script>

<style scoped>
.wardrobe-panel {
  min-height: 240px;
}

.wardrobe-head,
.editor-actions,
.form-row,
.wardrobe-body,
.look-card,
.look-image-actions {
  display: flex;
  align-items: center;
}

.wardrobe-head {
  justify-content: space-between;
  margin-bottom: 14px;
}

.wardrobe-head > div {
  display: grid;
  gap: 3px;
}

.wardrobe-head span,
.revision,
.look-card-copy small {
  color: var(--el-text-color-secondary);
  font-size: 12px;
}

.wardrobe-body {
  align-items: stretch;
  gap: 16px;
}

.look-list {
  width: 210px;
  max-height: 470px;
  overflow: auto;
}

.look-card {
  width: 100%;
  gap: 9px;
  margin-bottom: 8px;
  padding: 7px;
  border: 1px solid var(--el-border-color);
  border-radius: 9px;
  background: var(--el-fill-color-blank);
  color: inherit;
  text-align: left;
  cursor: pointer;
}

.look-card.active {
  border-color: var(--el-color-primary);
  background: var(--el-color-primary-light-9);
}

.look-thumb {
  width: 48px;
  height: 58px;
  flex: 0 0 auto;
  display: grid;
  place-items: center;
  overflow: hidden;
  border-radius: 6px;
  background: var(--el-fill-color);
  color: var(--el-text-color-placeholder);
  font-size: 11px;
}

.look-thumb img,
.look-preview img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.look-card-copy {
  min-width: 0;
  flex: 1;
  display: grid;
  gap: 4px;
}

.look-card-copy b {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.look-editor {
  min-width: 0;
  flex: 1;
  display: grid;
  grid-template-columns: 180px minmax(300px, 1fr);
  gap: 16px;
}

.look-preview {
  height: 235px;
  overflow: hidden;
  border: 1px solid var(--el-border-color);
  border-radius: 10px;
  position: relative;
  background: var(--el-fill-color-light);
}

.look-preview-empty {
  height: 100%;
  display: grid;
  place-items: center;
  color: var(--el-text-color-placeholder);
  font-size: 12px;
}

.look-image-actions {
  position: absolute;
  left: 6px;
  right: 6px;
  bottom: 6px;
  justify-content: center;
  gap: 4px;
  padding: 5px;
  border-radius: 7px;
  background: color-mix(in srgb, var(--el-bg-color) 88%, transparent);
}

.form-row {
  gap: 10px;
}

.form-row :deep(.el-form-item) {
  flex: 1;
}

.editor-actions {
  gap: 8px;
}

.revision {
  margin-left: auto;
}

@media (max-width: 840px) {
  .wardrobe-body,
  .look-editor {
    display: block;
  }

  .look-list {
    width: auto;
    display: flex;
    gap: 8px;
    margin-bottom: 12px;
  }

  .look-card {
    min-width: 180px;
  }

  .look-preview {
    margin-bottom: 12px;
  }
}
</style>
