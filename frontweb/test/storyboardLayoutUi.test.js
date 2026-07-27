import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const source = fs.readFileSync(
  path.join(here, '..', 'src', 'views', 'FilmCreate.vue'),
  'utf8'
)

test('storyboards keep the original compact three-column card layout', () => {
  assert.match(source, /<div :id="'sb-' \+ sb\.id" class="sb-ctrl-bar">/)
  assert.doesNotMatch(source, /<div :id="'sb-' \+ sb\.id" class="storyboard-row">/)
  assert.match(source, /\.sb-ctrl-bar\s*\{[\s\S]*?scroll-margin-top:\s*72px;/)
  assert.match(source, /class="sb-ctrl-btn sb-ctrl-config-btn"/)
  assert.match(source, /class="sb-ctrl-btn sb-ctrl-mode-btn"/)
  assert.match(source, /class="sb-ctrl-first-last"/)
  assert.match(source, /class="storyboard-row"/)
  assert.match(source, /class="sb-panel sb-script"/)
  assert.match(source, /class="sb-panel sb-image sb-media-column--fixed"/)
  assert.match(source, /class="sb-panel sb-video sb-media-column--fixed sb-media-column--aligned"/)
  assert.match(source, />图片提示词</)
  assert.match(source, />视频提示词</)
  assert.doesNotMatch(source, /v-show="!collapsedStoryboardIds\.has\(sb\.id\)"/)
})

test('mode and first-last-frame controls stay in the card toolbar', () => {
  const modeControl = source.indexOf('class="sb-ctrl-btn sb-ctrl-mode-btn"')
  const firstLastControl = source.indexOf('class="sb-ctrl-first-last"')
  const insertControl = source.indexOf('title="在本镜头前增加一个分镜"', firstLastControl)
  assert.ok(modeControl >= 0)
  assert.ok(firstLastControl > modeControl)
  assert.ok(insertControl > firstLastControl)
  assert.match(source, /@change="\(v\) => onToggleSbFirstLastFrame\(sb, v\)"/)
  assert.match(source, /async function onToggleSbFirstLastFrame\(sb, enabled\)/)
})

test('per-storyboard settings dialog only contains detailed parameters', () => {
  assert.match(source, /v-model="showVideoParamsDialog"/)
  assert.match(source, /append-to-body/)
  assert.match(source, /@opened="restoreVideoParamsPageScroll"/)
  assert.match(source, /@closed="onVideoParamsDialogClosed"/)
  assert.match(source, /function restoreVideoParamsPageScroll\(\)/)
  assert.doesNotMatch(source, /<el-form-item label="本镜模式">/)
  assert.doesNotMatch(source, /setSbUseFirstLastFrameId\(videoParamsTarget\.id, v\)/)
  assert.match(source, /@click="onSaveVideoParams"/)
})

test('storyboard settings compare two-up textarea parameters with a tall prompt column', () => {
  const dialogStart = source.indexOf('v-model="showVideoParamsDialog"')
  const dialogEnd = source.indexOf('<!-- P1-2:', dialogStart)
  const dialog = source.slice(dialogStart, dialogEnd)

  assert.match(dialog, /width="min\(1180px, 96vw\)"/)
  assert.match(dialog, /class="vp-dialog-layout"/)
  assert.match(dialog, /class="vp-params-column"/)
  assert.match(dialog, /class="vp-content-section"/)
  assert.match(dialog, /class="vp-content-grid"/)
  assert.match(dialog, /v-model="sbTitle\[videoParamsTarget\.id\]"[\s\S]{0,100}type="textarea"/)
  assert.match(dialog, /v-model="sbLocation\[videoParamsTarget\.id\]"[\s\S]{0,100}type="textarea"/)
  assert.match(dialog, /v-model="sbTime\[videoParamsTarget\.id\]"[\s\S]{0,100}type="textarea"/)
  assert.match(dialog, /v-model="sbAtmosphere\[videoParamsTarget\.id\]"[\s\S]{0,100}type="textarea"/)
  assert.match(dialog, /<el-row :gutter="12">[\s\S]*?<el-form-item label="时长\(秒\)">[\s\S]*?<el-form-item label="景别">[\s\S]*?<\/el-row>/)
  assert.match(dialog, /<el-row :gutter="12">[\s\S]*?<el-form-item label="运镜">[\s\S]*?<el-form-item label="镜头视角">[\s\S]*?<\/el-row>/)
  assert.match(dialog, /<el-row :gutter="12">[\s\S]*?<el-form-item label="灯光">[\s\S]*?<el-form-item label="景深">[\s\S]*?<\/el-row>/)

  const formEnd = dialog.indexOf('</el-form>')
  const videoPromptColumn = dialog.indexOf('<aside class="vp-video-prompt-column">')
  assert.ok(videoPromptColumn > formEnd)
  assert.match(dialog, /class="vp-video-prompt-textarea"[\s\S]{0,50}readonly/)
  assert.match(source, /\.vp-dialog-layout\s*\{[\s\S]*?grid-template-columns:\s*minmax\(0, 1fr\) minmax\(320px, 0\.48fr\);/)
  assert.match(source, /--vp-config-column-height:\s*clamp\(420px, calc\(100vh - 220px\), 720px\);/)
  assert.match(source, /\.vp-params-column,\s*\n\.vp-video-prompt-column\s*\{[\s\S]*?height:\s*var\(--vp-config-column-height\);/)
  assert.match(source, /\.vp-video-prompt-column\s*\{[\s\S]*?position:\s*sticky;/)
  assert.match(source, /\.vp-content-section\s*\{[\s\S]*?flex:\s*1;/)
  assert.match(source, /\.vp-content-grid\s*\{[\s\S]*?grid-template-columns:\s*repeat\(2, minmax\(0, 1fr\)\);[\s\S]*?grid-template-rows:\s*repeat\(2, minmax\(64px, 1fr\)\);/)
  assert.match(source, /@media \(min-width: 901px\) and \(min-height: 900px\)\s*\{[\s\S]*?grid-template-columns:\s*minmax\(0, 1fr\);[\s\S]*?grid-template-rows:\s*repeat\(4, minmax\(60px, 76px\)\);/)
})

test('image and video prompts edit and save inline without an image prompt dialog', () => {
  assert.match(source, /v-model="sbImagePrompt\[sb\.id\]"/)
  assert.match(source, /:loading="savingSbImagePromptIds\.has\(sb\.id\)"/)
  assert.match(source, /@click="onSaveSbImagePrompt\(sb\)"/)
  assert.match(source, /async function onSaveSbImagePrompt\(sb\)/)
  assert.doesNotMatch(source, /showSbPromptDialog/)
  assert.doesNotMatch(source, /onOpenSbPromptDialog/)
  assert.doesNotMatch(source, /sbPromptImageText/)
  assert.match(source, /v-model="sbVideoPrompt\[sb\.id\]"/)
  assert.match(source, /@click="onSaveSbVideoPrompt\(sb\)"/)
  assert.match(source, /async function onSaveSbVideoPrompt\(sb\)/)
  assert.doesNotMatch(source, />手工编辑<\/el-button>/)
  assert.doesNotMatch(source, /v-model="sbPromptVideoText"/)
})

test('compact storyboard columns follow the asset, image, and video editing layout', () => {
  assert.doesNotMatch(source, /class="sb-script-row sb-script-selects"/)
  assert.match(source, /@click\.stop="onSbSelectSceneCommand\(sb\.id, '__clear__'\)"/)
  assert.match(source, /@click\.stop="onSbRemoveCharacter\(sb\.id, c\.id\)"/)
  assert.match(source, /@click\.stop="onSbRemoveProp\(sb\.id, p\.id\)"/)
  assert.match(source, /@command="\(cmd\) => onSbAddPropCommand\(sb\.id, cmd\)"/)
  assert.match(source, /\.sb-selected-thumbs\s*\{[\s\S]*?min-height:\s*260px;/)

  const imageHistory = source.indexOf('class="sb-image-history sb-media-history"')
  const imageActions = source.indexOf('class="sb-image-actions sb-media-actions"', imageHistory)
  const polishedPrompt = source.indexOf('class="sb-polished-prompt-section sb-media-prompt-section"', imageActions)
  assert.ok(imageHistory >= 0)
  assert.ok(imageActions > imageHistory)
  assert.ok(polishedPrompt > imageActions)
  assert.match(source, />历史分镜图片</)
  assert.match(source, /label:\s*img\.superseded \? '已过期' : currentLabel \|\| `历史\$\{\+\+historyIndex\}`/)
  assert.match(source, />图片优化提示词</)
  assert.doesNotMatch(source, /通用优化提示词/)
  assert.match(source, /@click="onSaveSbPolishedPrompt\(sb\)"/)
  assert.match(source, /async function onSaveSbPolishedPrompt\(sb\)/)

  assert.match(source, /\.sb-video-params-bar\s*\{[\s\S]*?align-items:\s*center;/)
  assert.match(source, /\.sb-video-prompt-inline-input :deep\(\.el-textarea__inner\)\s*\{[\s\S]*?height:\s*180px !important;/)
  assert.match(source, /\.sb-polished-prompt-input :deep\(\.el-textarea__inner\)\s*\{[\s\S]*?height:\s*180px !important;/)
})

test('image and video columns use matching media block heights', () => {
  assert.match(
    source,
    /class="sb-panel sb-image sb-media-column--fixed"/
  )
  assert.match(
    source,
    /class="sb-panel sb-video sb-media-column--fixed sb-media-column--aligned"/
  )
  assert.match(
    source,
    /\.sb-panel\.sb-media-column--fixed\s*\{[\s\S]*?height:\s*864px;[\s\S]*?max-height:\s*864px;/
  )
  assert.match(
    source,
    /\.sb-panel\.sb-media-column--aligned\s*\{[\s\S]*?grid-template-rows:\s*400px 160px 38px 220px;[\s\S]*?gap:\s*6px;/
  )
  assert.match(source, /\.sb-media-column--aligned \.sb-img-thumb\s*\{[\s\S]*?width:\s*104px;[\s\S]*?height:\s*104px;/)
  assert.match(source, /\.sb-media-column--aligned \.sb-video-thumb\s*\{[\s\S]*?width:\s*144px;[\s\S]*?height:\s*104px;/)
  assert.match(
    source,
    /\.sb-panel\.sb-media-column--first-last\s*\{[\s\S]*?grid-template-rows:\s*minmax\(0, 1fr\) 38px;/
  )
  assert.match(
    source,
    /\.sb-media-column--first-last \.sb-fl-dual\s*\{[\s\S]*?grid-template-rows:\s*16px minmax\(210px, 1fr\) 36px 66px 154px 154px;/
  )
  assert.match(source, /@click="onSelectFrameHistoryItem\(sb, item, 'first'\)"/)
  assert.match(source, /@click="onSelectFrameHistoryItem\(sb, item, 'last'\)"/)
  assert.match(source, /class="sb-frame-history-card__label">\{\{ item\.label \}\}<\/span>/)
  assert.doesNotMatch(source, /class="sb-frame-history-card__footer"/)
  assert.match(
    source,
    /\.sb-media-column--first-last \.sb-fl-slot:first-child > \.sb-frame-history\s*\{[\s\S]*?grid-row:\s*5;/
  )
  assert.match(
    source,
    /\.sb-media-column--first-last \.sb-fl-slot:last-child > \.sb-frame-history\s*\{[\s\S]*?grid-row:\s*6;/
  )

  const videoPanel = source.indexOf('class="sb-panel sb-video sb-media-column--fixed sb-media-column--aligned"')
  const videoArea = source.indexOf('class="sb-video-area', videoPanel)
  const videoHistory = source.indexOf('class="sb-video-history sb-media-history"', videoArea)
  const videoActions = source.indexOf('class="sb-video-actions sb-media-actions"', videoHistory)
  const videoPrompt = source.indexOf('class="sb-video-prompt-section sb-media-prompt-section"', videoActions)
  assert.ok(videoPanel >= 0)
  assert.ok(videoArea > videoPanel)
  assert.ok(videoHistory > videoArea)
  assert.ok(videoActions > videoHistory)
  assert.ok(videoPrompt > videoActions)
  assert.match(source, />历史分镜视频</)
  assert.match(source, />暂无历史分镜视频</)
  assert.match(source, /:class="\{ 'is-current': item\.isCurrent, 'is-superseded': item\.isSuperseded \}"/)
  assert.doesNotMatch(source, /\.filter\(\(v\) => !current \|\| v\.id !== current\.id\)/)

  const fixedPromptRows = source.match(/:rows="8"/g) || []
  assert.ok(fixedPromptRows.length >= 2)
})
