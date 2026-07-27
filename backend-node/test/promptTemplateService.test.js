const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');

const promptTemplates = require('../src/services/promptTemplateService');
const { splitSqlStatements } = require('../src/db/migrate');
const { routes: buildPromptRoutes } = require('../src/routes/prompts');
const { listBusinessScenes } = require('../src/services/businessSceneRegistry');
const { buildBusinessSceneOverview } = require('../src/services/sceneModelMapService');
const { buildCatalog } = require('../src/services/promptCatalog');

function createDb(options = {}) {
  const queries = [];
  const db = new Database(':memory:', options.trace ? { verbose: (sql) => queries.push(sql) } : {});
  db.dialect = 'sqlite';
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
    CREATE TABLE async_tasks (
      id TEXT PRIMARY KEY,
      prompt_snapshot TEXT,
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
    CREATE TABLE prompt_definitions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      prompt_key VARCHAR(191) NOT NULL,
      drama_id INTEGER NOT NULL DEFAULT 0,
      name TEXT NOT NULL DEFAULT '',
      description TEXT NOT NULL DEFAULT '',
      category TEXT NOT NULL DEFAULT '',
      subcategory TEXT NOT NULL DEFAULT '',
      detail_category TEXT NOT NULL DEFAULT '',
      workflow_stage TEXT NOT NULL DEFAULT '',
      workflow_order INTEGER NOT NULL DEFAULT 0,
      message_role TEXT NOT NULL DEFAULT 'user',
      content_type TEXT NOT NULL DEFAULT 'user_template',
      service_type TEXT NOT NULL DEFAULT 'text',
      scene_key TEXT,
      variable_schema TEXT NOT NULL DEFAULT '{}',
      risk_level TEXT NOT NULL DEFAULT 'normal',
      sort_order INTEGER NOT NULL DEFAULT 0,
      is_active INTEGER NOT NULL DEFAULT 1,
      source_ref TEXT NOT NULL DEFAULT '',
      content TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      UNIQUE (prompt_key, drama_id)
    );
    INSERT INTO dramas (id, title) VALUES (1, 'Project A'), (2, 'Project B');
    INSERT INTO episodes (id, drama_id) VALUES (11, 1);
    INSERT INTO storyboards (id, episode_id) VALUES (111, 11);
    INSERT INTO characters (id, drama_id) VALUES (211, 1);
    INSERT INTO scenes (id, drama_id) VALUES (311, 1);
    INSERT INTO props (id, drama_id) VALUES (411, 1);
    INSERT INTO async_tasks (id, updated_at) VALUES ('task-1', 'now');
  `);
  promptTemplates.installPromptCatalog(db);
  queries.length = 0;
  return { db, queries };
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

describe('unified prompt storage and resolution', () => {
  it('installs one current system row per prompt without version or seed columns', () => {
    const { db } = createDb();
    const second = promptTemplates.installPromptCatalog(db);
    const catalog = buildCatalog();
    const columns = new Set(
      db.prepare('PRAGMA table_info(prompt_definitions)').all().map((column) => column.name)
    );

    assert.equal(catalog.length, 98);
    assert.equal(second.inserted, 0);
    assert.equal(
      db.prepare('SELECT COUNT(*) AS count FROM prompt_definitions WHERE drama_id = 0').get().count,
      98
    );
    assert.equal(promptTemplates.listPrompts(db).length, 98);
    for (const removed of [
      'seed_content',
      'seed_version',
      'version',
      'scope',
      'locale',
      'allow_project_override',
    ]) {
      assert.equal(columns.has(removed), false, `${removed} should not exist`);
    }
    assert.ok(promptTemplates.listPrompts(db).every((item) => item.effective_source === 'system'));
    db.close();
  });

  it('uses one query for project-first resolution and isolates project overrides', () => {
    const { db, queries } = createDb({ trace: true });
    const key = 'character.identity_anchors.user';
    promptTemplates.updateProjectPrompt(db, 1, key, 'PROJECT {{character_appearance}}');

    queries.length = 0;
    const project = promptTemplates.resolvePrompt(db, key, {
      dramaId: 1,
      variables: { character_appearance: 'LOOK' },
    });
    const promptReads = queries.filter(
      (sql) => /FROM prompt_definitions s/i.test(sql) && /LEFT JOIN prompt_definitions p/i.test(sql)
    );
    assert.equal(promptReads.length, 1);
    assert.equal(project.scope, 'project');
    assert.equal(project.content, 'PROJECT LOOK');

    const otherProject = promptTemplates.resolvePrompt(db, key, {
      dramaId: 2,
      variables: { character_appearance: 'LOOK' },
    });
    assert.equal(otherProject.scope, 'system');
    assert.notEqual(otherProject.content, 'PROJECT LOOK');

    for (const context of [
      { episodeId: 11 },
      { storyboardId: 111 },
      { characterId: 211 },
      { sceneId: 311 },
      { propId: 411 },
    ]) {
      assert.equal(
        promptTemplates.resolvePrompt(db, key, {
          ...context,
          variables: { character_appearance: 'LOOK' },
        }).scope,
        'project'
      );
    }
    db.close();
  });

  it('batch resolves distinct keys with one prompt query', () => {
    const { db, queries } = createDb({ trace: true });
    promptTemplates.updateProjectPrompt(
      db,
      1,
      'story.generation.system',
      'PROJECT SYSTEM {{episode_count}}'
    );
    queries.length = 0;
    const resolved = promptTemplates.resolvePrompts(db, [
      'story.generation.system',
      'story.generation.user',
      'story.generation.system',
    ], {
      dramaId: 1,
      variables: {
        episode_count: 3,
        story_premise: 'outline',
      },
    });
    assert.equal(resolved.size, 2);
    assert.equal(resolved.get('story.generation.system').scope, 'project');
    assert.equal(resolved.get('story.generation.system').content, 'PROJECT SYSTEM 3');
    assert.equal(
      queries.filter((sql) => /FROM prompt_definitions s/i.test(sql)).length,
      1
    );
    db.close();
  });

  it('updates the current system content while project content remains independent', () => {
    const { db } = createDb();
    const key = 'character.identity_anchors.user';
    promptTemplates.updateProjectPrompt(db, 1, key, 'PROJECT {{character_appearance}}');
    const updated = promptTemplates.updateSystemPrompt(
      db,
      key,
      'SYSTEM CURRENT {{character_appearance}}'
    );
    assert.equal(updated.version, undefined);
    assert.equal(
      promptTemplates.resolvePromptContent(db, key, {
        dramaId: 1,
        variables: { character_appearance: 'A' },
      }),
      'PROJECT A'
    );
    assert.equal(
      promptTemplates.resolvePromptContent(db, key, {
        dramaId: 2,
        variables: { character_appearance: 'B' },
      }),
      'SYSTEM CURRENT B'
    );
    assert.equal(promptTemplates.deleteProjectPrompt(db, 1, key), true);
    assert.equal(
      promptTemplates.resolvePrompt(db, key, {
        dramaId: 1,
        variables: { character_appearance: 'C' },
      }).scope,
      'system'
    );
    db.close();
  });

  it('validates content and fails explicitly when a system prompt is missing', () => {
    const { db } = createDb();
    const key = 'character.identity_anchors.user';
    assert.throws(
      () => promptTemplates.updateSystemPrompt(db, key, 'missing required variable'),
      (error) => error.code === 'PROMPT_VALIDATION_FAILED'
    );
    db.prepare('DELETE FROM prompt_definitions WHERE prompt_key = ?').run(key);
    assert.throws(
      () => promptTemplates.resolvePrompt(db, key, { dramaId: 1 }),
      (error) => error.code === 'PROMPT_DEFINITION_NOT_FOUND'
    );
    db.close();
  });

  it('captures the effective current prompt without prompt version metadata', () => {
    const { db } = createDb();
    const key = 'character.identity_anchors.user';
    promptTemplates.updateProjectPrompt(db, 1, key, 'PROJECT {{character_appearance}}');
    promptTemplates.resolvePrompt(db, key, {
      dramaId: 1,
      taskId: 'task-1',
      variables: { character_appearance: 'LOOK' },
    });
    const snapshot = JSON.parse(
      db.prepare('SELECT prompt_snapshot FROM async_tasks WHERE id = ?').get('task-1').prompt_snapshot
    )[0];
    assert.equal(snapshot.scope, 'project');
    assert.equal(snapshot.content, 'PROJECT LOOK');
    assert.equal(snapshot.version, undefined);
    assert.ok(snapshot.prompt_id);
    assert.ok(snapshot.updated_at);
    db.close();
  });

  it('preserves current system and project content when migrating from the two-table schema', () => {
    const db = new Database(':memory:');
    db.dialect = 'sqlite';
    db.exec(`
      CREATE TABLE dramas (id INTEGER PRIMARY KEY, deleted_at TEXT);
      INSERT INTO dramas (id) VALUES (1);
      CREATE TABLE async_tasks (
        id TEXT PRIMARY KEY
      );
      CREATE TABLE prompt_overrides (
        key TEXT PRIMARY KEY,
        content TEXT,
        updated_at TEXT
      );
    `);
    for (const file of [
      '23_prompt_templates.sql',
      '25_prompt_definition_content_type.sql',
      '26_prompt_workflow_classification.sql',
      '27_prompt_detail_category.sql',
    ]) {
      db.exec(fs.readFileSync(path.join(__dirname, '..', 'migrations', file), 'utf8'));
    }
    const now = new Date().toISOString();
    const definitionId = db.prepare(`
      INSERT INTO prompt_definitions (
        prompt_key, name, description, category, subcategory, detail_category,
        workflow_stage, workflow_order, message_role, content_type, service_type,
        variable_schema, risk_level, allow_project_override, sort_order,
        is_active, source_ref, created_at, updated_at
      ) VALUES (?, ?, '', ?, '', '', '', 0, 'user', 'user_template', 'text',
        ?, 'normal', 1, 0, 1, '', ?, ?)
    `).run(
      'character.identity_anchors.user',
      'Identity',
      '资产',
      JSON.stringify({ variables: [{ name: 'character_appearance', required: true }] }),
      now,
      now
    ).lastInsertRowid;
    const insertTemplate = db.prepare(`
      INSERT INTO prompt_templates (
        definition_id, scope, drama_id, locale, content, seed_content,
        seed_version, version, created_at, updated_at
      ) VALUES (?, ?, ?, 'default', ?, ?, 1, 9, ?, ?)
    `);
    insertTemplate.run(
      definitionId,
      'system',
      null,
      'SYSTEM CURRENT {{character_appearance}}',
      'OLD SEED',
      now,
      now
    );
    insertTemplate.run(
      definitionId,
      'project',
      1,
      'PROJECT CURRENT {{character_appearance}}',
      null,
      now,
      now
    );

    const migration = fs.readFileSync(
      path.join(__dirname, '..', 'migrations', '38_unified_prompts.sql'),
      'utf8'
    );
    for (const statement of splitSqlStatements(migration)) db.exec(statement);
    promptTemplates.installPromptCatalog(db);

    assert.equal(
      promptTemplates.resolvePromptContent(db, 'character.identity_anchors.user', {
        dramaId: 1,
        variables: { character_appearance: 'A' },
      }),
      'PROJECT CURRENT A'
    );
    assert.equal(
      promptTemplates.resolvePromptContent(db, 'character.identity_anchors.user', {
        dramaId: 2,
        variables: { character_appearance: 'B' },
      }),
      'SYSTEM CURRENT B'
    );
    assert.equal(
      db.prepare("SELECT COUNT(*) AS count FROM sqlite_master WHERE type = 'table' AND name = 'prompt_templates'").get().count,
      0
    );
    assert.equal(
      db.prepare("SELECT COUNT(*) AS count FROM sqlite_master WHERE type = 'table' AND name = 'prompt_overrides'").get().count,
      0
    );
    db.close();
  });
});

describe('prompt APIs and business-scene coverage', () => {
  it('lists, updates, previews and removes a project override through routes', () => {
    const { db } = createDb();
    const handlers = buildPromptRoutes(db, log);
    const listRes = mockResponse();
    handlers.listProject({ params: { drama_id: '1' }, query: {} }, listRes);
    assert.equal(listRes.statusCode, 200);
    assert.equal(listRes.payload.data.prompts.length, 98);

    const key = 'character.identity_anchors.user';
    const updateRes = mockResponse();
    handlers.updateProject({
      params: { drama_id: '1', key },
      body: { content: 'API PROJECT {{character_appearance}}' },
    }, updateRes);
    assert.equal(updateRes.statusCode, 200);
    assert.equal(updateRes.payload.data.version, undefined);
    assert.ok(updateRes.payload.data.updated_at);

    const previewRes = mockResponse();
    handlers.previewProject({
      params: { drama_id: '1', key },
      body: {
        variables: { character_appearance: 'text' },
        content: 'EDITOR {{character_appearance}}',
      },
    }, previewRes);
    assert.equal(previewRes.payload.data.scope, 'project');
    assert.equal(previewRes.payload.data.content, 'EDITOR text');

    const deleteRes = mockResponse();
    handlers.deleteProject({
      params: { drama_id: '1', key },
      body: {},
    }, deleteRes);
    assert.equal(deleteRes.payload.data.effective_source, 'system');
    db.close();
  });

  it('publishes every supported business scene and prompt bundle', () => {
    const { db } = createDb();
    const scenes = listBusinessScenes();
    const overview = buildBusinessSceneOverview(db);
    assert.equal(scenes.length, 24);
    assert.equal(overview.length, 24);
    assert.equal(
      overview.reduce((count, scene) => count + scene.prompt_count, 0),
      98
    );
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
      'storyboard_image_generation',
      'video_generation',
    ]) {
      assert.ok(scenes.some((scene) => scene.key === key), `missing scene ${key}`);
    }
    db.close();
  });

  it('keeps every catalog key connected to runtime code and centralizes prompt-table access', () => {
    const collectJs = (directory) => fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
      const file = path.join(directory, entry.name);
      return entry.isDirectory() ? collectJs(file) : file.endsWith('.js') ? [file] : [];
    });
    const sourceFiles = collectJs(path.join(__dirname, '..', 'src'));
    const runtimeFiles = sourceFiles.filter(
      (file) => !file.endsWith('promptCatalog.js') && !file.endsWith('promptI18n.js')
    );
    const runtimeSource = runtimeFiles.map((file) => fs.readFileSync(file, 'utf8')).join('\n');
    const dynamicPromptKeys = new Set([
      'frame.first.system',
      'frame.key.system',
      'frame.last.system',
      'frame.first.fallback',
      'frame.key.fallback',
      'frame.last.fallback',
      'vision.character.extract.system',
      'vision.scene.extract.system',
      'vision.prop.extract.system',
      'vision.character.extract.user',
      'vision.scene.extract.user',
      'vision.prop.extract.user',
    ]);
    for (const item of buildCatalog()) {
      assert.ok(
        runtimeSource.includes(item.prompt_key) || dynamicPromptKeys.has(item.prompt_key),
        `prompt key has no runtime caller: ${item.prompt_key}`
      );
    }

    for (const file of runtimeFiles) {
      if (
        file.endsWith(`${path.sep}promptTemplateService.js`)
        || file.endsWith(`${path.sep}migrate.js`)
        || file.endsWith(`${path.sep}mysql.js`)
      ) {
        continue;
      }
      const source = fs.readFileSync(file, 'utf8');
      assert.doesNotMatch(
        source,
        /\bprompt_templates\b|\bFROM\s+prompt_definitions\b|\bINTO\s+prompt_definitions\b/i,
        `prompt table bypasses the central service in ${path.basename(file)}`
      );
    }
  });
});
