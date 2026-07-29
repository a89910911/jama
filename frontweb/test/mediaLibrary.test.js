import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'

const source = fs.readFileSync(new URL('../src/views/MediaLibrary.vue', import.meta.url), 'utf8')
const uploadApi = fs.readFileSync(new URL('../src/api/upload.js', import.meta.url), 'utf8')

test('media library uses the upload-and-register endpoint for images and videos', () => {
  assert.match(source, /accept="image\/\*,video\/\*"/)
  assert.match(source, /uploadAPI\.uploadMediaAsset\(file\)/)
  assert.match(uploadApi, /request\.post\('\/assets\/upload'/)
})

test('media library maps persisted file_size for display', () => {
  assert.match(source, /size:\s*item\.size\s*\?\?\s*item\.file_size/)
})
