const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');
const fs = require('fs');
const os = require('os');
const path = require('path');
const sharp = require('sharp');
const {
  SCRIPT_OUTPUT_SCHEMA,
  inferIntent,
  parseScriptResult,
  persistCodexImage,
} = require('../src/services/codexChatService');
const {
  RESOURCE_OUTPUT_SCHEMA,
  detectResourceScopes,
  parseResourceResult,
  persistExtractedResources,
  listResourceImageTargets,
  filterResourceTargetsByRequest,
} = require('../src/services/codexResourceService');
const {
  createStoryboardOutputSchema,
  estimateStoryboardPlan,
  parseStoryboardResult,
} = require('../src/services/codexStoryboardService');
const {
  INTENT_PLAN_SCHEMA,
  createLocalIntentPlan,
  detectPreparation,
  extractStoryboardNumbers,
  needsContextualPlanning,
  parseIntentPlan,
} = require('../src/services/codexIntentService');
const {
  listResourcePromptTargets,
  listStoryboardEditTargets,
  persistResourcePromptUpdates,
  persistStoryboardUpdates,
  validateStructuredUpdates,
} = require('../src/services/codexEditingService');
const dramaService = require('../src/services/dramaService');

function createEpisodeDb() {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE dramas (
      id INTEGER PRIMARY KEY,
      title TEXT,
      metadata TEXT,
      updated_at TEXT,
      deleted_at TEXT
    );
    CREATE TABLE episodes (
      id INTEGER PRIMARY KEY,
      drama_id INTEGER,
      episode_number INTEGER,
      title TEXT,
      script_content TEXT,
      updated_at TEXT,
      deleted_at TEXT
    );
  `);
  db.prepare("INSERT INTO dramas (id, title) VALUES (4, '测试短剧')").run();
  db.prepare(
    "INSERT INTO episodes (id, drama_id, episode_number, title, script_content) VALUES (?, 4, ?, ?, ?)"
  ).run(8, 8, '第八集', '旧内容八');
  db.prepare(
    "INSERT INTO episodes (id, drama_id, episode_number, title, script_content) VALUES (?, 4, ?, ?, ?)"
  ).run(9, 9, '第九集', '旧内容九');
  return db;
}

function createResourceDb() {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE dramas (
      id INTEGER PRIMARY KEY,
      title TEXT,
      description TEXT,
      style TEXT,
      metadata TEXT,
      created_at TEXT,
      updated_at TEXT,
      deleted_at TEXT
    );
    CREATE TABLE episodes (
      id INTEGER PRIMARY KEY,
      drama_id INTEGER,
      episode_number INTEGER,
      title TEXT,
      script_content TEXT,
      updated_at TEXT,
      deleted_at TEXT
    );
    CREATE TABLE characters (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      drama_id INTEGER,
      name TEXT,
      role TEXT,
      description TEXT,
      personality TEXT,
      appearance TEXT,
      voice_style TEXT,
      polished_prompt TEXT,
      image_url TEXT,
      local_path TEXT,
      sort_order INTEGER,
      created_at TEXT,
      updated_at TEXT,
      deleted_at TEXT
    );
    CREATE TABLE episode_characters (
      episode_id INTEGER,
      character_id INTEGER,
      PRIMARY KEY (episode_id, character_id)
    );
    CREATE TABLE props (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      drama_id INTEGER,
      episode_id INTEGER,
      name TEXT,
      type TEXT,
      description TEXT,
      prompt TEXT,
      negative_prompt TEXT,
      image_url TEXT,
      local_path TEXT,
      extra_images TEXT,
      ref_image TEXT,
      created_at TEXT,
      updated_at TEXT,
      deleted_at TEXT
    );
    CREATE TABLE scenes (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      drama_id INTEGER,
      episode_id INTEGER,
      location TEXT,
      time TEXT,
      prompt TEXT,
      polished_prompt TEXT,
      image_url TEXT,
      local_path TEXT,
      extra_images TEXT,
      ref_image TEXT,
      storyboard_count INTEGER,
      status TEXT,
      created_at TEXT,
      updated_at TEXT,
      deleted_at TEXT
    );
    CREATE TABLE storyboards (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      episode_id INTEGER,
      storyboard_number INTEGER,
      title TEXT,
      description TEXT,
      location TEXT,
      time TEXT,
      duration REAL,
      action TEXT,
      dialogue TEXT,
      narration TEXT,
      result TEXT,
      atmosphere TEXT,
      shot_type TEXT,
      angle TEXT,
      movement TEXT,
      lighting_style TEXT,
      depth_of_field TEXT,
      layout_description TEXT,
      image_prompt TEXT,
      polished_prompt TEXT,
      video_prompt TEXT,
      characters TEXT,
      scene_id INTEGER,
      updated_at TEXT,
      deleted_at TEXT
    );
    CREATE TABLE storyboard_props (
      storyboard_id INTEGER,
      prop_id INTEGER,
      PRIMARY KEY (storyboard_id, prop_id)
    );
  `);
  db.prepare(
    "INSERT INTO dramas (id, title, description, style, metadata) VALUES (5, '资源测试', '测试简介', '写实', '{\"aspect_ratio\":\"9:16\"}')"
  ).run();
  db.prepare(
    "INSERT INTO episodes (id, drama_id, episode_number, title, script_content) VALUES (13, 5, 1, '第一集', '角色甲拿起银色钥匙进入古堡。')"
  ).run();
  return db;
}

describe('Codex chat intent and structured result', () => {
  it('routes script and native image requests without consulting AI configs', () => {
    assert.equal(inferIntent('帮我生成当前集剧本'), 'generate_story');
    assert.equal(inferIntent('生成一张月光森林插画'), 'generate_image');
    assert.equal(inferIntent('生成资源文本，生成角色、道具和场景'), 'extract_resources');
    assert.equal(inferIntent('生成角色图片、道具图片和场景图片'), 'generate_resource_images');
    assert.equal(inferIntent('生成所有分镜'), 'generate_storyboards');
    assert.equal(inferIntent('生成所有分镜图片'), 'generate_storyboard_images');
    assert.equal(inferIntent('生成第3个分镜图片'), 'generate_storyboard_images');
    assert.equal(
      inferIntent('重新生成所有分镜，补充每条说明和画面布局'),
      'generate_storyboards'
    );
    assert.equal(inferIntent('把这一集改写得更紧张'), 'rewrite_current_episode');
    assert.equal(inferIntent('人物为什么要进入森林？'), 'chat');
    assert.equal(inferIntent('这个剧本有什么问题？'), 'chat');
    assert.equal(inferIntent('刚才生成的图片为什么没有入库？'), 'chat');
    assert.equal(inferIntent('查看所有分镜图片'), 'chat');
    assert.equal(inferIntent('分析一下现有角色图片'), 'chat');
    assert.equal(inferIntent('所有分镜有哪些问题？'), 'chat');
    assert.equal(inferIntent('把这一集的节奏调整得更紧张一些'), 'chat');
    assert.equal(inferIntent('生成第2个分镜的通用优化提示词'), 'optimize_storyboard_prompt');
    assert.equal(inferIntent('优化第2个分镜的视频提示词'), 'optimize_storyboard_prompt');
    assert.equal(inferIntent('补充所有分镜说明和布局'), 'update_storyboard_details');
    assert.equal(inferIntent('优化所有角色的图生提示词'), 'optimize_resource_prompt');
    assert.equal(inferIntent('重新生成凯尔角色图片'), 'generate_resource_images');
  });

  it('parses the app-server output schema result', () => {
    const result = parseScriptResult(JSON.stringify({
      assistant_reply: '已完成',
      episodes: [{
        episode_number: 9,
        title: '宝石之夜',
        script_content: '少女与狐狸发现宝石。',
      }],
    }));
    assert.equal(SCRIPT_OUTPUT_SCHEMA.properties.episodes.minItems, 1);
    assert.equal(result.assistant_reply, '已完成');
    assert.equal(result.episodes[0].script_content, '少女与狐狸发现宝石。');
  });
});

describe('Codex natural-language intent planning', () => {
  it('accepts structured Codex plans and safely rejects low-confidence mutations', () => {
    assert.deepEqual(INTENT_PLAN_SCHEMA.properties.intent.enum, [
      'chat',
      'generate_story',
      'rewrite_current_episode',
      'continue_current_episode',
      'extract_resources',
      'generate_resource_images',
      'generate_storyboards',
      'generate_storyboard_images',
      'generate_image',
      'optimize_resource_prompt',
      'update_storyboard_details',
      'optimize_storyboard_prompt',
    ]);
    const plan = parseIntentPlan(JSON.stringify({
      intent: 'generate_storyboard_images',
      confidence: 0.96,
      normalized_request: '为当前集所有分镜逐项生成独立首帧图片',
      reason: '用户要求每一镜都有画面',
      resource_scopes: [],
      resource_names: [],
      storyboard_numbers: [2],
      prompt_fields: [],
      detail_fields: [],
      target_all: false,
      prepare_source: false,
      force_regenerate: false,
    }), '让每一镜都有画面');
    assert.equal(plan.intent, 'generate_storyboard_images');
    assert.equal(plan.source, 'codex_planner');
    assert.deepEqual(plan.storyboard_numbers, [2]);

    const uncertain = parseIntentPlan(JSON.stringify({
      intent: 'rewrite_current_episode',
      confidence: 0.4,
      normalized_request: '讨论当前剧本节奏',
      reason: '没有明确要求覆盖',
      resource_scopes: [],
      resource_names: [],
      storyboard_numbers: [],
      prompt_fields: [],
      detail_fields: [],
      target_all: false,
      prepare_source: false,
      force_regenerate: false,
    }));
    assert.equal(uncertain.intent, 'chat');
  });

  it('detects compound preparation and overwrite instructions', () => {
    assert.equal(
      detectPreparation(
        'generate_resource_images',
        '先提取角色、道具、场景说明，然后分别生成图片'
      ),
      true
    );
    assert.equal(
      detectPreparation(
        'generate_storyboard_images',
        '先把剧本拆分为分镜，再给每个分镜生成首帧图片'
      ),
      true
    );
    const plan = createLocalIntentPlan(
      'generate_storyboard_images',
      '重新生成所有分镜图片并覆盖',
      'rule'
    );
    assert.equal(plan.force_regenerate, true);
    assert.deepEqual(extractStoryboardNumbers('第二镜和第12条分镜都需要首帧'), [2, 12]);
    assert.equal(needsContextualPlanning('刚才那张角色图我不满意，重新生成一张'), true);
    assert.equal(needsContextualPlanning('重新生成凯尔角色图片'), false);
  });
});

describe('Codex storyboard generation', () => {
  it('requires a complete exact-size structured storyboard result', () => {
    const schema = createStoryboardOutputSchema(2);
    assert.equal(schema.properties.storyboards.minItems, 2);
    assert.equal(schema.properties.storyboards.maxItems, 2);
    const item = (number) => ({
      shot_number: number,
      segment_index: 0,
      segment_title: '开场',
      title: `镜头${number}`,
      location: '森林',
      time: '夜晚',
      scene_id: 0,
      shot_type: '中景',
      angle: '平视',
      movement: 'push',
      lighting_style: 'night',
      depth_of_field: 'medium',
      action: '少女向前走',
      dialogue: '',
      narration: '',
      result: '少女停在树下',
      atmosphere: '神秘',
      emotion: '警觉',
      emotion_intensity: 1,
      duration: 5,
      bgm_prompt: '',
      sound_effect: '风声',
      characters: [1],
      props: [],
      layout_description: '少女位于画面右侧，树木形成前景框架。',
    });
    const parsed = parseStoryboardResult(JSON.stringify({
      assistant_reply: '已完成',
      storyboards: [item(8), item(9)],
    }), 2);
    assert.deepEqual(parsed.storyboards.map((row) => row.shot_number), [1, 2]);
    assert.equal(parsed.storyboards[0].scene_id, null);
    assert.throws(
      () => parseStoryboardResult(JSON.stringify({ storyboards: [item(1)] }), 2),
      /完整任务要求 2 条/
    );
  });

  it('uses the same script-duration estimate as the creation page', () => {
    const plan = estimateStoryboardPlan(
      { script_content: '字'.repeat(1350) },
      { metadata: JSON.stringify({ video_clip_duration: 5, aspect_ratio: '9:16' }) },
      { content: '生成所有分镜' }
    );
    assert.deepEqual(plan, {
      storyboardCount: 29,
      videoDuration: 145,
      clipDuration: 5,
      aspectRatio: '9:16',
    });
    assert.equal(
      estimateStoryboardPlan(
        { script_content: '短剧本' },
        { metadata: '{}' },
        { content: '请生成12个分镜' }
      ).storyboardCount,
      12
    );
  });
});

describe('Codex prompt and storyboard field editing', () => {
  it('targets named resources and persists optimized image prompts', () => {
    const db = createResourceDb();
    const session = { drama_id: 5, episode_id: 13 };
    persistExtractedResources(db, null, session, {
      characters: [{
        name: '凯尔',
        role: '主角',
        description: '黑狼首领',
        personality: '冷峻',
        appearance: '黑发黑西装',
        image_prompt: '旧角色提示词',
      }],
      props: [],
      scenes: [],
    });
    const targets = listResourcePromptTargets(db, session, {
      resource_scopes: ['character'],
      resource_names: ['凯尔'],
      target_all: false,
    }, '优化凯尔的图生提示词');
    assert.equal(targets.length, 1);
    const parsed = validateStructuredUpdates(JSON.stringify({
      assistant_reply: '已优化',
      updates: [{
        target_id: targets[0].targetId,
        optimized_prompt: '单个黑发男性角色，黑色西装，冷峻狼王气质，独立角色设定图。',
      }],
    }), targets, ['optimized_prompt']);
    const saved = persistResourcePromptUpdates(db, session, targets, parsed);
    assert.equal(saved[0].name, '凯尔');
    assert.match(
      db.prepare('SELECT polished_prompt FROM characters WHERE id = ?').get(targets[0].targetId).polished_prompt,
      /独立角色设定图/
    );
  });

  it('targets one storyboard and atomically updates selected edit fields', () => {
    const db = createResourceDb();
    db.prepare(
      `INSERT INTO storyboards
        (episode_id, storyboard_number, title, description, action, result,
         layout_description, image_prompt, polished_prompt, video_prompt, characters)
       VALUES (13, 2, '旧标题', '旧说明', '旧动作', '旧结果', '旧布局', '旧原始', '旧优化', '旧视频', '[]')`
    ).run();
    db.prepare(
      `INSERT INTO storyboards
        (episode_id, storyboard_number, title, description, action, result,
         layout_description, image_prompt, polished_prompt, video_prompt, characters)
       VALUES (13, 3, '第三镜', '保持不变', '', '', '', '', '', '', '[]')`
    ).run();
    const session = { drama_id: 5, episode_id: 13 };
    const targets = listStoryboardEditTargets(db, session, {
      storyboard_numbers: [2],
      target_all: false,
    }, '优化第二镜');
    assert.equal(targets.length, 1);
    assert.equal(targets[0].storyboardNumber, 2);
    const parsed = validateStructuredUpdates(JSON.stringify({
      assistant_reply: '已优化',
      updates: [{
        target_id: targets[0].targetId,
        polished_prompt: '第2镜完整通用优化图片提示词',
        video_prompt: '第2镜从装甲车急停到水花落下的视频提示词',
      }],
    }), targets, ['polished_prompt', 'video_prompt']);
    persistStoryboardUpdates(
      db,
      session,
      targets,
      parsed,
      ['polished_prompt', 'video_prompt']
    );
    const row2 = db.prepare(
      'SELECT polished_prompt, video_prompt FROM storyboards WHERE storyboard_number = 2'
    ).get();
    const row3 = db.prepare(
      'SELECT description FROM storyboards WHERE storyboard_number = 3'
    ).get();
    assert.match(row2.polished_prompt, /通用优化/);
    assert.match(row2.video_prompt, /装甲车急停/);
    assert.equal(row3.description, '保持不变');
  });
});

describe('Codex resource extraction and persistence', () => {
  it('parses structured resources, saves them idempotently and returns image targets', () => {
    const db = createResourceDb();
    const parsed = parseResourceResult(JSON.stringify({
      assistant_reply: '资源已整理',
      characters: [{
        name: '角色甲',
        role: '主角',
        description: '勇敢的调查员',
        personality: '冷静',
        appearance: '黑发，深色风衣',
        image_prompt: '单人黑发调查员角色图',
      }],
      props: [{
        name: '银色钥匙',
        type: '剧情道具',
        description: '古老银色钥匙',
        image_prompt: '纯背景银色钥匙产品图',
      }],
      scenes: [{
        location: '古堡大厅',
        time: '夜晚',
        description: '月光照进废弃大厅',
        image_prompt: '无人物的月夜古堡大厅',
      }],
    }));
    assert.equal(RESOURCE_OUTPUT_SCHEMA.properties.characters.maxItems, 20);
    assert.deepEqual(detectResourceScopes('只生成角色和场景'), ['character', 'scene']);

    const session = { drama_id: 5, episode_id: 13 };
    const saved = persistExtractedResources(db, { info() {} }, session, parsed);
    assert.deepEqual(saved.counts, { characters: 1, props: 1, scenes: 1 });
    assert.equal(
      db.prepare('SELECT COUNT(*) n FROM episode_characters WHERE episode_id = 13').get().n,
      1
    );
    const targets = listResourceImageTargets(db, session, ['character', 'prop', 'scene']);
    assert.deepEqual(
      targets.map((item) => item.targetType),
      ['character', 'prop', 'scene']
    );
    assert.deepEqual(
      filterResourceTargetsByRequest(targets, '只生成角色甲图片').map((item) => item.name),
      ['角色甲']
    );

    parsed.characters[0].description = '更新后的调查员说明';
    persistExtractedResources(db, { info() {} }, session, parsed);
    assert.equal(db.prepare('SELECT COUNT(*) n FROM characters').get().n, 1);
    assert.equal(db.prepare('SELECT COUNT(*) n FROM props').get().n, 1);
    assert.equal(db.prepare('SELECT COUNT(*) n FROM scenes').get().n, 1);
    assert.equal(
      db.prepare('SELECT description FROM characters WHERE name = ?').get('角色甲').description,
      '更新后的调查员说明'
    );
    db.close();
  });
});

describe('dramaService.updateEpisodeScript', () => {
  it('updates only the selected episode and preserves every other episode', () => {
    const db = createEpisodeDb();
    const updated = dramaService.updateEpisodeScript(
      db,
      { info() {} },
      4,
      9,
      { title: '新的第九集', script_content: '新内容九' }
    );

    assert.equal(updated.title, '新的第九集');
    assert.equal(updated.script_content, '新内容九');
    assert.deepEqual(
      db.prepare('SELECT id, title, script_content, deleted_at FROM episodes ORDER BY id').all(),
      [
        { id: 8, title: '第八集', script_content: '旧内容八', deleted_at: null },
        { id: 9, title: '新的第九集', script_content: '新内容九', deleted_at: null },
      ]
    );
    db.close();
  });

  it('refuses to update an episode from another drama', () => {
    const db = createEpisodeDb();
    assert.equal(
      dramaService.updateEpisodeScript(db, { info() {} }, 5, 9, { script_content: '越权写入' }),
      null
    );
    assert.equal(
      db.prepare('SELECT script_content FROM episodes WHERE id = 9').get().script_content,
      '旧内容九'
    );
    db.close();
  });
});

describe('persistCodexImage', () => {
  it('copies an allowed Codex image into project storage and records generation plus asset', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'jama-codex-image-test-'));
    const allowedRoot = path.join(root, 'generated_images');
    const storageRoot = path.join(root, 'storage');
    fs.mkdirSync(allowedRoot, { recursive: true });
    const source = path.join(allowedRoot, 'native-image.png');
    await sharp({
      create: {
        width: 12,
        height: 10,
        channels: 3,
        background: { r: 20, g: 80, b: 160 },
      },
    }).png().toFile(source);

    const db = new Database(':memory:');
    db.exec(`
      CREATE TABLE dramas (
        id INTEGER PRIMARY KEY,
        title TEXT,
        metadata TEXT,
        created_at TEXT,
        updated_at TEXT,
        deleted_at TEXT
      );
      CREATE TABLE image_generations (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        storyboard_id INTEGER,
        drama_id INTEGER,
        episode_id INTEGER,
        scene_id INTEGER,
        character_id INTEGER,
        provider TEXT,
        prompt TEXT,
        model TEXT,
        frame_type TEXT,
        size TEXT,
        image_url TEXT,
        local_path TEXT,
        width INTEGER,
        height INTEGER,
        status TEXT,
        task_id TEXT,
        completed_at TEXT,
        created_at TEXT,
        updated_at TEXT,
        deleted_at TEXT
      );
      CREATE TABLE assets (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        drama_id INTEGER,
        name TEXT,
        type TEXT,
        category TEXT,
        url TEXT,
        local_path TEXT,
        file_size INTEGER,
        mime_type TEXT,
        width INTEGER,
        height INTEGER,
        duration REAL,
        image_gen_id INTEGER,
        video_gen_id INTEGER,
        created_at TEXT,
        updated_at TEXT,
        deleted_at TEXT
      );
      CREATE TABLE storyboards (
        id INTEGER PRIMARY KEY,
        image_url TEXT,
        local_path TEXT,
        first_frame_image_id INTEGER,
        updated_at TEXT,
        deleted_at TEXT
      );
    `);
    db.prepare(
      "INSERT INTO dramas (id, title, metadata, created_at) VALUES (4, '图片项目', '{}', '2026-07-20T00:00:00.000Z')"
    ).run();
    db.prepare('INSERT INTO storyboards (id) VALUES (21)').run();

    try {
      const result = await persistCodexImage(
        db,
        { info() {} },
        { storage: { local_path: storageRoot } },
        {
          dramaId: 4,
          storyboardId: 21,
          frameType: 'first',
          taskId: 'codex-image-task',
          prompt: '月光森林',
          revisedPrompt: 'moonlit forest',
          savedPath: source,
          allowedImageRoot: allowedRoot,
        }
      );
      const generation = db.prepare('SELECT * FROM image_generations WHERE id = ?').get(result.image_generation_id);
      const asset = db.prepare('SELECT * FROM assets WHERE id = ?').get(result.asset_id);

      assert.equal(generation.provider, 'codex_app_server');
      assert.equal(generation.storyboard_id, 21);
      assert.equal(generation.status, 'completed');
      assert.equal(generation.width, 12);
      assert.equal(generation.height, 10);
      assert.equal(asset.image_gen_id, generation.id);
      assert.deepEqual(
        db.prepare(
          'SELECT image_url, local_path, first_frame_image_id FROM storyboards WHERE id = 21'
        ).get(),
        {
          image_url: result.url,
          local_path: result.local_path,
          first_frame_image_id: generation.id,
        }
      );
      assert.equal(fs.existsSync(path.join(storageRoot, ...result.local_path.split('/'))), true);
    } finally {
      db.close();
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
});
