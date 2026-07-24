import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const source = fs.readFileSync(
  path.join(here, '..', 'src', 'components', 'AIConfigContent.vue'),
  'utf8'
)

test('video audio is visibly locked on and presets cannot disable it', () => {
  assert.match(source, /<el-switch :model-value="true" disabled \/>/)
  assert.match(source, /baseS\.generate_audio = true/)
  assert.doesNotMatch(source, /generate_audio:\s*false/)
})
