const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const Database = require('better-sqlite3');

const createUploadRoutes = require('../src/routes/upload').routes;
const assetService = require('../src/services/assetService');

function createDb() {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE assets (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      drama_id INTEGER,
      name TEXT,
      description TEXT,
      type TEXT,
      category TEXT,
      url TEXT,
      local_path TEXT,
      thumbnail_url TEXT,
      file_size INTEGER,
      mime_type TEXT,
      width INTEGER,
      height INTEGER,
      duration REAL,
      image_gen_id INTEGER,
      video_gen_id INTEGER,
      is_favorite INTEGER,
      created_at TEXT,
      updated_at TEXT,
      deleted_at TEXT
    );
  `);
  return db;
}

function createResponse() {
  return {
    statusCode: null,
    payload: null,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(payload) {
      this.payload = payload;
      return this;
    },
  };
}

test('media library upload persists an image file and registers a searchable asset', () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'jama-media-upload-'));
  const db = createDb();
  const log = { info() {}, error() {} };
  const routes = createUploadRoutes(
    { storage: { local_path: tempDir, base_url: '' } },
    log,
    db
  );
  const req = {
    body: {},
    file: {
      buffer: Buffer.from('test-image'),
      originalname: '生产验收镜头.jpg',
      mimetype: 'image/jpeg',
      size: 10,
    },
  };
  const res = createResponse();

  try {
    routes.uploadMediaAsset(req, res);
    assert.equal(res.statusCode, 201);
    assert.equal(res.payload.data.name, '生产验收镜头.jpg');
    assert.equal(res.payload.data.type, 'image');
    assert.equal(res.payload.data.file_size, 10);
    assert.equal(res.payload.data.mime_type, 'image/jpeg');
    assert.ok(fs.existsSync(path.join(tempDir, res.payload.data.local_path)));

    const results = assetService.list(db, { keyword: '验收', type: 'image' });
    assert.equal(results.total, 1);
    assert.equal(results.items[0].name, '生产验收镜头.jpg');
  } finally {
    db.close();
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});

test('media library upload registers video metadata', () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'jama-media-upload-'));
  const db = createDb();
  const routes = createUploadRoutes(
    { storage: { local_path: tempDir, base_url: '' } },
    { info() {}, error() {} },
    db
  );
  const res = createResponse();

  try {
    routes.uploadMediaAsset({
      body: {},
      file: {
        buffer: Buffer.from('test-video'),
        originalname: '成片.mp4',
        mimetype: 'video/mp4',
        size: 10,
      },
    }, res);
    assert.equal(res.statusCode, 201);
    assert.equal(res.payload.data.type, 'video');
    assert.equal(res.payload.data.mime_type, 'video/mp4');
  } finally {
    db.close();
    fs.rmSync(tempDir, { recursive: true, force: true });
  }
});
