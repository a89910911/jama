const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const Database = require('better-sqlite3');
const AdmZip = require('adm-zip');
const sharp = require('sharp');
const {
  safeBaseName,
  normalizeExportScope,
  exportEpisodeAssets,
} = require('../src/services/assetExportService');

function createSchema(db) {
  db.exec(`
    CREATE TABLE dramas (
      id INTEGER PRIMARY KEY,
      title TEXT,
      deleted_at TEXT
    );
    CREATE TABLE episodes (
      id INTEGER PRIMARY KEY,
      drama_id INTEGER,
      episode_number INTEGER,
      title TEXT,
      deleted_at TEXT
    );
    CREATE TABLE characters (
      id INTEGER PRIMARY KEY,
      drama_id INTEGER,
      name TEXT,
      local_path TEXT,
      image_url TEXT,
      sort_order INTEGER,
      deleted_at TEXT
    );
    CREATE TABLE episode_characters (
      episode_id INTEGER,
      character_id INTEGER
    );
    CREATE TABLE scenes (
      id INTEGER PRIMARY KEY,
      drama_id INTEGER,
      episode_id INTEGER,
      location TEXT,
      local_path TEXT,
      image_url TEXT,
      deleted_at TEXT
    );
    CREATE TABLE props (
      id INTEGER PRIMARY KEY,
      drama_id INTEGER,
      episode_id INTEGER,
      name TEXT,
      local_path TEXT,
      image_url TEXT,
      deleted_at TEXT
    );
    CREATE TABLE storyboards (
      id INTEGER PRIMARY KEY,
      episode_id INTEGER,
      storyboard_number INTEGER,
      title TEXT,
      first_frame_image_id INTEGER,
      deleted_at TEXT
    );
    CREATE TABLE storyboard_props (
      storyboard_id INTEGER,
      prop_id INTEGER
    );
    CREATE TABLE image_generations (
      id INTEGER PRIMARY KEY,
      storyboard_id INTEGER,
      local_path TEXT,
      image_url TEXT,
      status TEXT,
      frame_type TEXT,
      created_at TEXT,
      deleted_at TEXT
    );
    CREATE TABLE video_generations (
      id INTEGER PRIMARY KEY,
      storyboard_id INTEGER,
      local_path TEXT,
      video_url TEXT,
      status TEXT,
      created_at TEXT,
      deleted_at TEXT
    );
  `);
}

test('按资产名称导出 ZIP，图片转 JPG、视频保持 MP4，并处理重名', async (t) => {
  const storageDir = fs.mkdtempSync(path.join(os.tmpdir(), 'jama-export-test-'));
  const db = new Database(':memory:');
  t.after(() => {
    db.close();
    fs.rmSync(storageDir, { recursive: true, force: true });
  });
  createSchema(db);

  fs.mkdirSync(path.join(storageDir, 'media'), { recursive: true });
  const png = await sharp({
    create: {
      width: 4,
      height: 4,
      channels: 4,
      background: { r: 255, g: 0, b: 0, alpha: 0.5 },
    },
  }).png().toBuffer();
  fs.writeFileSync(path.join(storageDir, 'media', 'character.png'), png);
  fs.writeFileSync(path.join(storageDir, 'media', 'character2.png'), png);
  fs.writeFileSync(path.join(storageDir, 'media', 'scene.webp'), await sharp(png).webp().toBuffer());
  fs.writeFileSync(path.join(storageDir, 'media', 'prop.png'), png);
  fs.writeFileSync(path.join(storageDir, 'media', 'storyboard.png'), png);
  const mp4Bytes = Buffer.from('fake-mp4-for-export-test');
  fs.writeFileSync(path.join(storageDir, 'media', 'storyboard.mp4'), mp4Bytes);

  db.exec(`
    INSERT INTO dramas VALUES (1, '测试短剧', NULL);
    INSERT INTO episodes VALUES (10, 1, 1, '开场', NULL);
    INSERT INTO characters VALUES (100, 1, '阿明', 'media/character.png', NULL, 1, NULL);
    INSERT INTO characters VALUES (101, 1, '阿明', 'media/character2.png', NULL, 2, NULL);
    INSERT INTO episode_characters VALUES (10, 100);
    INSERT INTO episode_characters VALUES (10, 101);
    INSERT INTO scenes VALUES (200, 1, 10, '办公室', 'media/scene.webp', NULL, NULL);
    INSERT INTO props VALUES (300, 1, 10, '钥匙', 'media/prop.png', NULL, NULL);
    INSERT INTO storyboards VALUES (400, 10, 1, '阿明', 500, NULL);
    INSERT INTO image_generations VALUES (
      500, 400, 'media/storyboard.png', NULL, 'completed', 'storyboard_first', '2026-07-19T00:00:00Z', NULL
    );
    INSERT INTO video_generations VALUES (
      600, 400, 'media/storyboard.mp4', NULL, 'completed', '2026-07-19T00:00:00Z', NULL
    );
  `);

  const result = await exportEpisodeAssets(
    db,
    { storage: { local_path: storageDir } },
    { warn() {} },
    1,
    10
  );
  assert.equal(result.filename, '测试短剧-开场-资产');
  assert.equal(result.count, 6);
  assert.equal(result.skipped, 0);

  const zip = new AdmZip(result.buffer);
  const names = zip.getEntries().map((entry) => entry.entryName).sort();
  assert.deepEqual(names, [
    '分镜图片/分镜1_阿明.jpg',
    '分镜视频/分镜1_阿明.mp4',
    '场景/办公室.jpg',
    '角色/阿明.jpg',
    '角色/阿明_2.jpg',
    '道具/钥匙.jpg',
  ].sort());

  for (const name of names.filter((entry) => entry.endsWith('.jpg'))) {
    const bytes = zip.readFile(name);
    assert.equal(bytes[0], 0xff);
    assert.equal(bytes[1], 0xd8);
  }
  assert.deepEqual(zip.readFile('分镜视频/分镜1_阿明.mp4'), mp4Bytes);

  const scopedCases = [
    {
      scope: 'characters',
      filename: '测试短剧-开场-角色资产',
      entries: ['角色/阿明.jpg', '角色/阿明_2.jpg'],
    },
    {
      scope: 'scenes',
      filename: '测试短剧-开场-场景资产',
      entries: ['场景/办公室.jpg'],
    },
    {
      scope: 'props',
      filename: '测试短剧-开场-道具资产',
      entries: ['道具/钥匙.jpg'],
    },
    {
      scope: 'storyboard_videos',
      filename: '测试短剧-开场-分镜视频',
      entries: ['分镜视频/分镜1_阿明.mp4'],
    },
  ];
  for (const scopedCase of scopedCases) {
    const scopedResult = await exportEpisodeAssets(
      db,
      { storage: { local_path: storageDir } },
      { warn() {} },
      1,
      10,
      { scope: scopedCase.scope }
    );
    assert.equal(scopedResult.filename, scopedCase.filename);
    assert.equal(scopedResult.scope, scopedCase.scope);
    assert.equal(scopedResult.count, scopedCase.entries.length);
    assert.deepEqual(
      new AdmZip(scopedResult.buffer).getEntries().map((entry) => entry.entryName).sort(),
      [...scopedCase.entries].sort()
    );
  }
});

test('导出文件名会移除 Windows 非法字符', () => {
  assert.equal(safeBaseName(' 角色：A/B*? '), '角色：A_B__');
  assert.equal(safeBaseName('...'), '未命名');
});

test('导出范围只接受受支持的资产类型', () => {
  assert.equal(normalizeExportScope(), 'all');
  assert.equal(normalizeExportScope('PROPS'), 'props');
  assert.throws(
    () => normalizeExportScope('unknown'),
    (err) => err.code === 'INVALID_EXPORT_SCOPE'
  );
});
