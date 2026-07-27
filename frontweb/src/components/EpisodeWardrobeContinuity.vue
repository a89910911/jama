<template>
  <section class="continuity-panel" v-loading="loading">
    <div class="continuity-head">
      <div>
        <strong>本集造型与连戏</strong>
        <span>集级 → 场次 → 分镜，后一级覆盖前一级</span>
      </div>
      <div class="continuity-actions">
        <el-tag :type="preflight.ok ? 'success' : 'danger'">
          {{ preflight.ok ? '预检通过' : `${preflight.errors.length} 项阻断` }}
        </el-tag>
        <el-button size="small" @click="loadAll">刷新</el-button>
      </div>
    </div>

    <el-alert
      v-if="preflight.errors.length"
      type="error"
      :closable="false"
      title="以下问题会阻止批量生成"
      class="preflight-alert"
    >
      <ul>
        <li v-for="(issue, index) in preflight.errors" :key="index">
          {{ issue.message || issue.error || issue.code }}
        </li>
      </ul>
    </el-alert>
    <el-alert
      v-else-if="preflight.warnings.length"
      type="warning"
      :closable="false"
      title="连戏提醒"
      class="preflight-alert"
    >
      <ul>
        <li v-for="(issue, index) in preflight.warnings" :key="index">
          {{ issue.message || issue.warning || issue.code }}
        </li>
      </ul>
    </el-alert>

    <div class="scope-card">
      <div class="scope-title">
        <b>本集默认</b>
        <span>适用于本集全部场次，可在场次或分镜中覆盖</span>
      </div>
      <div class="binding-grid">
        <div v-for="character in characters" :key="`episode-${character.id}`" class="binding-row">
          <span class="character-name">{{ character.name }}</span>
          <el-select
            :model-value="bindingLookId('episode', episodeId, character.id)"
            clearable
            placeholder="继承角色默认造型"
            @change="(lookId) => changeBinding('episode', episodeId, character.id, lookId)"
          >
            <el-option
              v-for="look in looksByCharacter[character.id] || []"
              :key="look.id"
              :label="lookLabel(look)"
              :value="look.id"
            />
          </el-select>
        </div>
      </div>
    </div>

    <div v-for="block in sceneBlocks" :key="block.id" class="scope-card">
      <div class="scope-title">
        <b>{{ block.title || `场次 ${block.sort_order + 1}` }}</b>
        <span>{{ [block.location, block.time].filter(Boolean).join(' · ') || '未填写场景信息' }}</span>
      </div>
      <div class="binding-grid">
        <div v-for="character in characters" :key="`${block.id}-${character.id}`" class="binding-row">
          <span class="character-name">{{ character.name }}</span>
          <el-select
            :model-value="bindingLookId('scene_block', block.id, character.id)"
            clearable
            :placeholder="`继承本集：${effectiveEpisodeLookName(character.id)}`"
            @change="(lookId) => changeBinding('scene_block', block.id, character.id, lookId)"
          >
            <el-option
              v-for="look in looksByCharacter[character.id] || []"
              :key="look.id"
              :label="lookLabel(look)"
              :value="look.id"
            />
          </el-select>
        </div>
      </div>
    </div>

    <el-empty v-if="!characters.length" description="本集尚未添加角色" />
  </section>
</template>

<script setup>
import { reactive, ref, watch } from 'vue'
import { ElMessage } from 'element-plus'
import { characterLookAPI } from '@/api/characterLooks'

const props = defineProps({
  episodeId: { type: [Number, String], required: true },
  characters: { type: Array, default: () => [] },
})
const emit = defineEmits(['changed'])

const loading = ref(false)
const sceneBlocks = ref([])
const bindings = ref([])
const looksByCharacter = reactive({})
const preflight = reactive({ ok: true, errors: [], warnings: [] })

function lookLabel(look) {
  return `${look.name}${look.is_default ? '（角色默认）' : ''}`
}

function binding(scopeType, scopeId, characterId) {
  return bindings.value.find((item) =>
    item.scope_type === scopeType
    && Number(item.scope_id) === Number(scopeId)
    && Number(item.character_id) === Number(characterId)
  )
}

function bindingLookId(scopeType, scopeId, characterId) {
  return binding(scopeType, scopeId, characterId)?.look_id || null
}

function effectiveEpisodeLookName(characterId) {
  const explicitId = bindingLookId('episode', props.episodeId, characterId)
  const list = looksByCharacter[characterId] || []
  return list.find((item) => Number(item.id) === Number(explicitId))?.name
    || list.find((item) => item.is_default)?.name
    || '角色默认'
}

async function loadAll() {
  if (!props.episodeId) return
  loading.value = true
  try {
    const [context, report, ...lookResponses] = await Promise.all([
      characterLookAPI.episodeContext(props.episodeId),
      characterLookAPI.preflight(props.episodeId),
      ...props.characters.map((character) => characterLookAPI.list(character.id)),
    ])
    sceneBlocks.value = context?.scene_blocks || []
    bindings.value = context?.bindings || []
    props.characters.forEach((character, index) => {
      looksByCharacter[character.id] = lookResponses[index]?.items || []
    })
    preflight.ok = report?.ok !== false
    preflight.errors = report?.errors || []
    preflight.warnings = report?.warnings || []
  } catch (error) {
    ElMessage.error(error?.message || '加载连戏数据失败')
  } finally {
    loading.value = false
  }
}

async function changeBinding(scopeType, scopeId, characterId, lookId) {
  try {
    if (lookId == null || lookId === '') {
      const existing = binding(scopeType, scopeId, characterId)
      if (existing) {
        await characterLookAPI.unbind(scopeType, scopeId, characterId)
      }
    } else {
      await characterLookAPI.bind({
        scope_type: scopeType,
        scope_id: scopeId,
        character_id: characterId,
        look_id: lookId,
        source: 'manual',
      })
    }
    await loadAll()
    emit('changed')
    ElMessage.success('造型绑定已更新')
  } catch (error) {
    ElMessage.error(error?.message || '更新造型绑定失败')
  }
}

watch(
  [() => props.episodeId, () => props.characters.map((item) => item.id).join(',')],
  loadAll,
  { immediate: true }
)
</script>

<style scoped>
.continuity-panel {
  min-height: 240px;
}

.continuity-head,
.continuity-actions,
.scope-title,
.binding-row {
  display: flex;
  align-items: center;
}

.continuity-head {
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 14px;
}

.continuity-head > div:first-child,
.scope-title {
  display: grid;
  gap: 3px;
}

.continuity-head span,
.scope-title span {
  color: var(--el-text-color-secondary);
  font-size: 12px;
}

.continuity-actions {
  gap: 8px;
}

.preflight-alert {
  margin-bottom: 12px;
}

.preflight-alert ul {
  margin: 6px 0 0;
  padding-left: 18px;
}

.scope-card {
  margin-bottom: 12px;
  padding: 12px;
  border: 1px solid var(--el-border-color);
  border-radius: 10px;
  background: var(--el-fill-color-light);
}

.scope-title {
  margin-bottom: 10px;
}

.binding-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(260px, 1fr));
  gap: 8px 14px;
}

.binding-row {
  gap: 8px;
}

.character-name {
  width: 80px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.binding-row :deep(.el-select) {
  min-width: 0;
  flex: 1;
}
</style>
