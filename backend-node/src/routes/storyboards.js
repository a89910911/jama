const fs = require('fs');
const path = require('path');
const response = require('../response');
const storyboardService = require('../services/storyboardService');
const episodeStoryboardService = require('../services/episodeStoryboardService');
const framePromptService = require('../services/framePromptService');
const aiClient = require('../services/aiClient');
const promptTemplates = require('../services/promptTemplateService');
const angleService = require('../services/angleService');
const { buildUniversalSegmentUserPromptBundle } = require('../services/universalSegmentPromptBundle');
const { normalizeUniversalSegmentShotDurations } = require('../services/universalSegmentDurationNormalize');

function resolveStoryboardPrompt(db, storyboardId, promptKey, variables = {}, cfg = null) {
  const activeCfg = cfg || require('../config').loadConfig();
  return promptTemplates.resolvePromptContent(db, promptKey, {
    storyboardId,
    cfg: activeCfg,
    variables,
  });
}

/** 润色接口：邻镜结构化摘要（含全能片段与其它提示词字段） */
function formatNeighborShotPolishContext(row) {
  if (!row) return '(none)';
  const chunk = (k, v) => {
    const s = v != null && String(v).trim() ? String(v).trim() : '';
    return s ? `${k}: ${s}` : null;
  };
  const bits = [
    chunk('SHOT_NUM', row.storyboard_number),
    chunk('TITLE', row.title),
    chunk('DESCRIPTION', row.description),
    chunk('ACTION', row.action),
    chunk('DIALOGUE', row.dialogue),
    chunk('NARRATION', row.narration),
    chunk('VIDEO_PROMPT', row.video_prompt),
    chunk('UNIVERSAL_SEGMENT_TEXT', row.universal_segment_text),
  ].filter(Boolean);
  return bits.length ? bits.join('\n') : '(empty)';
}

function clipClassicCtx(s, maxLen) {
  if (s == null) return '';
  const t = String(s).trim();
  if (!t) return '';
  if (t.length <= maxLen) return t;
  return `${t.slice(0, maxLen)}…`;
}

/**
 * 从「场景：…。配乐：…」式拼装文案中拆出带标签的分句，供润色时强制保留信息点（配乐/音效/情绪强度/画幅/完整镜头英文等）。
 */
function extractRetentionClausesFromVideoPrompts(draft, composed) {
  const seen = new Set();
  const out = [];
  const sources = [draft, composed].map((x) => (x != null ? String(x).trim() : '')).filter(Boolean);
  for (const full of sources) {
    const pieces = full
      .replace(/\r\n/g, '\n')
      .trim()
      .split(/。+|\n+/)
      .map((x) => x.trim())
      .filter(Boolean);
    for (let piece of pieces) {
      piece = piece.replace(/\s*=\s*VideoRatio\s*:/gi, '=VideoRatio:').trim();
      if (!piece) continue;
      const labeled = /^(场景|镜头标题|动作|对话|对白|结果|景别|镜头角度|运镜|氛围|情绪|情绪强度|配乐|音效|时长|风格|解说旁白)[：:]/.test(
        piece
      );
      const hasRatio = /=VideoRatio\s*:/i.test(piece);
      if (!labeled && !hasRatio) continue;
      const dedupKey = piece.slice(0, 140);
      if (seen.has(dedupKey)) continue;
      seen.add(dedupKey);
      let c = piece;
      if (/^镜头角度/.test(c) && c.length > 920) c = `${c.slice(0, 920)}…`;
      else if (c.length > 560) c = `${c.slice(0, 560)}…`;
      if (!/[。．…]$/.test(c)) c += '。';
      out.push(c);
    }
  }
  return out;
}

/** 经典视频润色：邻镜长上下文（衔接剧情与已有视频文案） */
const MOVEMENT_LABEL_ZH = {
  static: '固定镜头',
  push: '推镜',
  pull: '拉镜',
  pan: '横摇',
  tilt: '纵摇',
  tracking: '跟镜',
  crane_up: '升镜',
  crane_dn: '降镜',
  orbit: '环绕',
  handheld: '手持',
};

const LIGHTING_LABEL_ZH = {
  natural: '自然光',
  front: '顺光',
  side: '侧光',
  backlit: '逆光',
  top: '顶光',
  under: '底光',
  soft: '柔光',
  dramatic: '戏剧光',
  golden_hour: '黄金时段',
  blue_hour: '蓝调时刻',
  night: '夜景',
  neon: '霓虹',
};

const DEPTH_LABEL_ZH = {
  extreme_shallow: '极浅景深',
  shallow: '浅景深',
  medium: '中景深',
  deep: '深景深（全焦）',
};

function movementDisplay(sbRow) {
  const raw = sbRow.movement != null ? String(sbRow.movement).trim() : '';
  if (!raw) return '';
  const zh = MOVEMENT_LABEL_ZH[raw];
  return zh ? `${zh}（${raw}）` : raw;
}

function lightingDisplay(sbRow) {
  const raw = sbRow.lighting_style != null ? String(sbRow.lighting_style).trim() : '';
  if (!raw) return '';
  const zh = LIGHTING_LABEL_ZH[raw];
  return zh ? `${zh}（${raw}）` : raw;
}

function depthDisplay(sbRow) {
  const raw = sbRow.depth_of_field != null ? String(sbRow.depth_of_field).trim() : '';
  if (!raw) return '';
  const zh = DEPTH_LABEL_ZH[raw];
  return zh ? `${zh}（${raw}）` : raw;
}

/** 结构化视角：中文标签 + 英文片语，供润色必覆盖清单 */
function angleCoverageLine(sbRow) {
  if (sbRow.angle_h && sbRow.angle_v && sbRow.angle_s) {
    try {
      const zh = angleService.toChineseLabel(sbRow.angle_h, sbRow.angle_v, sbRow.angle_s);
      const en = angleService.toPromptFragment(sbRow.angle_h, sbRow.angle_v, sbRow.angle_s);
      return `镜头角度（机位/景别）：${zh}；${en}`;
    } catch (_) {
      return sbRow.angle ? String(sbRow.angle).trim() : '';
    }
  }
  return sbRow.angle ? String(sbRow.angle).trim() : '';
}

/**
 * 凡非空字段逐条列出；模型须在同一段成稿中全部体现其语义（可改写，不可丢信息）。
 */
function buildClassicRequiredCoverageDigest(sbRow, linkedSceneText) {
  const lines = [];
  const add = (label, text) => {
    const s = text != null ? String(text).trim() : '';
    if (s) lines.push(`- ${label}：${s}`);
  };
  const sceneLocTime = [sbRow.location, sbRow.time].filter((x) => x != null && String(x).trim()).join('，');
  add('场景（地点与时间）', sceneLocTime);
  if (linkedSceneText) add('关联场景库（地点/时间/摘要）', linkedSceneText);
  add('镜头标题', sbRow.title);
  add('分镜描述', sbRow.description);
  add('人物动作', sbRow.action);
  add('人物对白', sbRow.dialogue);
  add('解说旁白', sbRow.narration);
  add('画面结果/落幅', sbRow.result);
  add('氛围', sbRow.atmosphere);
  add('情绪', sbRow.emotion);
  if (sbRow.emotion_intensity != null && sbRow.emotion_intensity !== '') {
    const ei = Number(sbRow.emotion_intensity);
    if (Number.isFinite(ei)) add('情绪强度', String(ei));
    else add('情绪强度', String(sbRow.emotion_intensity).trim());
  }
  add('景别', sbRow.shot_type);
  const ang = angleCoverageLine(sbRow);
  if (ang) add('镜头方式（视角/机位）', ang);
  add('光线/灯光风格', lightingDisplay(sbRow) || sbRow.lighting_style);
  add('景深', depthDisplay(sbRow) || sbRow.depth_of_field);
  add('运镜', movementDisplay(sbRow) || sbRow.movement);
  const dur = Number(sbRow.duration);
  const sec = Number.isFinite(dur) && dur > 0 ? Math.round(dur) : 5;
  add('时长（秒）', `${sec}`);
  if (sbRow.segment_title != null && String(sbRow.segment_title).trim()) {
    add('剧情段落', `「${String(sbRow.segment_title).trim()}」` + (sbRow.segment_index != null ? `（段序号 ${sbRow.segment_index}）` : ''));
  }
  if (!lines.length) return '(当前无非空结构化字段；请依据剧本与 AUTO_COMPOSED 润色)';
  return lines.join('\n');
}

function formatClassicVideoNeighborBlock(label, row) {
  if (!row) return `${label}:\n(none)`;
  const lines = [
    row.storyboard_number != null && row.storyboard_number !== ''
      ? `SHOT_NUM: ${row.storyboard_number}`
      : null,
    row.title ? `TITLE: ${clipClassicCtx(row.title, 180)}` : null,
    row.description ? `DESCRIPTION: ${clipClassicCtx(row.description, 420)}` : null,
    row.action ? `ACTION: ${clipClassicCtx(row.action, 450)}` : null,
    row.dialogue ? `DIALOGUE: ${clipClassicCtx(row.dialogue, 320)}` : null,
    row.narration ? `NARRATION: ${clipClassicCtx(row.narration, 320)}` : null,
    row.video_prompt ? `VIDEO_PROMPT: ${clipClassicCtx(row.video_prompt, 450)}` : null,
    row.universal_segment_text
      ? `UNIVERSAL_SEGMENT_TEXT: ${clipClassicCtx(row.universal_segment_text, 260)}`
      : null,
  ].filter(Boolean);
  return `${label}:\n${lines.length ? lines.join('\n') : '(empty)'}`;
}

/**
 * 分镜主图路径：storyboards.local_path 常与图生记录不同步（图在 image_generations），按存在性解析。
 * @returns {string|null} storage 相对路径
 */
function resolveStoryboardImageLocalPath(db, storageBase, storyboardId, sbRow) {
  const normalizeRel = (rel) => (rel && String(rel).trim() ? String(rel).trim().replace(/^\//, '') : '');
  const tryRel = (rel) => {
    const r = normalizeRel(rel);
    if (!r) return null;
    const abs = path.join(storageBase, r);
    return fs.existsSync(abs) ? r : null;
  };
  const fromSb = tryRel(sbRow?.local_path);
  if (fromSb) return fromSb;
  const ig = db.prepare(
    `SELECT local_path FROM image_generations
     WHERE storyboard_id = ? AND status = 'completed' AND deleted_at IS NULL
       AND local_path IS NOT NULL AND TRIM(local_path) != ''
     ORDER BY id DESC
     LIMIT 1`
  ).get(storyboardId);
  return tryRel(ig?.local_path);
}

/** 全能片段：@图片N 与中英字、引号之间补半角空格，便于模型与接口解析 */
function normalizeUniversalSegmentAtImageSpacing(text) {
  if (!text || typeof text !== 'string') return text;
  return text.replace(
    /@图片(\d+)(?=[\u4e00-\u9fffA-Za-z「『【（])/gu,
    '@图片$1 '
  );
}

function routes(db, log) {
  return {
    create: (req, res) => {
      try {
        const sb = storyboardService.createStoryboard(db, log, req.body || {});
        response.created(res, sb);
      } catch (err) {
        log.error('storyboards create', { error: err.message });
        response.internalError(res, err.message);
      }
    },
    insertBefore: (req, res) => {
      try {
        const sb = storyboardService.insertBeforeStoryboard(db, log, req.params.id);
        if (!sb) return response.notFound(res, '目标分镜不存在');
        response.created(res, sb);
      } catch (err) {
        log.error('storyboards insertBefore', { error: err.message });
        response.internalError(res, err.message);
      }
    },
    getOne: (req, res) => {
      try {
        const sb = storyboardService.getStoryboardById(db, req.params.id);
        if (!sb) return response.notFound(res, '分镜不存在');
        response.success(res, sb);
      } catch (err) {
        log.error('storyboards getOne', { error: err.message });
        response.internalError(res, err.message);
      }
    },
    update: (req, res) => {
      try {
        const sb = storyboardService.updateStoryboard(db, log, req.params.id, req.body || {});
        if (!sb) return response.notFound(res, '分镜不存在');
        response.success(res, sb);
      } catch (err) {
        log.error('storyboards update', { error: err.message });
        response.internalError(res, err.message);
      }
    },
    delete: (req, res) => {
      try {
        const ok = storyboardService.deleteStoryboard(db, log, req.params.id);
        if (!ok) return response.notFound(res, '分镜不存在');
        response.success(res, { message: '删除成功' });
      } catch (err) {
        log.error('storyboards delete', { error: err.message });
        response.internalError(res, err.message);
      }
    },
    framePrompt: (req, res) => {
      try {
        const body = req.body || {};
        const frameType = body.frame_type || 'first';
        const panelCount = body.panel_count || 3;
        const model = body.model || '';
        const taskId = framePromptService.generateFramePrompt(db, log, req.params.id, frameType, panelCount, model);
        response.success(res, {
          task_id: taskId,
          status: 'pending',
          message: '帧提示词生成任务已创建，正在后台处理...',
        });
      } catch (err) {
        log.error('storyboards frame-prompt', { error: err.message });
        if (err.message && (err.message.includes('分镜不存在') || err.message.includes('不支持的'))) {
          return response.badRequest(res, err.message);
        }
        response.internalError(res, err.message);
      }
    },
    framePromptsGet: (req, res) => {
      try {
        const list = framePromptService.getFramePrompts(db, req.params.id);
        response.success(res, { frame_prompts: list });
      } catch (err) {
        log.error('storyboards frame-prompts', { error: err.message });
        response.internalError(res, err.message);
      }
    },
    framePromptSave: (req, res) => {
      try {
        const frameType = req.params.frame_type;
        const validTypes = ['first', 'key', 'last', 'panel', 'action'];
        if (!validTypes.includes(frameType)) {
          return response.badRequest(res, '不支持的 frame_type');
        }
        const body = req.body || {};
        const prompt = typeof body.prompt === 'string' ? body.prompt : '';
        const description = typeof body.description === 'string' ? body.description : null;
        const layout = typeof body.layout === 'string' ? body.layout : null;
        if (!prompt.trim()) {
          return response.badRequest(res, 'prompt 不能为空');
        }
        framePromptService.saveFramePrompt(db, log, req.params.id, frameType, prompt, description, layout);
        response.success(res, { message: '保存成功', frame_type: frameType });
      } catch (err) {
        log.error('storyboards frame-prompt-save', { error: err.message });
        response.internalError(res, err.message);
      }
    },
    regenerateLayoutDescription: async (req, res) => {
      try {
        const id = Number(req.params.id);
        if (!id) return response.badRequest(res, '缺少分镜 id');
        const newLayout = await framePromptService.regenerateLayoutDescription(db, log, id);
        response.success(res, {
          layout_description: newLayout,
          message: '布局描述已由 AI 重新生成并保存',
        });
      } catch (err) {
        log.error('storyboards regenerateLayoutDescription', { error: err.message, id: req.params.id });
        response.internalError(res, err.message || '重新生成布局描述失败');
      }
    },
    rebuildVideoPrompt: (req, res) => {
      try {
        const id = Number(req.params.id);
        if (!id) return response.badRequest(res, '缺少分镜 id');
        const sb = episodeStoryboardService.rebuildVideoPromptForStoryboard(db, log, id);
        if (!sb) return response.notFound(res, '分镜不存在');
        response.success(res, {
          ...sb,
          message: '视频提示词已按最新规则重建并保存',
        });
      } catch (err) {
        log.error('storyboards rebuildVideoPrompt', { error: err.message, id: req.params.id });
        response.internalError(res, err.message || '重建视频提示词失败');
      }
    },
    splitByAudio: (req, res) => {
      try {
        const id = Number(req.params.id);
        if (!id) return response.badRequest(res, '缺少分镜 id');
        const result = episodeStoryboardService.splitStoryboardByAudio(db, log, id);
        response.success(res, {
          ...result,
          message: `已拆成 ${result.storyboard_ids.length} 条分镜（新增 ${result.created_count} 条）`,
        });
      } catch (err) {
        log.error('storyboards splitByAudio', { error: err.message, id: req.params.id });
        response.badRequest(res, err.message || '拆镜失败');
      }
    },
    episodeStoryboardsGenerate: (req, res) => {
      try {
        const taskId = episodeStoryboardService.generateStoryboard(
          db,
          log,
          req.params.episode_id,
          req.query.model,
          req.query.style
        );
        response.success(res, { task_id: taskId, status: 'pending', message: '分镜头生成任务已创建，正在后台处理...' });
      } catch (err) {
        log.error('episode storyboards generate', { error: err.message });
        response.internalError(res, err.message);
      }
    },
    episodeStoryboardsGet: (req, res) => {
      try {
        const list = episodeStoryboardService.getStoryboardsForEpisode(db, req.params.episode_id);
        response.success(res, { storyboards: list, total: list.length });
      } catch (err) {
        log.error('episode storyboards get', { error: err.message });
        response.internalError(res, err.message);
      }
    },

    // 独立触发单条分镜的 image prompt 优化，结果保存到 storyboards.polished_prompt 并返回
    polishPrompt: async (req, res) => {
      try {
        const sbId = Number(req.params.id);
        const sb = db.prepare(
          'SELECT id, episode_id, storyboard_number, image_prompt, action, dialogue, result, atmosphere, shot_type FROM storyboards WHERE id = ? AND deleted_at IS NULL'
        ).get(sbId);
        if (!sb) return response.notFound(res, '分镜不存在');
        if (!sb.image_prompt && !sb.action && !sb.dialogue) {
          return response.badRequest(res, '该分镜暂无可优化的内容（image_prompt / action / dialogue 均为空）');
        }

        // 通过 episode 查 drama_id
        let dramaId = null;
        try {
          const ep = db.prepare('SELECT drama_id FROM episodes WHERE id = ? AND deleted_at IS NULL').get(sb.episode_id);
          dramaId = ep?.drama_id ?? null;
        } catch (_) {}

        // 画风：mergeCfgStyleWithDrama 会把 dramas.style 的 value（如 cartoon）展开为完整提示词，与图生一致
        let styleZh = '';
        let styleEn = '';
        try {
          const loadConfig = require('../config').loadConfig;
          const { mergeCfgStyleWithDrama } = require('../utils/dramaStyleMerge');
          let cfg = loadConfig();
          const dr = dramaId
            ? db.prepare('SELECT style, metadata FROM dramas WHERE id = ? AND deleted_at IS NULL').get(dramaId)
            : null;
          cfg = mergeCfgStyleWithDrama(cfg, dr || {});
          styleEn = (cfg?.style?.default_style_en || cfg?.style?.default_style || '').trim();
          styleZh = (cfg?.style?.default_style_zh || '').trim();
        } catch (_) {}
        const styleForTokens =
          styleEn ||
          styleZh ||
          resolveStoryboardPrompt(db, sbId, 'image.default_cinematic_style');

        // 获取前后镜头上下文（含上一镜头连戏状态快照）
        let prevDesc = '(first shot)';
        let nextDesc = '(last shot)';
        let prevContinuityState = null;
        if (sb.episode_id != null && sb.storyboard_number != null) {
          const prevShot = db.prepare(
            'SELECT action, location, time, continuity_snapshot FROM storyboards WHERE episode_id = ? AND storyboard_number < ? AND deleted_at IS NULL ORDER BY storyboard_number DESC LIMIT 1'
          ).get(sb.episode_id, sb.storyboard_number);
          const nextShot = db.prepare(
            'SELECT action, location, time FROM storyboards WHERE episode_id = ? AND storyboard_number > ? AND deleted_at IS NULL ORDER BY storyboard_number ASC LIMIT 1'
          ).get(sb.episode_id, sb.storyboard_number);
          if (prevShot) {
            prevDesc = (prevShot.action || [prevShot.location, prevShot.time].filter(Boolean).join(' ')).slice(0, 120).trim() || '(first shot)';
            if (prevShot.continuity_snapshot) {
              try { prevContinuityState = JSON.parse(prevShot.continuity_snapshot); } catch (_) {}
            }
          }
          if (nextShot) nextDesc = (nextShot.action || [nextShot.location, nextShot.time].filter(Boolean).join(' ')).slice(0, 120).trim() || '(last shot)';
        }

        // 获取该分镜实际关联的角色名（优先 storyboards.characters JSON，其次 storyboard_characters 表）
        let assetNames = '';
        try {
          const nameSet = new Set();
          // 来源1：storyboards.characters JSON（[{id,name}] 或 [id, ...]）
          const sbFull = db.prepare('SELECT characters FROM storyboards WHERE id = ? AND deleted_at IS NULL').get(sbId);
          if (sbFull?.characters) {
            const parsed = JSON.parse(sbFull.characters);
            if (Array.isArray(parsed)) {
              for (const item of parsed) {
                const cid = typeof item === 'object' && item != null ? item.id : item;
                const c = db.prepare('SELECT name FROM characters WHERE id = ? AND deleted_at IS NULL').get(Number(cid));
                if (c?.name) nameSet.add(c.name);
              }
            }
          }
          // 来源2：storyboard_characters 关联表（character_libraries）
          const libLinks = db.prepare('SELECT character_id FROM storyboard_characters WHERE storyboard_id = ?').all(sbId);
          for (const link of libLinks) {
            const lib = db.prepare('SELECT name FROM character_libraries WHERE id = ? AND deleted_at IS NULL').get(link.character_id);
            if (lib?.name) nameSet.add(lib.name);
          }
          assetNames = [...nameSet].join(', ');
        } catch (_) {}

        const polishedPrompt = await aiClient.generateText(
          db,
          log,
          'text',
          resolveStoryboardPrompt(db, sbId, 'storyboard.image_polish.user', {
            style_zh: styleZh,
            style_en: styleEn,
            image_prompt: sb.image_prompt || '',
            action: sb.action || '',
            dialogue: sb.dialogue || '',
            result: sb.result || '',
            atmosphere: sb.atmosphere || '',
            shot_type: sb.shot_type || '',
            style_tokens: styleForTokens,
            assets: assetNames || 'none',
            previous_continuity_state: prevContinuityState
              ? JSON.stringify(prevContinuityState)
              : '',
            previous_context: prevDesc,
            next_context: nextDesc,
          }),
          resolveStoryboardPrompt(db, sbId, 'storyboard.image_polish.system'),
          { scene_key: 'image_polish', max_tokens: 300, temperature: 0.3 }
        );

        if (!polishedPrompt || polishedPrompt.trim().length < 10) {
          return response.badRequest(res, 'AI 返回内容过短，请检查文本模型配置');
        }

        const polished = polishedPrompt.trim();
        const nowIso = new Date().toISOString();
        db.prepare('UPDATE storyboards SET polished_prompt = ?, updated_at = ? WHERE id = ? AND deleted_at IS NULL').run(
          polished, nowIso, sbId
        );
        log.info('[分镜] polishPrompt 完成', { id: sbId, len: polished.length, has_prev_continuity: !!prevContinuityState });

        // 异步提取连戏状态快照并保存（不阻塞响应）
        const snapshotPrompt = resolveStoryboardPrompt(db, sbId, 'storyboard.continuity_snapshot.system');
        const snapshotUserPrompt = resolveStoryboardPrompt(db, sbId, 'storyboard.continuity_snapshot.user', {
          image_prompt: polished,
          assets: assetNames || 'none',
        });
        aiClient.generateText(db, log, 'text', snapshotUserPrompt, snapshotPrompt, {
          scene_key: 'continuity_snapshot', max_tokens: 200, temperature: 0.1,
        }).then((snapshotJson) => {
          if (!snapshotJson?.trim()) return;
          const cleaned = snapshotJson.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
          try {
            JSON.parse(cleaned);
            db.prepare('UPDATE storyboards SET continuity_snapshot = ?, updated_at = ? WHERE id = ? AND deleted_at IS NULL').run(
              cleaned, new Date().toISOString(), sbId
            );
            log.info('[分镜] polishPrompt 连戏快照已保存', { id: sbId });
          } catch (_) {}
        }).catch(() => {});

        response.success(res, { polished_prompt: polished });
      } catch (err) {
        log.error('storyboards polishPrompt', { error: err.message });
        response.internalError(res, err.message);
      }
    },

    /** 全能模式：根据分镜字段 AI 生成 universal_segment_text（含运镜/机位等专业描述） */
    generateUniversalSegmentPrompt: async (req, res) => {
      try {
        const sbId = Number(req.params.id);
        const built = buildUniversalSegmentUserPromptBundle(db, sbId, req.body || {}, {});
        if (!built.ok) {
          if (built.code === 'not_found') return response.notFound(res, built.message);
          return response.badRequest(res, built.message);
        }
        const { userPrompt, durationLabel, durationSec } = built;
        const out = await aiClient.generateText(
          db,
          log,
          'text',
          userPrompt,
          resolveStoryboardPrompt(db, sbId, 'omni.segment.system'),
          { scene_key: 'omni_segment_generation', max_tokens: 2400, temperature: 0.28 }
        );
        if (!out || String(out).trim().length < 20) {
          return response.badRequest(res, 'AI 返回内容过短，请检查文本模型配置');
        }
        let text = String(out).trim();
        text = normalizeUniversalSegmentShotDurations(text, durationLabel, durationSec);
        text = normalizeUniversalSegmentAtImageSpacing(text);
        const nowIso = new Date().toISOString();
        db.prepare('UPDATE storyboards SET universal_segment_text = ?, updated_at = ? WHERE id = ? AND deleted_at IS NULL').run(
          text,
          nowIso,
          sbId
        );
        log.info('[分镜] generateUniversalSegmentPrompt 完成', { id: sbId, len: text.length, duration_sec: durationSec });
        response.success(res, { universal_segment_text: text });
      } catch (err) {
        log.error('storyboards generateUniversalSegmentPrompt', { error: err.message });
        response.internalError(res, err.message);
      }
    },

    /** 全能模式：与 generateUniversalSegmentPrompt 相同逻辑，NDJSON 流式（delta + done） */
    generateUniversalSegmentStream: async (req, res) => {
      const sbId = Number(req.params.id);
      const built = buildUniversalSegmentUserPromptBundle(db, sbId, req.body || {}, {});
      if (!built.ok) {
        if (built.code === 'not_found') return response.notFound(res, built.message);
        return response.badRequest(res, built.message);
      }
      const { userPrompt, durationLabel, durationSec } = built;

      res.status(200);
      res.setHeader('Content-Type', 'application/x-ndjson; charset=utf-8');
      res.setHeader('Cache-Control', 'no-cache, no-transform');
      res.setHeader('Connection', 'keep-alive');
      if (typeof res.flushHeaders === 'function') res.flushHeaders();

      const writeNd = (obj) => {
        res.write(`${JSON.stringify(obj)}\n`);
      };

      let finalRaw = '';
      try {
        finalRaw = await aiClient.streamGenerateText(
          db,
          log,
          'text',
          userPrompt,
          resolveStoryboardPrompt(db, sbId, 'omni.segment.system'),
          {
            scene_key: 'omni_segment_generation',
            max_tokens: 2400,
            temperature: 0.28,
            silence_timeout_ms: 180000,
          },
          (delta) => writeNd({ type: 'delta', text: delta })
        );
      } catch (err) {
        log.error('storyboards generateUniversalSegmentStream', { error: err.message, id: sbId });
        writeNd({ type: 'error', message: err.message || 'stream failed' });
        return res.end();
      }

      if (!finalRaw || String(finalRaw).trim().length < 20) {
        writeNd({ type: 'error', message: 'AI 返回内容过短，请检查文本模型配置' });
        return res.end();
      }
      let text = String(finalRaw).trim();
      text = normalizeUniversalSegmentShotDurations(text, durationLabel, durationSec);
      text = normalizeUniversalSegmentAtImageSpacing(text);
      const nowIso = new Date().toISOString();
      db.prepare('UPDATE storyboards SET universal_segment_text = ?, updated_at = ? WHERE id = ? AND deleted_at IS NULL').run(
        text,
        nowIso,
        sbId
      );
      log.info('[分镜] generateUniversalSegmentStream 完成', { id: sbId, len: text.length, duration_sec: durationSec });
      writeNd({ type: 'done', universal_segment_text: text });
      res.end();
    },

    /**
     * 全能片段润色：结合整集剧本与邻镜全能/分镜字段，流式返回 NDJSON（delta + done）。
     * body.draft_universal_segment_text 必填（与编辑器一致，可为未保存到 DB 的当前文本）
     */
    polishUniversalSegmentStream: async (req, res) => {
      const sbId = Number(req.params.id);
      const draftRaw =
        req.body && req.body.draft_universal_segment_text != null
          ? String(req.body.draft_universal_segment_text)
          : '';
      const draft = draftRaw.trim();
      if (!draft) {
        return response.badRequest(res, '请先填写或生成全能片段描述后再润色（编辑器内容不能为空）');
      }
      const built = buildUniversalSegmentUserPromptBundle(db, sbId, req.body || {}, {
        universalSegmentOverride: draftRaw,
      });
      if (!built.ok) {
        if (built.code === 'not_found') return response.notFound(res, built.message);
        return response.badRequest(res, built.message);
      }
      const { userPrompt: baseUser, durationLabel, durationSec, episodeId, storyboardNumber } = built;

      let scriptText = '';
      try {
        const ep = db
          .prepare('SELECT script_content, title FROM episodes WHERE id = ? AND deleted_at IS NULL')
          .get(episodeId);
        scriptText = (ep?.script_content && String(ep.script_content).trim()) || '';
      } catch (_) {}

      let prevRow = null;
      let nextRow = null;
      try {
        prevRow = db
          .prepare(
            `SELECT storyboard_number, title, description, action, dialogue, narration, video_prompt, universal_segment_text
             FROM storyboards WHERE episode_id = ? AND storyboard_number < ? AND deleted_at IS NULL
             ORDER BY storyboard_number DESC LIMIT 1`
          )
          .get(episodeId, storyboardNumber);
        nextRow = db
          .prepare(
            `SELECT storyboard_number, title, description, action, dialogue, narration, video_prompt, universal_segment_text
             FROM storyboards WHERE episode_id = ? AND storyboard_number > ? AND deleted_at IS NULL
             ORDER BY storyboard_number ASC LIMIT 1`
          )
          .get(episodeId, storyboardNumber);
      } catch (_) {}

      const polishPassStamp = `${Date.now()}-${Math.random().toString(36).slice(2, 11)}`;
      const polishUserPrompt = resolveStoryboardPrompt(
        db,
        sbId,
        'omni.segment.polish.user',
        {
          polish_pass_stamp: polishPassStamp,
          episode_script: scriptText,
          previous_storyboard: formatNeighborShotPolishContext(prevRow),
          next_storyboard: formatNeighborShotPolishContext(nextRow),
          current_draft: draft,
          base_omni_contract: baseUser,
        }
      );

      res.status(200);
      res.setHeader('Content-Type', 'application/x-ndjson; charset=utf-8');
      res.setHeader('Cache-Control', 'no-cache, no-transform');
      res.setHeader('Connection', 'keep-alive');
      if (typeof res.flushHeaders === 'function') res.flushHeaders();

      const writeNd = (obj) => {
        res.write(`${JSON.stringify(obj)}\n`);
      };

      let finalRaw = '';
      try {
        finalRaw = await aiClient.streamGenerateText(
          db,
          log,
          'text',
          polishUserPrompt,
          resolveStoryboardPrompt(db, sbId, 'omni.segment.polish.system'),
          {
            scene_key: 'omni_segment_polish',
            max_tokens: 4096,
            temperature: 0.52,
            silence_timeout_ms: 180000,
          },
          (delta) => writeNd({ type: 'delta', text: delta })
        );
      } catch (err) {
        log.error('storyboards polishUniversalSegmentStream', { error: err.message, id: sbId });
        writeNd({ type: 'error', message: err.message || 'stream failed' });
        return res.end();
      }

      if (!finalRaw || String(finalRaw).trim().length < 20) {
        writeNd({ type: 'error', message: 'AI 返回内容过短，请检查文本模型配置' });
        return res.end();
      }
      let text = String(finalRaw).trim();
      text = normalizeUniversalSegmentShotDurations(text, durationLabel, durationSec);
      text = normalizeUniversalSegmentAtImageSpacing(text);
      const nowIso = new Date().toISOString();
      db.prepare('UPDATE storyboards SET universal_segment_text = ?, updated_at = ? WHERE id = ? AND deleted_at IS NULL').run(
        text,
        nowIso,
        sbId
      );
      log.info('[分镜] polishUniversalSegmentStream 完成', { id: sbId, len: text.length, duration_sec: durationSec });
      writeNd({ type: 'done', universal_segment_text: text });
      res.end();
    },

    /**
     * 经典分镜：结合剧本与邻镜流式润色 video_prompt（NDJSON delta + done）。
     * body.draft_video_prompt 可选，为当前编辑区全文；缺省则用库内 video_prompt，再不行则用字段自动拼装。
     */
    polishClassicVideoPromptStream: async (req, res) => {
      const sbId = Number(req.params.id);
      const sbRow = db.prepare('SELECT * FROM storyboards WHERE id = ? AND deleted_at IS NULL').get(sbId);
      if (!sbRow) return response.notFound(res, '分镜不存在');
      const mode = sbRow.creation_mode === 'universal' ? 'universal' : 'classic';
      if (mode === 'universal') {
        return response.badRequest(res, '当前为全能模式，请使用「润色全能提示词」');
      }

      let dramaId = null;
      try {
        const ep0 = db.prepare('SELECT drama_id FROM episodes WHERE id = ? AND deleted_at IS NULL').get(sbRow.episode_id);
        dramaId = ep0?.drama_id ?? null;
      } catch (_) {}

      let styleEn = '';
      let styleZh = '';
      let videoRatio = '9:16';
      try {
        const loadConfig = require('../config').loadConfig;
        const { mergeCfgStyleWithDrama } = require('../utils/dramaStyleMerge');
        let cfg = loadConfig();
        const dr = dramaId
          ? db.prepare('SELECT style, metadata FROM dramas WHERE id = ? AND deleted_at IS NULL').get(dramaId)
          : null;
        cfg = mergeCfgStyleWithDrama(cfg, dr || {});
        styleEn = (cfg?.style?.default_style_en || cfg?.style?.default_style || '').trim();
        styleZh = (cfg?.style?.default_style_zh || '').trim();
        try {
          const meta = dr?.metadata ? JSON.parse(dr.metadata) : {};
          if (meta?.aspect_ratio && String(meta.aspect_ratio).trim()) {
            videoRatio = String(meta.aspect_ratio).trim().replace(/\uFF1A/g, ':');
          }
        } catch (_) {}
      } catch (_) {}

      const autoComposed = episodeStoryboardService.composeStoryboardVideoPrompt(
        db,
        sbRow,
        styleEn || styleZh,
        videoRatio
      );
      const draftRaw =
        req.body && req.body.draft_video_prompt != null ? String(req.body.draft_video_prompt) : '';
      const draftTrim = draftRaw.trim();
      const dbVp = sbRow.video_prompt != null ? String(sbRow.video_prompt).trim() : '';
      const currentDraft = draftTrim || dbVp;
      const anchor = currentDraft || String(autoComposed || '').trim();
      if (!anchor || anchor.length < 4) {
        return response.badRequest(res, '请先填写分镜的动作/对白/场景等字段，或手写视频提示词后再润色');
      }

      let scriptText = '';
      try {
        const ep = db
          .prepare('SELECT script_content FROM episodes WHERE id = ? AND deleted_at IS NULL')
          .get(sbRow.episode_id);
        scriptText = (ep?.script_content && String(ep.script_content).trim()) || '';
      } catch (_) {}

      let prevRow = null;
      let nextRow = null;
      try {
        const num = sbRow.storyboard_number;
        const eid = sbRow.episode_id;
        prevRow = db
          .prepare(
            `SELECT storyboard_number, title, description, action, dialogue, narration, video_prompt, universal_segment_text
             FROM storyboards WHERE episode_id = ? AND storyboard_number < ? AND deleted_at IS NULL
             ORDER BY storyboard_number DESC LIMIT 1`
          )
          .get(eid, num);
        nextRow = db
          .prepare(
            `SELECT storyboard_number, title, description, action, dialogue, narration, video_prompt, universal_segment_text
             FROM storyboards WHERE episode_id = ? AND storyboard_number > ? AND deleted_at IS NULL
             ORDER BY storyboard_number ASC LIMIT 1`
          )
          .get(eid, num);
      } catch (_) {}

      let dramaTitle = '';
      let episodeTitle = '';
      let shotTotalInEpisode = 0;
      try {
        if (dramaId) {
          const drT = db.prepare('SELECT title FROM dramas WHERE id = ? AND deleted_at IS NULL').get(dramaId);
          dramaTitle = drT?.title != null ? String(drT.title).trim() : '';
        }
        const epT = db
          .prepare('SELECT title FROM episodes WHERE id = ? AND deleted_at IS NULL')
          .get(sbRow.episode_id);
        episodeTitle = epT?.title != null ? String(epT.title).trim() : '';
        const cnt = db
          .prepare(
            'SELECT COUNT(*) AS n FROM storyboards WHERE episode_id = ? AND deleted_at IS NULL'
          )
          .get(sbRow.episode_id);
        shotTotalInEpisode = cnt?.n != null ? Number(cnt.n) : 0;
      } catch (_) {}

      const firstFrameAnchor = clipClassicCtx(
        (sbRow.polished_prompt && String(sbRow.polished_prompt).trim()) ||
          (sbRow.image_prompt && String(sbRow.image_prompt).trim()) ||
          '',
        980
      );

      let linkedSceneText = '';
      try {
        if (sbRow.scene_id) {
          const sc = db
            .prepare(
              'SELECT location, time, prompt FROM scenes WHERE id = ? AND deleted_at IS NULL'
            )
            .get(sbRow.scene_id);
          if (sc) {
            const bits = [sc.location, sc.time].filter((x) => x != null && String(x).trim());
            const head = bits.join('，');
            const pr = sc.prompt != null ? String(sc.prompt).trim() : '';
            linkedSceneText = [head, pr ? `场景库文案摘要：${clipClassicCtx(pr, 280)}` : '']
              .filter(Boolean)
              .join('；');
          }
        }
      } catch (_) {}

      const fieldLines = [
        ['SHOT_NUM', sbRow.storyboard_number],
        ['TITLE', sbRow.title],
        ['DESCRIPTION', sbRow.description],
        ['LOCATION', sbRow.location],
        ['TIME', sbRow.time],
        ['DURATION_SEC', sbRow.duration],
        ['ACTION', sbRow.action],
        ['DIALOGUE', sbRow.dialogue],
        ['NARRATION', sbRow.narration],
        ['RESULT', sbRow.result],
        ['ATMOSPHERE', sbRow.atmosphere],
        ['EMOTION', sbRow.emotion],
        ['EMOTION_INTENSITY', sbRow.emotion_intensity],
        ['SHOT_TYPE', sbRow.shot_type],
        ['ANGLE_H', sbRow.angle_h],
        ['ANGLE_V', sbRow.angle_v],
        ['ANGLE_S', sbRow.angle_s],
        ['ANGLE_LEGACY', sbRow.angle],
        ['MOVEMENT', sbRow.movement],
        ['LIGHTING_STYLE', sbRow.lighting_style],
        ['DEPTH_OF_FIELD', sbRow.depth_of_field],
        ['SEGMENT_INDEX', sbRow.segment_index],
        ['SEGMENT_TITLE', sbRow.segment_title],
        ['IMAGE_PROMPT', sbRow.image_prompt],
        ['POLISHED_IMAGE_PROMPT', sbRow.polished_prompt],
      ]
        .map(([k, v]) => {
          if (v == null || v === '') return null;
          const s = String(v).trim();
          return s ? `${k}: ${s}` : null;
        })
        .filter(Boolean)
        .join('\n');

      const retentionClauses = extractRetentionClausesFromVideoPrompts(
        currentDraft || '',
        String(autoComposed || '').trim()
      );

      const polishPassStamp = `${Date.now()}-${Math.random().toString(36).slice(2, 11)}`;
      const polishUserPrompt = resolveStoryboardPrompt(
        db,
        sbId,
        'video.classic_polish.user',
        {
          polish_pass_stamp: polishPassStamp,
          drama_title: dramaTitle,
          episode_title: episodeTitle,
          shot_sequence: `${sbRow.storyboard_number ?? '?'} / ${shotTotalInEpisode || '?'}`,
          video_ratio: videoRatio,
          episode_script: scriptText,
          previous_storyboard: formatClassicVideoNeighborBlock('PREV', prevRow),
          next_storyboard: formatClassicVideoNeighborBlock('NEXT', nextRow),
          storyboard_fields: fieldLines || '(empty)',
          required_coverage: buildClassicRequiredCoverageDigest(sbRow, linkedSceneText),
          first_frame_anchor: firstFrameAnchor,
          auto_composed_prompt: autoComposed,
          current_draft: currentDraft,
          retention_clauses: retentionClauses.length
            ? retentionClauses.map((c, i) => `${i + 1}. ${c}`).join('\n')
            : '(none)',
          style_zh: styleZh,
          style_en: styleEn,
        }
      );

      res.status(200);
      res.setHeader('Content-Type', 'application/x-ndjson; charset=utf-8');
      res.setHeader('Cache-Control', 'no-cache, no-transform');
      res.setHeader('Connection', 'keep-alive');
      if (typeof res.flushHeaders === 'function') res.flushHeaders();

      const writeNd = (obj) => {
        res.write(`${JSON.stringify(obj)}\n`);
      };

      let finalRaw = '';
      try {
        finalRaw = await aiClient.streamGenerateText(
          db,
          log,
          'text',
          polishUserPrompt,
          resolveStoryboardPrompt(db, sbId, 'video.classic_polish.system'),
          {
            scene_key: 'classic_video_prompt_polish',
            max_tokens: 3600,
            temperature: 0.28,
            silence_timeout_ms: 180000,
          },
          (delta) => writeNd({ type: 'delta', text: delta })
        );
      } catch (err) {
        log.error('storyboards polishClassicVideoPromptStream', { error: err.message, id: sbId });
        writeNd({ type: 'error', message: err.message || 'stream failed' });
        return res.end();
      }

      if (!finalRaw || String(finalRaw).trim().length < 12) {
        writeNd({ type: 'error', message: 'AI 返回内容过短，请检查文本模型配置' });
        return res.end();
      }
      const text = String(finalRaw).trim();
      const nowIso = new Date().toISOString();
      db.prepare('UPDATE storyboards SET video_prompt = ?, updated_at = ? WHERE id = ? AND deleted_at IS NULL').run(
        text,
        nowIso,
        sbId
      );
      log.info('[分镜] polishClassicVideoPromptStream 完成', { id: sbId, len: text.length });
      writeNd({ type: 'done', video_prompt: text });
      res.end();
    },

    upscale: async (req, res) => {
      const id = Number(req.params.id);
      const row = db.prepare(
        'SELECT id, local_path, image_url FROM storyboards WHERE id = ? AND deleted_at IS NULL'
      ).get(id);
      if (!row) return response.notFound(res, '分镜不存在');
      try {
        const loadConfig = require('../config').loadConfig;
        const cfg = loadConfig();
        const storageBase = path.isAbsolute(cfg.storage?.local_path)
          ? cfg.storage.local_path
          : path.join(process.cwd(), cfg.storage?.local_path || './data/storage');
        const localPath = resolveStoryboardImageLocalPath(db, storageBase, id, row);
        if (!localPath) return response.badRequest(res, '分镜没有本地图片，无法超分');
        const srcFile = path.join(storageBase, localPath);
        let sharp; try { sharp = require('sharp'); } catch (_) { sharp = null; }
        if (!sharp) return response.badRequest(res, 'sharp 模块不可用，无法超分');
        const info = await sharp(srcFile).metadata();
        const scale = 2;
        const newW = (info.width || 512) * scale;
        const newH = (info.height || 512) * scale;
        const ext = path.extname(localPath) || '.jpg';
        const baseName = path.basename(localPath, ext);
        const dirName = path.dirname(localPath);
        const newRelPath = path.join(dirName, baseName + '_2x' + ext).replace(/\\/g, '/');
        const newFile = path.join(storageBase, newRelPath);
        await sharp(srcFile).resize(newW, newH, { kernel: 'lanczos3' }).toFile(newFile);
        const now = new Date().toISOString();
        db.prepare('UPDATE storyboards SET local_path = ?, updated_at = ? WHERE id = ?').run(newRelPath, now, id);
        log.info('storyboard upscale done', { id, newRelPath, newW, newH });
        response.success(res, { local_path: newRelPath, width: newW, height: newH });
      } catch (err) {
        log.error('storyboards upscale', { error: err.message });
        response.internalError(res, err.message);
      }
    },

    // 批量推断摄影参数（movement/lighting_style/depth_of_field）
    // 对 episode 下所有缺少这些字段的分镜进行快速文本推断，不调用 AI，毫秒级完成
    batchInferParams: (req, res) => {
      try {
        const episodeId = Number(req.body?.episode_id);
        const overwrite = !!req.body?.overwrite; // 是否覆盖已有值
        if (!episodeId) return response.badRequest(res, 'episode_id 必填');

        const rows = db.prepare(
          'SELECT id, angle_s, shot_type, atmosphere, time, description, action, movement, lighting_style, depth_of_field FROM storyboards WHERE episode_id = ? AND deleted_at IS NULL ORDER BY storyboard_number ASC'
        ).all(episodeId);

        let updated = 0;
        const now = new Date().toISOString();
        const stmt = db.prepare(
          'UPDATE storyboards SET movement = COALESCE(?, movement), lighting_style = COALESCE(?, lighting_style), depth_of_field = COALESCE(?, depth_of_field), updated_at = ? WHERE id = ?'
        );
        const stmtOverwrite = db.prepare(
          'UPDATE storyboards SET movement = ?, lighting_style = ?, depth_of_field = ?, updated_at = ? WHERE id = ?'
        );

        for (const row of rows) {
          const inferred = angleService.inferPhotographyParams(row);
          // 只更新缺少的字段（除非 overwrite=true）
          const newMovement   = overwrite ? inferred.movement   : (row.movement      ? null : inferred.movement);
          const newLighting   = overwrite ? inferred.lighting_style : (row.lighting_style ? null : inferred.lighting_style);
          const newDof        = overwrite ? inferred.depth_of_field : (row.depth_of_field  ? null : inferred.depth_of_field);

          if (overwrite) {
            if (inferred.movement || inferred.lighting_style || inferred.depth_of_field) {
              stmtOverwrite.run(inferred.movement, inferred.lighting_style, inferred.depth_of_field, now, row.id);
              updated++;
            }
          } else {
            if (newMovement || newLighting || newDof) {
              stmt.run(newMovement, newLighting, newDof, now, row.id);
              updated++;
            }
          }
        }

        log.info('[分镜] batchInferParams 完成', { episode_id: episodeId, total: rows.length, updated, overwrite });
        response.success(res, { total: rows.length, updated });
      } catch (err) {
        log.error('storyboards batchInferParams', { error: err.message });
        response.internalError(res, err.message);
      }
    },
  };
}

module.exports = routes;
