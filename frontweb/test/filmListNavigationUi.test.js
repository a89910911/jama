import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const filmListSource = fs.readFileSync(
  path.join(here, '..', 'src', 'views', 'FilmList.vue'),
  'utf8'
)
const appSource = fs.readFileSync(
  path.join(here, '..', 'src', 'App.vue'),
  'utf8'
)

test('project home has no page-level tab header', () => {
  assert.doesNotMatch(filmListSource, /<header class="header">/)
  assert.doesNotMatch(filmListSource, /class="header-library"/)
  assert.doesNotMatch(filmListSource, /class="header-actions"/)
})

test('project actions and shared libraries remain available in content modules', () => {
  assert.match(filmListSource, /class="project-card action-card"/)
  assert.match(filmListSource, /@click="goNewProject"/)
  assert.match(filmListSource, /@click="triggerImport"/)
  assert.match(filmListSource, /class="project-card library-card"/)
  assert.match(filmListSource, /公共素材库/)
  assert.match(filmListSource, /@click="showCharLibrary = true"/)
  assert.match(filmListSource, /@click="showSceneLibrary = true"/)
  assert.match(filmListSource, /@click="showPropLibrary = true"/)
})

test('global functions and account menu live in the activity rail', () => {
  assert.match(appSource, /<AccountSession compact \/>/)
  assert.match(appSource, /to: '\/redraw'/)
  assert.match(appSource, /to: '\/action-migration'/)
  assert.match(appSource, /to: '\/ai-config'/)
  assert.match(appSource, /class="activity-item activity-theme"/)
})
