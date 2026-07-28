import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const configSource = fs.readFileSync(
  path.join(here, '..', 'src', 'components', 'AIConfigContent.vue'),
  'utf8'
)
const workbenchSource = fs.readFileSync(
  path.join(here, '..', 'src', 'styles', 'workbench-v1.css'),
  'utf8'
)
const filmCreateSource = fs.readFileSync(
  path.join(here, '..', 'src', 'views', 'FilmCreate.vue'),
  'utf8'
)
const characterApiSource = fs.readFileSync(
  path.join(here, '..', 'src', 'api', 'characters.js'),
  'utf8'
)

test('AI config uses the available workspace width', () => {
  assert.match(
    workbenchSource,
    /\.ai-config \.main\s*\{[\s\S]*?max-width:\s*none !important;[\s\S]*?margin:\s*0 !important;/
  )
  assert.doesNotMatch(
    workbenchSource,
    /\.ai-config \.main,\s*\n\.project-prompts \.main\s*\{[\s\S]*?max-width:\s*1240px/
  )
})

test('AI config tabs share one workbench surface and consistent spacing', () => {
  assert.match(configSource, /\.config-tabs :deep\(\.el-tabs__header\)\s*\{/)
  assert.match(configSource, /\.config-tabs :deep\(\.el-tabs__content\)\s*\{[\s\S]*?padding:\s*24px;/)
  assert.match(configSource, /\.content-actions\s*\{[\s\S]*?background:\s*var\(--bg-panel\);/)
  assert.match(configSource, /\.default-tip\s*\{[\s\S]*?border-left:\s*3px solid var\(--module-accent\);/)
})

test('generation and embedded tabs inherit the global workbench design tokens', () => {
  assert.equal((configSource.match(/<section class="settings-card">/g) || []).length, 2)
  assert.match(
    configSource,
    /\.generation-settings\s*\{[\s\S]*?grid-template-columns:\s*repeat\(2, minmax\(0, 1fr\)\);/
  )
  assert.match(
    configSource,
    /\.ai-records-tab :deep\(\.ai-records-page\.ai-records-page--embedded\)\s*\{[\s\S]*?--record-accent:\s*var\(--brand\);/
  )
  assert.match(
    configSource,
    /\.ai-records-tab :deep\(\.ai-records-page--embedded \.content\)\s*\{[\s\S]*?margin:\s*0 !important;/
  )
  assert.match(
    configSource,
    /\.config-tabs :deep\(\.prompt-editor\)\s*\{[\s\S]*?background:\s*transparent !important;/
  )
})

test('unused SD2 asset management and certification UI stay removed', () => {
  for (const source of [configSource, filmCreateSource, characterApiSource]) {
    assert.doesNotMatch(source, /jimeng2_character_auth|model_ark_asset|sd2-certify|sd2-voice/)
  }
  assert.doesNotMatch(configSource, /SD2 资产管理|Sd2AssetManagement/)
  assert.doesNotMatch(filmCreateSource, /seedance2_asset|seedance2_voice_asset|SD2 认证详情/)
})
