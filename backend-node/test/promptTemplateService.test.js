const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');
const promptTemplates = require('../src/services/promptTemplateService');
const taskService = require('../src/services/taskService');
const episodeStoryboardService = require('../src/services/episodeStoryboardService');
const { routes: buildPromptRoutes } = require('../src/routes/prompts');
const { listBusinessScenes } = require('../src/services/businessSceneRegistry');
const { buildCatalog } = require('../src/services/promptCatalog');

function createDb({ legacyOverride = false, legacySceneMap = false } = {}) {
  const db = new Database(':memory:');
  db.exec(`
    PRAGMA foreign_keys = ON;
    CREATE TABLE dramas (
      id INTEGER PRIMARY KEY,
      title TEXT,
      deleted_at TEXT
    );
    CREATE TABLE episodes (
      id INTEGER PRIMARY KEY,
      drama_id INTEGER,
      deleted_at TEXT
    );
    CREATE TABLE storyboards (
      id INTEGER PRIMARY KEY,
      episode_id INTEGER,
      deleted_at TEXT
    );
    CREATE TABLE characters (
      id INTEGER PRIMARY KEY,
      drama_id INTEGER,
      deleted_at TEXT
    );
    CREATE TABLE scenes (
      id INTEGER PRIMARY KEY,
      drama_id INTEGER,
      deleted_at TEXT
    );
    CREATE TABLE props (
      id INTEGER PRIMARY KEY,
      drama_id INTEGER,
      deleted_at TEXT
    );
    CREATE TABLE global_settings (
      key TEXT PRIMARY KEY,
      value TEXT,
      updated_at TEXT
    );
    CREATE TABLE prompt_overrides (
      key TEXT PRIMARY KEY,
      content TEXT,
      updated_at TEXT
    );
    CREATE TABLE ai_model_map (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      key TEXT UNIQUE,
      service_type TEXT,
      config_id INTEGER,
      model_override TEXT,
      description TEXT,
      created_at TEXT,
      updated_at TEXT
    );
    CREATE TABLE async_tasks (
      id TEXT PRIMARY KEY,
      type TEXT,
      status TEXT,
      progress INTEGER DEFAULT 0,
      message TEXT,
      error TEXT,
      result TEXT,
      resource_id TEXT,
      created_at TEXT,
      updated_at TEXT,
      completed_at TEXT,
      deleted_at TEXT
    );
    INSERT INTO dramas (id, title) VALUES (1, 'Project A'), (2, 'Project B');
    INSERT INTO episodes (id, drama_id) VALUES (11, 1);
    INSERT INTO storyboards (id, episode_id) VALUES (111, 11);
    INSERT INTO characters (id, drama_id) VALUES (211, 1);
    INSERT INTO scenes (id, drama_id) VALUES (311, 1);
    INSERT INTO props (id, drama_id) VALUES (411, 1);
  `);
  if (legacyOverride) {
    db.prepare('INSERT INTO prompt_overrides (key, content, updated_at) VALUES (?, ?, ?)')
      .run('character_extraction', 'LEGACY CHARACTER PROMPT', '2026-01-01T00:00:00.000Z');
  }
  if (legacySceneMap) {
    db.prepare(`
      INSERT INTO ai_model_map
        (key, service_type, config_id, model_override, description, created_at, updated_at)
      VALUES ('image_polish', 'text', 7, 'claude-sonnet', 'legacy', 'now', 'now')
    `).run();
  }
  const migration = fs.readFileSync(
    path.join(__dirname, '..', 'migrations', '23_prompt_templates.sql'),
    'utf8'
  );
  db.exec(migration);
  return db;
}

function mockResponse() {
  return {
    statusCode: 200,
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

const log = {
  info() {},
  warn() {},
  error() {},
};

describe('prompt template catalog and resolution', () => {
  it('seeds the complete catalog and all locale variants idempotently', () => {
    const db = createDb();
    const first = promptTemplates.ensurePromptCatalog(db);
    const second = promptTemplates.ensurePromptCatalog(db);
    assert.equal(first.seeded, 102);
    assert.equal(second.seeded, 102);
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM prompt_definitions').get().n, 102);
    assert.equal(
      db.prepare("SELECT COUNT(*) AS n FROM prompt_templates WHERE scope = 'system'").get().n,
      146
    );
    assert.equal(promptTemplates.listPrompts(db).length, 146);
    assert.ok(
      db.prepare(`
        SELECT 1 FROM prompt_definitions
        WHERE message_role = 'negative_prompt' AND prompt_key = 'image.negative.anti_split'
      `).get()
    );
    db.close();
  });

  it('upgrades untouched seed content while preserving edited system content', () => {
    const db = createDb();
    promptTemplates.ensurePromptCatalog(db);
    const row = db.prepare(`
      SELECT t.id, t.content, t.seed_content, t.version
      FROM prompt_templates t
      JOIN prompt_definitions d ON d.id = t.definition_id
      WHERE d.prompt_key = 'storyboard.generation.user'
        AND t.scope = 'system' AND t.locale = 'zh'
    `).get();
    db.prepare(
      'UPDATE prompt_templates SET content = ?, seed_content = ?, seed_version = 1 WHERE id = ?'
    ).run('OLD SEED', 'OLD SEED', row.id);
    promptTemplates.ensurePromptCatalog(db);
    const upgraded = db.prepare(
      'SELECT content, seed_content, seed_version, version FROM prompt_templates WHERE id = ?'
    ).get(row.id);
    assert.notEqual(upgraded.content, 'OLD SEED');
    assert.equal(upgraded.content, upgraded.seed_content);
    assert.equal(upgraded.seed_version, 2);

    db.prepare(
      'UPDATE prompt_templates SET content = ?, seed_content = ?, seed_version = 1 WHERE id = ?'
    ).run('USER CUSTOM CONTENT', 'OLDER SEED', row.id);
    promptTemplates.ensurePromptCatalog(db);
    const preserved = db.prepare(
      'SELECT content, seed_content, seed_version FROM prompt_templates WHERE id = ?'
    ).get(row.id);
    assert.equal(preserved.content, 'USER CUSTOM CONTENT');
    assert.notEqual(preserved.seed_content, 'OLDER SEED');
    assert.equal(preserved.seed_version, 2);

    const frameDef = db.prepare(
      "SELECT id FROM prompt_definitions WHERE prompt_key = 'frame.first.user'"
    ).get();
    const now = new Date().toISOString();
    const obsolete = db.prepare(`
      INSERT INTO prompt_templates
        (definition_id, scope, drama_id, locale, content, seed_content, seed_version, version, created_at, updated_at)
      VALUES (?, 'system', NULL, 'universal', ?, ?, 1, 1, ?, ?)
    `).run(frameDef.id, 'OLD UNIVERSAL', 'OLD UNIVERSAL', now, now);
    promptTemplates.ensurePromptCatalog(db);
    assert.ok(
      db.prepare('SELECT deleted_at FROM prompt_templates WHERE id = ?')
        .get(obsolete.lastInsertRowid).deleted_at
    );

    const editedObsolete = db.prepare(`
      INSERT INTO prompt_templates
        (definition_id, scope, drama_id, locale, content, seed_content, seed_version, version, created_at, updated_at)
      VALUES (?, 'system', NULL, 'universal', ?, ?, 1, 2, ?, ?)
    `).run(frameDef.id, 'USER UNIVERSAL', 'OLD UNIVERSAL', now, now);
    promptTemplates.ensurePromptCatalog(db);
    assert.equal(
      db.prepare('SELECT deleted_at FROM prompt_templates WHERE id = ?')
        .get(editedObsolete.lastInsertRowid).deleted_at,
      null
    );
    db.close();
  });

  it('uses project override first, isolates projects, and infers drama from context', () => {
    const db = createDb();
    promptTemplates.ensurePromptCatalog(db);
    const key = 'character.identity_anchors.user';
    const system = promptTemplates.resolvePromptContent(db, key, {
      locale: 'en',
      variables: { character_appearance: 'chapter' },
    });
    assert.match(system, /chapter/i);

    promptTemplates.updateProjectPrompt(
      db,
      1,
      key,
      'universal',
      'PROJECT-A {{character_appearance}}',
      null
    );
    const projectA = promptTemplates.resolvePrompt(db, key, {
      dramaId: 1,
      locale: 'universal',
      variables: { character_appearance: 'chapter' },
    });
    const projectByStoryboard = promptTemplates.resolvePrompt(db, key, {
      storyboardId: 111,
      locale: 'universal',
      variables: { character_appearance: 'chapter' },
    });
    const projectB = promptTemplates.resolvePrompt(db, key, {
      dramaId: 2,
      locale: 'universal',
      variables: { character_appearance: 'chapter' },
    });
    assert.equal(projectA.content, 'PROJECT-A chapter');
    assert.equal(projectA.scope, 'project');
    assert.equal(projectByStoryboard.content, 'PROJECT-A chapter');
    assert.equal(projectB.scope, 'system');
    assert.notEqual(projectB.content, projectA.content);
    db.close();
  });

  it('falls back to system universal but never crosses from zh to en', () => {
    const db = createDb();
    promptTemplates.ensurePromptCatalog(db);
    const universal = promptTemplates.resolvePrompt(db, 'character.identity_anchors.user', {
      locale: 'en',
      variables: { character_appearance: 'hello' },
    });
    assert.equal(universal.locale, 'universal');

    db.prepare(`
      UPDATE prompt_templates SET deleted_at = 'now'
      WHERE definition_id = (
        SELECT id FROM prompt_definitions WHERE prompt_key = 'story.generation.system'
      ) AND scope = 'system' AND locale = 'zh'
    `).run();
    assert.throws(
      () => promptTemplates.resolvePrompt(db, 'story.generation.system', {
        locale: 'zh',
        variables: { episode_count: 3 },
      }),
      (err) => err.code === 'PROMPT_TEMPLATE_NOT_FOUND'
    );
    db.close();
  });

  it('validates variables, handles optimistic conflicts, and restores seed content', () => {
    const db = createDb();
    promptTemplates.ensurePromptCatalog(db);
    const key = 'character.identity_anchors.user';
    const row = promptTemplates.listPrompts(db).find(
      (item) => item.prompt_key === key && item.locale === 'universal'
    );
    assert.throws(
      () => promptTemplates.updateSystemPrompt(db, key, 'universal', 'missing variable', row.system_version),
      (err) => err.code === 'PROMPT_VALIDATION_FAILED'
    );
    const updated = promptTemplates.updateSystemPrompt(
      db,
      key,
      'universal',
      'CUSTOM {{character_appearance}}',
      row.system_version
    );
    assert.equal(updated.version, row.system_version + 1);
    assert.throws(
      () => promptTemplates.updateSystemPrompt(
        db,
        key,
        'universal',
        'STALE {{character_appearance}}',
        row.system_version
      ),
      (err) => err.code === 'VERSION_CONFLICT'
    );
    const reset = promptTemplates.resetSystemPrompt(
      db,
      key,
      'universal',
      updated.version
    );
    assert.equal(reset.content, row.seed_content);
    assert.equal(reset.version, updated.version + 1);
    db.close();
  });

  it('migrates legacy overrides and split scene routes only once', () => {
    const db = createDb({ legacyOverride: true, legacySceneMap: true });
    const result = promptTemplates.ensurePromptCatalog(db);
    assert.equal(result.legacyMigrated, 1);
    assert.equal(result.sceneMapsMigrated, 4);
    const migrated = promptTemplates.resolvePrompt(db, 'character.extraction.system', {
      locale: 'zh',
    });
    assert.equal(migrated.content, 'LEGACY CHARACTER PROMPT');
    for (const key of [
      'omni_segment_generation',
      'omni_segment_polish',
      'classic_video_prompt_polish',
      'continuity_snapshot',
    ]) {
      const row = db.prepare('SELECT * FROM ai_model_map WHERE key = ?').get(key);
      assert.equal(row.config_id, 7);
      assert.equal(row.model_override, 'claude-sonnet');
    }
    const rerun = promptTemplates.ensurePromptCatalog(db);
    assert.equal(rerun.legacyMigrated, 0);
    assert.equal(rerun.sceneMapsMigrated, 0);
    db.close();
  });

  it('captures immutable prompt snapshots on async tasks', () => {
    const db = createDb();
    promptTemplates.ensurePromptCatalog(db);
    const task = taskService.createTask(db, log, 'test_generation', '1');
    const before = promptTemplates.resolvePrompt(db, 'character.identity_anchors.user', {
      dramaId: 1,
      locale: 'universal',
      variables: { character_appearance: 'snapshot input' },
      taskId: task.id,
    });
    const listRow = promptTemplates.listPrompts(db).find(
      (item) => item.prompt_key === 'character.identity_anchors.user' && item.locale === 'universal'
    );
    promptTemplates.updateSystemPrompt(
      db,
      'character.identity_anchors.user',
      'universal',
      'CHANGED {{character_appearance}}',
      listRow.system_version
    );
    const loaded = taskService.getTask(db, task.id);
    assert.equal(loaded.prompt_snapshot.length, 1);
    assert.equal(loaded.prompt_snapshot[0].content, before.content);
    assert.doesNotMatch(loaded.prompt_snapshot[0].content, /^CHANGED/);
    db.close();
  });

  it('renders database-backed image/video technical composition with project overrides', () => {
    const db = createDb();
    promptTemplates.ensurePromptCatalog(db);
    const storyboard = {
      id: 111,
      episode_id: 11,
      location: '书房',
      time: '夜',
      title: '发现线索',
      action: '林薇翻开信封',
      dialogue: '原来如此',
      duration: 6,
      movement: 'push',
    };
    const systemResult = episodeStoryboardService.composeStoryboardVideoPrompt(
      db,
      storyboard,
      'cinematic',
      '9:16'
    );
    assert.match(systemResult, /林薇翻开信封/);
    assert.match(systemResult, /9:16/);
    assert.doesNotMatch(systemResult, /\{\{/);

    promptTemplates.updateProjectPrompt(
      db,
      1,
      'storyboard.video_prompt.compose',
      'universal',
      'PROJECT VIDEO {{action}} / {{duration_seconds}}s',
      null
    );
    const projectResult = episodeStoryboardService.composeStoryboardVideoPrompt(
      db,
      storyboard,
      'cinematic',
      '9:16'
    );
    assert.equal(projectResult, 'PROJECT VIDEO 林薇翻开信封 / 6s');
    db.close();
  });
});

describe('prompt APIs and business scene registry', () => {
  it('lists, updates, previews and removes a project override through route handlers', () => {
    const db = createDb();
    promptTemplates.ensurePromptCatalog(db);
    const handlers = buildPromptRoutes(db, log);

    const listRes = mockResponse();
    handlers.listProject({ params: { drama_id: '1' }, query: {} }, listRes);
    assert.equal(listRes.statusCode, 200);
    assert.equal(listRes.payload.data.prompts.length, 146);

    const base = listRes.payload.data.prompts.find(
      (item) => item.prompt_key === 'character.identity_anchors.user' && item.locale === 'universal'
    );
    const updateRes = mockResponse();
    handlers.updateProject({
      params: { drama_id: '1', key: 'character.identity_anchors.user' },
      body: {
        locale: 'universal',
        content: 'API PROJECT {{character_appearance}}',
        version: null,
      },
    }, updateRes);
    assert.equal(updateRes.statusCode, 200);
    assert.equal(updateRes.payload.data.version, 1);

    const previewRes = mockResponse();
    handlers.previewProject({
      params: { drama_id: '1', key: 'character.identity_anchors.user' },
      body: {
        locale: 'universal',
        variables: { character_appearance: 'text' },
        content: 'EDITOR DRAFT {{character_appearance}}',
      },
    }, previewRes);
    assert.equal(previewRes.payload.data.scope, 'project');
    assert.equal(previewRes.payload.data.preview_source, 'editor');
    assert.equal(previewRes.payload.data.content, 'EDITOR DRAFT text');
    assert.equal(
      promptTemplates.resolvePrompt(db, 'character.identity_anchors.user', {
        dramaId: 1,
        locale: 'universal',
        variables: { character_appearance: 'text' },
      }).content,
      'API PROJECT text'
    );

    const deleteRes = mockResponse();
    handlers.deleteProject({
      params: { drama_id: '1', key: 'character.identity_anchors.user' },
      body: { locale: 'universal', version: 1 },
      query: {},
    }, deleteRes);
    assert.equal(deleteRes.payload.data.effective_source, 'system');
    assert.equal(
      promptTemplates.resolvePrompt(db, 'character.identity_anchors.user', {
        dramaId: 1,
        locale: 'universal',
        variables: { character_appearance: 'text' },
      }).scope,
      'system'
    );
    db.close();
  });

  it('publishes every supported scene key and includes the split routes', () => {
    const scenes = listBusinessScenes();
    assert.equal(scenes.length, 20);
    const keys = new Set(scenes.map((item) => item.key));
    for (const key of [
      'role_extraction',
      'scene_image_polish',
      'frame_prompt',
      'omni_segment_generation',
      'omni_segment_polish',
      'classic_video_prompt_polish',
      'continuity_snapshot',
      'vision_character_extract',
      'vision_scene_extract',
      'vision_prop_extract',
    ]) {
      assert.ok(keys.has(key), `missing scene ${key}`);
    }
  });

  it('keeps every catalog key connected to runtime code and routes every AI call', () => {
    const collectJs = (dir) => fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
      const file = path.join(dir, entry.name);
      return entry.isDirectory() ? collectJs(file) : file.endsWith('.js') ? [file] : [];
    });
    const sourceFiles = collectJs(path.join(__dirname, '..', 'src'));
    const runtimeFiles = sourceFiles.filter(
      (file) => !file.endsWith('promptCatalog.js') && !file.endsWith('promptI18n.js')
    );
    const runtimeSource = runtimeFiles.map((file) => fs.readFileSync(file, 'utf8')).join('\n');
    const dynamicPromptKeys = new Set([
      'frame.first.system', 'frame.key.system', 'frame.last.system',
      'frame.first.user', 'frame.key.user', 'frame.last.user',
      'frame.first.fallback', 'frame.key.fallback', 'frame.last.fallback',
      'vision.character.extract.system', 'vision.scene.extract.system', 'vision.prop.extract.system',
      'vision.character.extract.user', 'vision.scene.extract.user', 'vision.prop.extract.user',
    ]);
    for (const item of buildCatalog()) {
      assert.ok(
        runtimeSource.includes(item.prompt_key) || dynamicPromptKeys.has(item.prompt_key),
        `prompt key has no runtime caller: ${item.prompt_key}`
      );
    }

    const registryKeys = new Set(listBusinessScenes().map((item) => item.key));
    for (const file of runtimeFiles) {
      if (file.endsWith(`${path.sep}aiClient.js`)) continue;
      const source = fs.readFileSync(file, 'utf8');
      const callRe = /(?:aiClient\.)?(?:generateText|streamGenerateText|generateTextWithVision)\s*\(/g;
      for (const match of source.matchAll(callRe)) {
        const callWindow = source.slice(match.index, match.index + 1200);
        const sceneMatch = callWindow.match(/scene_key\s*:\s*['"]([^'"]+)['"]/);
        assert.ok(sceneMatch, `AI call missing scene_key in ${path.basename(file)}`);
        assert.ok(
          registryKeys.has(sceneMatch[1]),
          `AI call uses unregistered scene_key ${sceneMatch[1]} in ${path.basename(file)}`
        );
      }
    }
  });
});
