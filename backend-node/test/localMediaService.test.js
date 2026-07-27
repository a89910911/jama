const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const {
  assertNoDataUrls,
  containsDataUrl,
  existingLocalMedia,
  normalizeDataUrlsForPersistence,
  persistDataUrlToLocal,
} = require('../src/services/localMediaService');
const { assertSafeWrite } = require('../src/db/dataUrlPersistenceGuard');
const {
  downloadVideoToLocal,
  resolveRemoteVideoUrl,
} = require('../src/services/videoService');

function tempStorage(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'jama-base64-media-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  return directory;
}

test('Base64 media is saved once and exposed through /static', (t) => {
  const storagePath = tempStorage(t);
  const dataUrl = `data:image/png;base64,${Buffer.from('png-bytes').toString('base64')}`;
  const first = persistDataUrlToLocal(dataUrl, {
    storagePath,
    category: 'images',
    prefix: 'model',
  });
  const second = persistDataUrlToLocal(dataUrl, {
    storagePath,
    category: 'images',
    prefix: 'model',
  });

  assert.equal(first.local_path, second.local_path);
  assert.equal(first.url, `/static/${first.local_path}`);
  assert.deepEqual(fs.readFileSync(first.absolute_path), Buffer.from('png-bytes'));
  assert.equal(existingLocalMedia(storagePath, first.url).local_path, first.local_path);
});

test('normalizer reuses a valid sibling local_path instead of decoding a duplicate', (t) => {
  const storagePath = tempStorage(t);
  const relative = 'projects/1/images/existing.png';
  const absolute = path.join(storagePath, ...relative.split('/'));
  fs.mkdirSync(path.dirname(absolute), { recursive: true });
  fs.writeFileSync(absolute, Buffer.from('already-local'));
  const dataUrl = `data:image/png;base64,${Buffer.from('duplicate').toString('base64')}`;

  const normalized = normalizeDataUrlsForPersistence({
    image_url: dataUrl,
    local_path: relative,
  }, { storagePath });

  assert.deepEqual(normalized.value, {
    image_url: `/static/${relative}`,
    local_path: relative,
  });
  assert.equal(normalized.replacements, 1);
  assert.equal(normalized.files.length, 0);
  assert.deepEqual(fs.readFileSync(absolute), Buffer.from('already-local'));
});

test('normalizer handles Base64 nested inside serialized JSON', (t) => {
  const storagePath = tempStorage(t);
  const dataUrl = `data:audio/wav;base64,${Buffer.from('wave').toString('base64')}`;
  const normalized = normalizeDataUrlsForPersistence(
    JSON.stringify({ result: { audio_url: dataUrl } }),
    {
      storagePath,
      category: 'task-results',
      prefix: 'task',
    }
  );
  const parsed = JSON.parse(normalized.value);

  assert.match(parsed.result.audio_url, /^\/static\/task-results\//);
  assert.match(parsed.result.local_path, /^task-results\//);
  assert.equal(containsDataUrl(normalized.value), false);
  assert.equal(fs.existsSync(path.join(storagePath, parsed.result.local_path)), true);
});

test('database write guard blocks Data URLs but allows local URLs and read parameters', () => {
  const dataUrl = 'data:image/png;base64,AAAA';
  assert.throws(
    () => assertNoDataUrls([dataUrl]),
    (error) => error.code === 'BASE64_PERSISTENCE_BLOCKED'
  );
  assert.throws(
    () => assertSafeWrite('UPDATE images SET image_url = ?', [dataUrl]),
    (error) => error.code === 'BASE64_PERSISTENCE_BLOCKED'
  );
  assert.doesNotThrow(() =>
    assertSafeWrite('UPDATE images SET image_url = ?', ['/static/images/a.png'])
  );
  assert.doesNotThrow(() =>
    assertSafeWrite('SELECT * FROM images WHERE image_url = ?', [dataUrl])
  );
});

test('Base64 video model output is accepted, saved locally, and returned as a local path', async (t) => {
  const storagePath = tempStorage(t);
  const bytes = Buffer.from('fake-mp4');
  const dataUrl = `data:video/mp4;base64,${bytes.toString('base64')}`;
  const resolved = resolveRemoteVideoUrl(dataUrl);
  const localPath = await downloadVideoToLocal(
    storagePath,
    resolved.video_url,
    42,
    { info() {}, warn() {} },
    'projects/42'
  );

  assert.equal(resolved.ok, true);
  assert.match(localPath, /^projects\/42\/videos\/vg_42_/);
  assert.deepEqual(
    fs.readFileSync(path.join(storagePath, ...localPath.split('/'))),
    bytes
  );
});
