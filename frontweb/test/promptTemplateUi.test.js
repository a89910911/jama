import test from 'node:test'
import assert from 'node:assert/strict'
import {
  effectivePromptContent,
  filterPromptItems,
  groupPromptItems,
  groupPromptSections,
  promptRowKey,
  rootPromptKey,
} from '../src/utils/promptTemplateUi.js'

const rows = [
  {
    prompt_key: 'character.extraction.system',
    name: '角色提取',
    category: '资产',
    subcategory: '人物',
    detail_category: '剧本提取',
    workflow_stage: '资产',
    workflow_order: 2,
    scene_key: 'role_extraction',
    message_role: 'system',
    template_kind: 'main',
    system_content: 'system',
    effective_content: 'project',
  },
  {
    prompt_key: 'image.negative.anti_split',
    name: '防分屏负向提示词',
    category: '分镜',
    subcategory: '参考图与图片约束',
    detail_category: '',
    workflow_stage: '分镜',
    workflow_order: 3,
    scene_key: null,
    message_role: 'user',
    content_type: 'negative_prompt',
    template_kind: 'conditional_child',
    system_content: 'negative',
    effective_content: 'negative',
  },
  {
    prompt_key: 'omni.segment.user',
    name: '生成 Omni 分段视频提示词',
    category: '视频',
    subcategory: '全能模式',
    detail_category: '',
    workflow_stage: '视频',
    workflow_order: 4,
    scene_key: 'omni_segment_generation',
    message_role: 'user',
    content_type: 'user_template',
    template_kind: 'main',
    system_content: 'omni',
    effective_content: 'omni',
    sort_order: 20,
    is_fragment: false,
    injection_channel: '主调用模板',
  },
  {
    prompt_key: 'omni.segment.reference_rule',
    name: '约束 Omni 参考图编号',
    category: '视频',
    subcategory: '全能模式',
    detail_category: '',
    workflow_stage: '视频',
    workflow_order: 4,
    scene_key: 'omni_segment_generation',
    message_role: 'user',
    content_type: 'suffix',
    template_kind: 'conditional_child',
    system_content: 'reference',
    effective_content: 'reference',
    sort_order: 21,
    is_fragment: true,
    parent_prompt_key: 'omni.segment.user',
    injection_channel: '满足参考图条件时追加',
    relation_note: '仅在存在参考图时注入。',
  },
  {
    prompt_key: 'image.reference_generation.user',
    name: '非 Gemini 参考图生图拼装',
    category: '分镜',
    subcategory: '参考图与图片约束',
    detail_category: '',
    workflow_stage: '分镜',
    workflow_order: 3,
    scene_key: null,
    message_role: 'user',
    content_type: 'image_prompt',
    template_kind: 'independent_technical',
    system_content: 'reference generation',
    effective_content: 'reference generation',
    sort_order: 22,
    is_fragment: false,
    parent_prompt_key: null,
    injection_channel: '非 Gemini 图片正向提示词',
  },
  {
    prompt_key: 'image.default_cinematic_style',
    name: '默认电影感画风',
    category: '分镜',
    subcategory: '分镜图片',
    detail_category: '',
    workflow_stage: '分镜',
    workflow_order: 3,
    scene_key: null,
    message_role: 'user',
    content_type: 'image_prompt',
    template_kind: 'conditional_child',
    template_subtype: 'fallback',
    system_content: 'cinematic',
    effective_content: 'cinematic',
    sort_order: 23,
    is_fragment: true,
    parent_prompt_key: null,
    injection_channel: '未配置画风时',
  },
]

test('prompt rows use prompt key as stable identity', () => {
  assert.equal(promptRowKey(rows[0]), 'character.extraction.system')
})

test('project editor uses effective content while system editor uses system content', () => {
  assert.equal(effectivePromptContent(rows[0], true), 'project')
  assert.equal(effectivePromptContent(rows[0], false), 'system')
})

test('prompt filters combine category, template type and keyword', () => {
  assert.deepEqual(
    filterPromptItems(rows, { sceneKey: 'role_extraction' }),
    [rows[0]]
  )
  assert.deepEqual(
    filterPromptItems(rows, { templateKind: 'conditional_child', keyword: 'anti_split' }),
    [rows[1]]
  )
  assert.equal(filterPromptItems(rows, { category: '不存在' }).length, 0)
})

test('prompt filters include technical injection metadata', () => {
  assert.deepEqual(
    filterPromptItems(rows, { keyword: '满足参考图条件' }),
    [rows[3]]
  )
  assert.deepEqual(
    filterPromptItems(rows, { templateKind: 'independent_technical' }),
    [rows[4]]
  )
})

test('prompt filters include workflow and secondary categories', () => {
  assert.deepEqual(
    filterPromptItems(rows, { subcategory: '全能模式' }),
    [rows[2], rows[3]]
  )
  assert.deepEqual(
    filterPromptItems(rows, { workflowStage: '视频' }),
    [rows[2], rows[3]]
  )
  assert.deepEqual(
    filterPromptItems(rows, { detailCategory: '剧本提取' }),
    [rows[0]]
  )
})

test('technical fragments are grouped under their runtime parent prompt', () => {
  assert.equal(rootPromptKey(rows[3], rows), 'omni.segment.user')
  const groups = groupPromptItems([rows[2], rows[3]], rows)
  assert.equal(groups.length, 1)
  assert.equal(groups[0].parent, rows[2])
  assert.deepEqual(groups[0].children, [rows[3]])
})

test('prompt groups are organized by numbered primary and secondary categories', () => {
  const groups = groupPromptItems([rows[2], rows[3]], rows)
  const sections = groupPromptSections(groups)
  assert.equal(sections.length, 1)
  assert.equal(sections[0].label, '视频')
  assert.equal(sections[0].order, 4)
  assert.equal(sections[0].subcategories[0].label, '全能模式')
  assert.equal(sections[0].subcategories[0].details[0].label, '')
  assert.deepEqual(sections[0].subcategories[0].details[0].groups, groups)
})

test('asset prompt groups expose the third-level usage category', () => {
  const groups = groupPromptItems([rows[0]], rows)
  const sections = groupPromptSections(groups)
  assert.equal(sections[0].label, '资产')
  assert.equal(sections[0].order, 2)
  assert.equal(sections[0].subcategories[0].label, '人物')
  assert.equal(sections[0].subcategories[0].details[0].label, '剧本提取')
  assert.deepEqual(sections[0].subcategories[0].details[0].groups, groups)
})

test('independent technical templates remain top-level groups', () => {
  assert.equal(rootPromptKey(rows[4], rows), 'image.reference_generation.user')
  const groups = groupPromptItems([rows[4]], rows)
  assert.equal(groups.length, 1)
  assert.equal(groups[0].parent, rows[4])
  assert.deepEqual(groups[0].children, [])
})

test('parentless fallback remains visible as a special conditional child', () => {
  assert.equal(rootPromptKey(rows[5], rows), 'image.default_cinematic_style')
  const groups = groupPromptItems([rows[5]], rows)
  assert.equal(groups.length, 1)
  assert.equal(groups[0].parent, rows[5])
  assert.deepEqual(groups[0].children, [])
})
