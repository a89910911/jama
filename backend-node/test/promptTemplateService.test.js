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
const { buildBusinessSceneOverview } = require('../src/services/sceneModelMapService');
const promptI18n = require('../src/services/promptI18n');
const { buildCatalog, seedCfg, placeholders } = require('../src/services/promptCatalog');

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
  db.exec(fs.readFileSync(
    path.join(__dirname, '..', 'migrations', '25_prompt_definition_content_type.sql'),
    'utf8'
  ));
  db.exec(fs.readFileSync(
    path.join(__dirname, '..', 'migrations', '26_prompt_workflow_classification.sql'),
    'utf8'
  ));
  db.exec(fs.readFileSync(
    path.join(__dirname, '..', 'migrations', '27_prompt_detail_category.sql'),
    'utf8'
  ));
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
  it('seeds one canonical template per definition idempotently', () => {
    const db = createDb();
    const first = promptTemplates.ensurePromptCatalog(db);
    const second = promptTemplates.ensurePromptCatalog(db);
    const catalog = buildCatalog();
    assert.equal(first.seeded, 94);
    assert.equal(second.seeded, 94);
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM prompt_definitions').get().n, 94);
    assert.equal(
      db.prepare("SELECT COUNT(*) AS n FROM prompt_templates WHERE scope = 'system'").get().n,
      94
    );
    assert.equal(promptTemplates.listPrompts(db).length, 94);
    assert.equal(new Set(catalog.map((item) => item.name)).size, 94);
    assert.ok(catalog.every((item) => item.contents[0].content.trim().length > 0));
    assert.deepEqual(
      promptTemplates.listPrompts(db).map((item) => item.name),
      [...catalog]
        .sort((a, b) => a.sort_order - b.sort_order)
        .map((item) => item.name)
    );
    assert.equal(
      promptTemplates.listPrompts(db).find(
        (item) => item.prompt_key === 'story.generation.system'
      ).name,
      '根据故事梗概生成分集短剧剧本（系统规则）'
    );
    assert.equal(
      promptTemplates.listPrompts(db).find(
        (item) => item.prompt_key === 'image.negative.anti_split'
      ).name,
      '图片安全及防分屏负向提示词（负向词）'
    );
    assert.match(
      catalog.find((item) => item.prompt_key === 'character.identity_anchors.system')
        .contents[0].content,
      /角色视觉分析师/
    );
    assert.match(
      catalog.find((item) => item.prompt_key === 'storyboard.continuity_snapshot.system')
        .contents[0].content,
      /影视制作连戏监督/
    );
    assert.match(
      catalog.find((item) => item.prompt_key === 'image.reference_context.system')
        .contents[0].content,
      /每张参考图对应的目标对象/
    );
    assert.deepEqual(
      db.prepare("SELECT DISTINCT locale FROM prompt_templates WHERE deleted_at IS NULL").all(),
      [{ locale: 'default' }]
    );
    assert.ok(
      db.prepare(`
        SELECT 1 FROM prompt_definitions
        WHERE message_role = 'user' AND prompt_key = 'image.negative.anti_split'
      `).get()
    );
    const listed = promptTemplates.listPrompts(db);
    assert.ok(listed.every((item) => item.injection_channel));
    assert.ok(listed.every((item) => item.template_kind));
    assert.ok(listed.every((item) => item.subcategory));
    assert.ok(listed.every((item) => item.workflow_stage));
    assert.deepEqual(
      [...new Set(listed.map((item) => item.category))],
      ['剧本', '资产', '分镜', '视频']
    );
    assert.deepEqual(
      Object.fromEntries(
        [...new Set(listed.map((item) => item.category))].map((category) => [
          category,
          listed.filter((item) => item.category === category).length,
        ])
      ),
      {
        剧本: 3,
        资产: 26,
        分镜: 43,
        视频: 22,
      }
    );
    const subcategoriesFor = (category) => [
      ...new Set(
        listed
          .filter((item) => item.category === category)
          .map((item) => item.subcategory)
      ),
    ];
    assert.deepEqual(subcategoriesFor('剧本'), ['故事创作', '小说改编']);
    assert.deepEqual(subcategoriesFor('资产'), ['人物', '场景', '道具']);
    assert.deepEqual(
      subcategoriesFor('分镜'),
      ['方案生成', '布局与连戏', '首帧/关键帧/尾帧', '分镜图片', '参考图与图片约束']
    );
    assert.deepEqual(subcategoriesFor('视频'), ['通用', '经典模式', '全能模式']);
    const assetDetailsFor = (subcategory) => [
      ...new Set(
        listed
          .filter((item) => item.category === '资产' && item.subcategory === subcategory)
          .map((item) => item.detail_category)
      ),
    ];
    assert.deepEqual(
      assetDetailsFor('人物'),
      ['剧本提取', '参考图识别', '视觉身份锚点', '图片提示词']
    );
    assert.deepEqual(assetDetailsFor('场景'), ['剧本提取', '参考图识别', '图片提示词']);
    assert.deepEqual(assetDetailsFor('道具'), ['剧本提取', '参考图识别', '图片提示词']);
    assert.ok(listed.filter((item) => item.category !== '资产')
      .every((item) => item.detail_category === ''));
    assert.ok(listed.every((item) => item.workflow_stage === item.category));
    assert.ok(listed.every((item) => item.workflow_order === (
      ['剧本', '资产', '分镜', '视频'].indexOf(item.category) + 1
    )));
    assert.deepEqual(
      listed.map((item) => item.sort_order),
      Array.from({ length: 94 }, (_, index) => index + 1)
    );
    for (const item of listed.filter((row) => row.parent_prompt_key)) {
      const parent = listed.find((row) => row.prompt_key === item.parent_prompt_key);
      assert.ok(parent);
      assert.equal(item.category, parent.category);
      assert.equal(item.subcategory, parent.subcategory);
      assert.equal(item.detail_category, parent.detail_category);
      assert.equal(item.workflow_stage, parent.workflow_stage);
    }
    assert.ok(listed.every((item) => ['system', 'user', 'assistant'].includes(item.message_role)));
    assert.deepEqual(
      Object.fromEntries(
        ['main', 'conditional_child', 'independent_technical'].map((kind) => [
          kind,
          listed.filter((item) => item.template_kind === kind).length,
        ])
      ),
      {
        main: 52,
        conditional_child: 39,
        independent_technical: 3,
      }
    );
    assert.equal(
      listed.filter((item) => item.template_subtype === 'fallback').length,
      6
    );
    assert.deepEqual(
      {
        role: listed.find(
          (item) => item.prompt_key === 'image.negative.anti_split'
        ).message_role,
        content_type: listed.find(
          (item) => item.prompt_key === 'image.negative.anti_split'
        ).content_type,
      },
      {
        role: 'user',
        content_type: 'negative_prompt',
      }
    );
    assert.equal(
      listed.find(
        (item) => item.prompt_key === 'frame.first.realistic_scale_contract'
      ).message_role,
      'system'
    );
    assert.deepEqual(
      {
        parent_prompt_key: listed.find(
          (item) => item.prompt_key === 'omni.segment.reference_rule'
        ).parent_prompt_key,
        is_fragment: listed.find(
          (item) => item.prompt_key === 'omni.segment.reference_rule'
        ).is_fragment,
      },
      {
        parent_prompt_key: 'omni.segment.user',
        is_fragment: 1,
      }
    );
    assert.deepEqual(
      {
        template_kind: listed.find(
          (item) => item.prompt_key === 'image.reference_generation.user'
        ).template_kind,
        parent_prompt_key: listed.find(
          (item) => item.prompt_key === 'image.reference_generation.user'
        ).parent_prompt_key,
      },
      {
        template_kind: 'independent_technical',
        parent_prompt_key: null,
      }
    );
    assert.deepEqual(
      {
        template_kind: listed.find(
          (item) => item.prompt_key === 'frame.first.fallback'
        ).template_kind,
        template_subtype: listed.find(
          (item) => item.prompt_key === 'frame.first.fallback'
        ).template_subtype,
      },
      {
        template_kind: 'conditional_child',
        template_subtype: 'fallback',
      }
    );
    assert.equal(
      listed.find((item) => item.prompt_key === 'omni.segment.fallback').parent_prompt_key,
      'omni.segment.user'
    );
    assert.equal(
      listed.find((item) => item.prompt_key === 'story.generation.system').template_kind,
      'main'
    );
    for (const removedKey of [
      'storyboard.generation.requirements',
      'storyboard.generation.output_contract',
      'frame.output_contract',
      'character.image_layout',
      'scene.image_four_view.layout',
      'scene.image_single.layout',
      'scene.image.compose',
      'image.realistic_scale_contract',
    ]) {
      assert.equal(listed.some((item) => item.prompt_key === removedKey), false);
    }
    assert.equal(
      listed.find(
        (item) => item.prompt_key === 'frame.first.realistic_scale_contract'
      ).parent_prompt_key,
      'frame.first.system'
    );
    assert.equal(
      listed.find(
        (item) => item.prompt_key === 'frame.last.realistic_scale_contract'
      ).parent_prompt_key,
      'frame.last.system'
    );
    assert.match(
      listed.find(
        (item) => item.prompt_key === 'frame.first.realistic_scale_contract'
      ).system_content,
      /本铁律仅适用于首帧生成/
    );
    assert.match(
      listed.find(
        (item) => item.prompt_key === 'frame.last.realistic_scale_contract'
      ).system_content,
      /本铁律仅适用于尾帧生成/
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
        AND t.scope = 'system' AND t.locale = 'default'
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

    db.close();
  });

  it('migrates historical language rows into one default template without losing edits', () => {
    const db = createDb();
    promptTemplates.ensurePromptCatalog(db);
    const definition = db.prepare(
      "SELECT id FROM prompt_definitions WHERE prompt_key = 'frame.input.user'"
    ).get();
    const now = new Date().toISOString();
    db.prepare(
      "UPDATE prompt_templates SET deleted_at = ? WHERE definition_id = ? AND scope = 'system' AND locale = 'default'"
    ).run(now, definition.id);
    const insert = db.prepare(`
      INSERT INTO prompt_templates
        (definition_id, scope, drama_id, locale, content, seed_content, seed_version, version, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, 1, 3, ?, ?)
    `);
    insert.run(definition.id, 'system', null, 'zh', '用户修改的中文模板 {{frame_context}}', '旧中文种子 {{frame_context}}', now, now);
    insert.run(definition.id, 'system', null, 'en', 'OLD EN {{frame_context}}', 'OLD EN {{frame_context}}', now, now);
    insert.run(definition.id, 'project', 1, 'universal', '项目旧通用模板 {{frame_context}}', null, now, now);

    const migration = fs.readFileSync(
      path.join(__dirname, '..', 'migrations', '24_prompt_single_template.sql'),
      'utf8'
    );
    db.exec(migration);
    promptTemplates.ensurePromptCatalog(db);

    const system = promptTemplates.resolvePrompt(db, 'frame.input.user', {
      variables: { frame_context: '镜头信息' },
    });
    const project = promptTemplates.resolvePrompt(db, 'frame.input.user', {
      dramaId: 1,
      variables: { frame_context: '镜头信息' },
    });
    assert.equal(system.content, '用户修改的中文模板 镜头信息');
    assert.equal(project.content, '项目旧通用模板 镜头信息');
    assert.equal(
      db.prepare(
        "SELECT COUNT(*) AS n FROM prompt_templates WHERE definition_id = ? AND deleted_at IS NULL"
      ).get(definition.id).n,
      2
    );
    assert.equal(
      db.prepare(
        "SELECT COUNT(*) AS n FROM prompt_templates WHERE definition_id = ? AND locale <> 'default'"
      ).get(definition.id).n,
      0
    );
    db.close();
  });

  it('migrates simple prompt merges and physically deletes every replaced row', () => {
    const db = createDb();
    promptTemplates.ensurePromptCatalog(db);
    const groups = [
      {
        targetKey: 'frame.input.user',
        oldKeys: ['frame.first.user', 'frame.key.user', 'frame.last.user'],
      },
      {
        targetKey: 'scene.image.user',
        oldKeys: ['scene.image_four_view.user', 'scene.image_single.user'],
      },
    ];
    const insertDefinition = db.prepare(`
      INSERT INTO prompt_definitions
        (prompt_key, name, description, category, message_role, service_type, scene_key,
         variable_schema, risk_level, allow_project_override, sort_order, is_active,
         source_ref, created_at, updated_at)
      SELECT ?, ?, description, category, message_role, service_type, scene_key,
             variable_schema, risk_level, allow_project_override, sort_order, is_active,
             source_ref, ?, ?
      FROM prompt_definitions
      WHERE prompt_key = ?
    `);
    const insertTemplate = db.prepare(`
      INSERT INTO prompt_templates
        (definition_id, scope, drama_id, locale, content, seed_content,
         seed_version, version, created_at, updated_at)
      VALUES (?, ?, ?, 'default', ?, ?, 1, ?, ?, ?)
    `);
    const now = new Date().toISOString();
    const oldIds = [];
    for (const group of groups) {
      for (const oldKey of group.oldKeys) {
        insertDefinition.run(oldKey, `旧定义 ${oldKey}`, now, now, group.targetKey);
        const definitionId = Number(
          db.prepare('SELECT id FROM prompt_definitions WHERE prompt_key = ?').get(oldKey).id
        );
        oldIds.push(definitionId);
        const isCustomizedFrame = oldKey === 'frame.first.user';
        const seedContent = group.targetKey === 'frame.input.user'
          ? '旧帧模板 {{frame_context}}'
          : group.targetKey === 'scene.image.user'
            ? '旧场景模板 {{entity_name}}'
            : '旧拼装模板 {{layout_instruction}} {{generated_description}}';
        insertTemplate.run(
          definitionId,
          'system',
          null,
          isCustomizedFrame ? '自定义帧模板 {{frame_context}}' : seedContent,
          seedContent,
          isCustomizedFrame ? 3 : 1,
          now,
          now
        );
        if (oldKey === 'scene.image_single.user') {
          insertTemplate.run(
            definitionId,
            'project',
            1,
            '项目场景模板 {{entity_name}}',
            null,
            2,
            now,
            now
          );
        }
      }
    }

    const result = promptTemplates.ensurePromptCatalog(db);
    assert.deepEqual(result.mergedPrompts, {
      definitionsDeleted: 5,
      templatesDeleted: 6,
      systemCustomizationsMigrated: 1,
      projectOverridesMigrated: 1,
    });
    assert.equal(
      db.prepare(`SELECT COUNT(*) AS n FROM prompt_definitions
                  WHERE prompt_key IN (${oldIds.map(() => '?').join(', ')})`)
        .get(...groups.flatMap((group) => group.oldKeys)).n,
      0
    );
    assert.equal(
      db.prepare(`SELECT COUNT(*) AS n FROM prompt_templates
                  WHERE definition_id IN (${oldIds.map(() => '?').join(', ')})`)
        .get(...oldIds).n,
      0
    );
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM prompt_definitions').get().n, 94);
    assert.equal(
      promptTemplates.resolvePrompt(db, 'frame.input.user', {
        variables: { frame_context: '镜头信息' },
      }).content,
      '自定义帧模板 镜头信息'
    );
    assert.equal(
      promptTemplates.resolvePrompt(db, 'scene.image.user', {
        dramaId: 1,
        variables: {
          entity_name: '室内',
          entity_time: '夜',
          entity_description: '暖色灯光',
        },
      }).content,
      '项目场景模板 室内'
    );
    assert.deepEqual(promptTemplates.ensurePromptCatalog(db).mergedPrompts, {
      definitionsDeleted: 0,
      templatesDeleted: 0,
      systemCustomizationsMigrated: 0,
      projectOverridesMigrated: 0,
    });
    db.close();
  });

  it('consolidates technical templates without losing system edits or project overrides', () => {
    const db = createDb();
    promptTemplates.ensurePromptCatalog(db);
    const now = new Date().toISOString();
    const insertedKeys = [];
    const insertDefinition = db.prepare(`
      INSERT INTO prompt_definitions
        (prompt_key, name, description, category, message_role, service_type, scene_key,
         variable_schema, risk_level, allow_project_override, sort_order, is_active,
         source_ref, created_at, updated_at)
      SELECT ?, ?, description, category, message_role, service_type, scene_key,
             variable_schema, risk_level, allow_project_override, sort_order, is_active,
             source_ref, ?, ?
      FROM prompt_definitions
      WHERE prompt_key = ?
    `);
    const insertSystem = db.prepare(`
      INSERT INTO prompt_templates
        (definition_id, scope, drama_id, locale, content, seed_content,
         seed_version, version, created_at, updated_at)
      VALUES (?, 'system', NULL, 'default', ?, ?, 1, ?, ?, ?)
    `);
    const insertProject = db.prepare(`
      INSERT INTO prompt_templates
        (definition_id, scope, drama_id, locale, content, seed_content,
         seed_version, version, created_at, updated_at)
      VALUES (?, 'project', ?, 'default', ?, NULL, 1, 2, ?, ?)
    `);
    const addLegacyPrompt = ({
      key,
      cloneKey,
      seedContent,
      systemContent = seedContent,
      projectContent = null,
    }) => {
      insertDefinition.run(key, `旧技术模板 ${key}`, now, now, cloneKey);
      const definitionId = Number(
        db.prepare('SELECT id FROM prompt_definitions WHERE prompt_key = ?').get(key).id
      );
      insertedKeys.push(key);
      insertSystem.run(
        definitionId,
        systemContent,
        seedContent,
        systemContent === seedContent ? 1 : 3,
        now,
        now
      );
      if (projectContent) {
        insertProject.run(definitionId, 1, projectContent, now, now);
      }
    };

    const storyboardRequirements = placeholders(
      promptI18n.getStoryboardUserPromptSuffix(seedCfg(), 986)
    );
    const storyboardOutput =
      '返回合法 JSON，包含 storyboards 数组；字段必须符合当前分镜数据协议。不要输出 markdown 或解释文字。';
    const frameOutput =
      '返回 JSON 对象，包含 prompt 和 description；不要输出 markdown 或额外解释。';
    const characterLayout = promptI18n.getRoleGenerateImagePrompt();
    const sceneFourLayout = promptI18n.getSceneGenerateImagePrompt();
    const sceneSingleLayout = promptI18n.getSceneGenerateSingleImagePrompt();
    const realisticScale = promptI18n.getRealisticPhysicalScaleContract(false);
    const sceneCompose = `【画风·最高优先级】{{style_zh}}
MANDATORY ART STYLE: {{style_en}}.

{{layout_instruction}}

---

{{generated_description}}

---

Reiterate the same art style throughout the entire image and in every panel when a grid is requested: {{style_en}} {{style_zh}}. No people, no text.`;

    addLegacyPrompt({
      key: 'storyboard.generation.requirements',
      cloneKey: 'storyboard.generation.system',
      seedContent: storyboardRequirements,
      systemContent: `${storyboardRequirements}\n\n系统自定义分镜补充规则`,
      projectContent: `${storyboardRequirements}\n\n项目一专用分镜补充规则`,
    });
    addLegacyPrompt({
      key: 'storyboard.generation.output_contract',
      cloneKey: 'storyboard.generation.system',
      seedContent: storyboardOutput,
    });
    addLegacyPrompt({
      key: 'frame.output_contract',
      cloneKey: 'frame.first.system',
      seedContent: frameOutput,
      systemContent: `${frameOutput}\n系统自定义帧输出补充`,
    });
    addLegacyPrompt({
      key: 'character.image_layout',
      cloneKey: 'character.image_compose',
      seedContent: characterLayout,
      systemContent: `${characterLayout}\n系统自定义角色布局补充`,
    });
    addLegacyPrompt({
      key: 'scene.image.compose',
      cloneKey: 'scene.image_four_view.final',
      seedContent: sceneCompose,
    });
    addLegacyPrompt({
      key: 'scene.image_four_view.layout',
      cloneKey: 'scene.image_four_view.final',
      seedContent: sceneFourLayout,
    });
    addLegacyPrompt({
      key: 'scene.image_single.layout',
      cloneKey: 'scene.image_single.final',
      seedContent: sceneSingleLayout,
      projectContent: `${sceneSingleLayout}\n项目一专用场景单图布局`,
    });
    addLegacyPrompt({
      key: 'image.realistic_scale_contract',
      cloneKey: 'frame.first.realistic_scale_contract',
      seedContent: realisticScale,
      systemContent: `${realisticScale}\n系统自定义真实尺度规则`,
      projectContent: `${realisticScale}\n项目一专用真实尺度规则`,
    });

    const result = promptTemplates.ensurePromptCatalog(db);
    assert.deepEqual(result.consolidatedPrompts, {
      definitionsDeleted: 8,
      templatesDeleted: 11,
      systemCustomizationsMigrated: 7,
      projectOverridesMigrated: 4,
    });
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM prompt_definitions').get().n, 94);
    assert.equal(
      db.prepare(
        `SELECT COUNT(*) AS n FROM prompt_definitions
         WHERE prompt_key IN (${insertedKeys.map(() => '?').join(', ')})`
      ).get(...insertedKeys).n,
      0
    );
    assert.match(
      promptTemplates.resolvePrompt(db, 'storyboard.generation.system', {
        dramaId: 1,
        render: false,
      }).content,
      /项目一专用分镜补充规则/
    );
    assert.match(
      promptTemplates.resolvePrompt(db, 'frame.first.system', {
        render: false,
      }).content,
      /系统自定义帧输出补充/
    );
    assert.match(
      promptTemplates.resolvePrompt(db, 'character.image_compose', {
        render: false,
      }).content,
      /系统自定义角色布局补充/
    );
    assert.match(
      promptTemplates.resolvePrompt(db, 'scene.image_single.final', {
        dramaId: 1,
        render: false,
      }).content,
      /项目一专用场景单图布局/
    );
    for (const key of [
      'frame.first.realistic_scale_contract',
      'frame.last.realistic_scale_contract',
    ]) {
      assert.match(
        promptTemplates.resolvePrompt(db, key, {
          dramaId: 1,
          render: false,
        }).content,
        /项目一专用真实尺度规则/
      );
    }
    assert.deepEqual(promptTemplates.ensurePromptCatalog(db).consolidatedPrompts, {
      definitionsDeleted: 0,
      templatesDeleted: 0,
      systemCustomizationsMigrated: 0,
      projectOverridesMigrated: 0,
    });
    db.close();
  });

  it('keeps the consolidated storyboard system template at factory-default status when old fragments were untouched', () => {
    const db = createDb();
    promptTemplates.ensurePromptCatalog(db);
    const now = new Date().toISOString();
    const target = db.prepare(
      "SELECT * FROM prompt_definitions WHERE prompt_key = 'storyboard.generation.system'"
    ).get();
    const insertDefinition = db.prepare(`
      INSERT INTO prompt_definitions
        (prompt_key, name, description, category, message_role, service_type, scene_key,
         variable_schema, risk_level, allow_project_override, sort_order, is_active,
         source_ref, created_at, updated_at)
      VALUES (?, ?, '', ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?)
    `);
    const insertTemplate = db.prepare(`
      INSERT INTO prompt_templates
        (definition_id, scope, drama_id, locale, content, seed_content,
         seed_version, version, created_at, updated_at)
      VALUES (?, 'system', NULL, 'default', ?, ?, 1, 1, ?, ?)
    `);
    const oldTemplates = [
      [
        'storyboard.generation.requirements',
        placeholders(promptI18n.getStoryboardUserPromptSuffix(seedCfg(), 986)),
      ],
      [
        'storyboard.generation.output_contract',
        '返回合法 JSON，包含 storyboards 数组；字段必须符合当前分镜数据协议。不要输出 markdown 或解释文字。',
      ],
    ];
    for (const [key, content] of oldTemplates) {
      insertDefinition.run(
        key,
        `旧技术模板 ${key}`,
        target.category,
        target.message_role,
        target.service_type,
        target.scene_key,
        target.variable_schema,
        target.risk_level,
        target.allow_project_override,
        target.sort_order,
        target.source_ref,
        now,
        now
      );
      const id = db.prepare('SELECT id FROM prompt_definitions WHERE prompt_key = ?').get(key).id;
      insertTemplate.run(id, content, content, now, now);
    }

    const result = promptTemplates.ensurePromptCatalog(db);
    assert.deepEqual(result.consolidatedPrompts, {
      definitionsDeleted: 2,
      templatesDeleted: 2,
      systemCustomizationsMigrated: 0,
      projectOverridesMigrated: 0,
    });
    const row = db.prepare(`
      SELECT t.content, t.seed_content
      FROM prompt_templates t
      JOIN prompt_definitions d ON d.id = t.definition_id
      WHERE d.prompt_key = 'storyboard.generation.system'
        AND t.scope = 'system' AND t.deleted_at IS NULL
    `).get();
    assert.equal(row.content, row.seed_content);
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

  it('ignores legacy language inputs and always resolves the canonical template', () => {
    const db = createDb();
    promptTemplates.ensurePromptCatalog(db);
    const fromEnglishRequest = promptTemplates.resolvePrompt(db, 'character.identity_anchors.user', {
      locale: 'en',
      variables: { character_appearance: 'hello' },
    });
    const fromChineseRequest = promptTemplates.resolvePrompt(db, 'character.identity_anchors.user', {
      locale: 'zh',
      variables: { character_appearance: 'hello' },
    });
    assert.equal(Object.hasOwn(fromEnglishRequest, 'locale'), false);
    assert.equal(fromEnglishRequest.content, fromChineseRequest.content);

    db.prepare(`
      UPDATE prompt_templates SET deleted_at = 'now'
      WHERE definition_id = (
        SELECT id FROM prompt_definitions WHERE prompt_key = 'story.generation.system'
      ) AND scope = 'system' AND locale = 'default'
    `).run();
    assert.throws(
      () => promptTemplates.resolvePrompt(db, 'story.generation.system', {
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
    const row = promptTemplates.listPrompts(db).find((item) => item.prompt_key === key);
    assert.throws(
      () => promptTemplates.updateSystemPrompt(db, key, 'missing variable', row.system_version),
      (err) => err.code === 'PROMPT_VALIDATION_FAILED'
    );
    const updated = promptTemplates.updateSystemPrompt(
      db,
      key,
      'CUSTOM {{character_appearance}}',
      row.system_version
    );
    assert.equal(updated.version, row.system_version + 1);
    assert.throws(
      () => promptTemplates.updateSystemPrompt(
        db,
        key,
        'STALE {{character_appearance}}',
        row.system_version
      ),
      (err) => err.code === 'VERSION_CONFLICT'
    );
    const reset = promptTemplates.resetSystemPrompt(
      db,
      key,
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
      (item) => item.prompt_key === 'character.identity_anchors.user'
    );
    promptTemplates.updateSystemPrompt(
      db,
      'character.identity_anchors.user',
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
    assert.equal(listRes.payload.data.prompts.length, 94);

    const classifiedListRes = mockResponse();
    handlers.listProject({
      params: { drama_id: '1' },
      query: {
        category: '资产',
        subcategory: '人物',
        detail_category: '图片提示词',
        workflow_stage: '资产',
      },
    }, classifiedListRes);
    assert.equal(classifiedListRes.statusCode, 200);
    assert.equal(classifiedListRes.payload.data.prompts.length, 3);
    assert.ok(classifiedListRes.payload.data.prompts.every(
      (item) => item.category === '资产'
        && item.subcategory === '人物'
        && item.detail_category === '图片提示词'
        && item.workflow_stage === '资产'
    ));

    const base = listRes.payload.data.prompts.find(
      (item) => item.prompt_key === 'character.identity_anchors.user'
    );
    assert.ok(base);
    const updateRes = mockResponse();
    handlers.updateProject({
      params: { drama_id: '1', key: 'character.identity_anchors.user' },
      body: {
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
        variables: { character_appearance: 'text' },
      }).content,
      'API PROJECT text'
    );

    const deleteRes = mockResponse();
    handlers.deleteProject({
      params: { drama_id: '1', key: 'character.identity_anchors.user' },
      body: { version: 1 },
      query: {},
    }, deleteRes);
    assert.equal(deleteRes.payload.data.effective_source, 'system');
    assert.equal(
      promptTemplates.resolvePrompt(db, 'character.identity_anchors.user', {
        dramaId: 1,
        variables: { character_appearance: 'text' },
      }).scope,
      'system'
    );
    db.close();
  });

  it('publishes every supported scene key and includes the split routes', () => {
    const scenes = listBusinessScenes();
    assert.equal(scenes.length, 22);
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
      'storyboard_image_generation',
      'video_generation',
    ]) {
      assert.ok(keys.has(key), `missing scene ${key}`);
    }
  });

  it('exposes one business template bundle per registered scene', () => {
    const db = createDb();
    promptTemplates.ensurePromptCatalog(db);
    const overview = buildBusinessSceneOverview(db);
    assert.equal(overview.length, 22);
    assert.equal(
      overview.reduce((count, scene) => count + scene.prompt_count, 0),
      94
    );
    const roleExtraction = overview.find((scene) => scene.key === 'role_extraction');
    assert.equal(roleExtraction.label, '人物 · 剧本提取');
    assert.deepEqual(
      roleExtraction.prompt_components.map((item) => item.business_slot_label),
      ['系统规则', '输入模板', '无剧本时项目资料']
    );
    assert.equal(
      overview.find((scene) => scene.key === 'storyboard_image_generation').service_type,
      'storyboard_image'
    );
    assert.equal(
      overview.find((scene) => scene.key === 'video_generation').service_type,
      'video'
    );
    db.close();
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
