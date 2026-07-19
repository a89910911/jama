/**
 * 全能片段（Omni / Seedance 多图参考）用户消息构建：供「生成」与「润色」共用。
 * @param {import('better-sqlite3').Database} db
 * @param {number} sbId
 * @param {object} reqBody 可选 duration、force_without_reference_images（为 true 时不校验场景/角色/道具是否已上图，仍构建提示词）
 * @param {{ universalSegmentOverride?: string | undefined }} opts 若传入则覆盖库中的 universal 写入 CURRENT_UNIVERSAL_SEGMENT
 * @returns {{ ok:true, userPrompt:string, durationLabel:string, durationSec:number, sbId:number, episodeId:number, storyboardNumber:number } | { ok:false, code:'not_found'|'bad_request', message:string }}
 */
const promptTemplates = require('./promptTemplateService');

function buildUniversalSegmentUserPromptBundle(db, sbId, reqBody, opts = {}) {
  const bodyIn = reqBody && typeof reqBody === 'object' ? reqBody : {};
  const forceWithoutReferenceImages = !!bodyIn.force_without_reference_images;
  const resolveFragment = (promptKey, variables = {}) =>
    promptTemplates.resolvePromptContent(db, promptKey, {
      storyboardId: sbId,
      locale: 'universal',
      variables,
    });

  const sb = db.prepare(
    `SELECT id, episode_id, storyboard_number, scene_id, title, description, location, time,
      action, dialogue, narration, result, atmosphere,
      image_prompt, polished_prompt, video_prompt, universal_segment_text,
      shot_type, angle, angle_h, angle_v, angle_s, movement, lighting_style, depth_of_field,
      characters, local_path, duration, segment_index, segment_title
     FROM storyboards WHERE id = ? AND deleted_at IS NULL`
  ).get(sbId);
  if (!sb) return { ok: false, code: 'not_found', message: '分镜不存在' };

  let dramaId = null;
  let dramaRow = null;
  try {
    const epRow = db.prepare('SELECT drama_id FROM episodes WHERE id = ? AND deleted_at IS NULL').get(sb.episode_id);
    dramaId = epRow?.drama_id ?? null;
    if (dramaId) {
      dramaRow = db.prepare('SELECT title, genre, style, metadata FROM dramas WHERE id = ? AND deleted_at IS NULL').get(dramaId);
    }
  } catch (_) {}

  let styleZh = '';
  let styleEn = '';
  try {
    const loadConfig = require('../config').loadConfig;
    const { mergeCfgStyleWithDrama } = require('../utils/dramaStyleMerge');
    let cfg = loadConfig();
    cfg = mergeCfgStyleWithDrama(cfg, dramaRow || {});
    styleEn = (cfg?.style?.default_style_en || cfg?.style?.default_style || '').trim();
    styleZh = (cfg?.style?.default_style_zh || '').trim();
  } catch (_) {}

  const chunk = (k, v) => {
    const s = v != null && String(v).trim() ? String(v).trim() : '';
    return s ? `${k}: ${s}` : null;
  };

  const universalForLine =
    opts.universalSegmentOverride !== undefined ? opts.universalSegmentOverride : sb.universal_segment_text;

  const lines = [
    chunk('TITLE', sb.title),
    chunk('DESCRIPTION', sb.description),
    chunk('LOCATION', sb.location),
    chunk('TIME', sb.time),
    chunk('ACTION', sb.action),
    chunk('DIALOGUE', sb.dialogue),
    chunk('NARRATION', sb.narration),
    chunk('RESULT', sb.result),
    chunk('ATMOSPHERE', sb.atmosphere),
    chunk('IMAGE_PROMPT', sb.image_prompt),
    chunk('POLISHED_IMAGE_PROMPT', sb.polished_prompt),
    chunk('VIDEO_PROMPT', sb.video_prompt),
    chunk('SHOT_TYPE', sb.shot_type),
    chunk('ANGLE', sb.angle),
    chunk('ANGLE_H', sb.angle_h),
    chunk('ANGLE_V', sb.angle_v),
    chunk('ANGLE_S', sb.angle_s),
    chunk('MOVEMENT', sb.movement),
    chunk('LIGHTING', sb.lighting_style),
    chunk('DEPTH_OF_FIELD', sb.depth_of_field),
    chunk('CURRENT_UNIVERSAL_SEGMENT', universalForLine),
  ].filter(Boolean);

  const hasMediaRef = (row) =>
    row && (String(row.local_path || '').trim() !== '' || String(row.image_url || '').trim() !== '');

  let sceneRow = null;
  let sceneBlock = '';
  if (sb.scene_id) {
    try {
      sceneRow = db
        .prepare('SELECT location, time, prompt, image_url, local_path FROM scenes WHERE id = ? AND deleted_at IS NULL')
        .get(sb.scene_id);
      if (sceneRow) {
        const scBits = [
          chunk('SCENE_LOCATION', sceneRow.location),
          chunk('SCENE_TIME', sceneRow.time),
          chunk('SCENE_PROMPT', sceneRow.prompt),
          hasMediaRef(sceneRow) ? 'SCENE_HAS_REFERENCE_IMAGE: yes' : 'SCENE_HAS_REFERENCE_IMAGE: no',
        ].filter(Boolean);
        sceneBlock = scBits.join('\n');
      }
    } catch (_) {}
  }

  const charOrderEntries = [];
  const charKeySeen = new Set();
  const pushCharEntry = (key, nameHint) => {
    if (!key || charKeySeen.has(key)) return;
    charKeySeen.add(key);
    charOrderEntries.push({
      key,
      nameHint: nameHint != null && String(nameHint).trim() ? String(nameHint).trim() : '',
    });
  };
  /** 与前端 collectSbOmniReferenceAbsoluteUrls / 视频 API 参考图顺序一致：仅以分镜 characters JSON 的本剧角色顺序为准，避免再追加 storyboard_characters 导致槽位与界面 @图片N 错位。 */
  let charOrderFromDramaJson = false;
  try {
    if (sb.characters) {
      const parsed = JSON.parse(sb.characters);
      if (Array.isArray(parsed)) {
        for (const item of parsed) {
          const cid = typeof item === 'object' && item != null ? item.id : item;
          const idNum = Number(cid);
          if (!Number.isFinite(idNum)) continue;
          const nm =
            typeof item === 'object' && item != null && item.name != null ? String(item.name).trim() : '';
          pushCharEntry(`drama:${idNum}`, nm);
        }
        if (charOrderEntries.length > 0) charOrderFromDramaJson = true;
      }
    }
    if (!charOrderFromDramaJson) {
      const libLinks = db
        .prepare('SELECT character_id FROM storyboard_characters WHERE storyboard_id = ? ORDER BY id ASC')
        .all(sbId);
      for (const link of libLinks) {
        const lid = Number(link.character_id);
        if (!Number.isFinite(lid)) continue;
        pushCharEntry(`lib:${lid}`, '');
      }
    }
  } catch (_) {}

  const charNamesOrdered = [];
  const nameSeen = new Set();
  for (const ent of charOrderEntries) {
    let row = null;
    if (ent.key.startsWith('drama:')) {
      row = db.prepare('SELECT name FROM characters WHERE id = ? AND deleted_at IS NULL').get(Number(ent.key.slice(6)));
    } else if (ent.key.startsWith('lib:')) {
      row = db.prepare('SELECT name FROM character_libraries WHERE id = ? AND deleted_at IS NULL').get(Number(ent.key.slice(4)));
    }
    const nm = (row?.name || ent.nameHint || '').trim();
    if (nm && !nameSeen.has(nm)) {
      nameSeen.add(nm);
      charNamesOrdered.push(nm);
    }
  }
  const charNames = charNamesOrdered.join(', ');

  let propRows = [];
  try {
    propRows =
      db
        .prepare(
          `SELECT p.id, p.name, p.local_path, p.image_url FROM storyboard_props sp
         JOIN props p ON p.id = sp.prop_id AND p.deleted_at IS NULL
         WHERE sp.storyboard_id = ?
         ORDER BY sp.prop_id ASC`
        )
        .all(sbId) || [];
  } catch (_) {
    propRows = [];
  }
  const propNamesOrdered = [];
  const propSeen = new Set();
  for (const r of propRows) {
    const n = r?.name != null && String(r.name).trim() ? String(r.name).trim() : '';
    if (n && !propSeen.has(n)) {
      propSeen.add(n);
      propNamesOrdered.push(n);
    }
  }
  const propNames = propNamesOrdered;

  let prevDesc = '(first shot)';
  let nextDesc = '(last shot)';
  if (sb.episode_id != null && sb.storyboard_number != null) {
    const prevShot = db
      .prepare(
        'SELECT action, location, time FROM storyboards WHERE episode_id = ? AND storyboard_number < ? AND deleted_at IS NULL ORDER BY storyboard_number DESC LIMIT 1'
      )
      .get(sb.episode_id, sb.storyboard_number);
    const nextShot = db
      .prepare(
        'SELECT action, location, time FROM storyboards WHERE episode_id = ? AND storyboard_number > ? AND deleted_at IS NULL ORDER BY storyboard_number ASC LIMIT 1'
      )
      .get(sb.episode_id, sb.storyboard_number);
    if (prevShot) {
      prevDesc =
        (prevShot.action || [prevShot.location, prevShot.time].filter(Boolean).join(' ')).slice(0, 160).trim() ||
        '(first shot)';
    }
    if (nextShot) {
      nextDesc =
        (nextShot.action || [nextShot.location, nextShot.time].filter(Boolean).join(' ')).slice(0, 160).trim() ||
        '(last shot)';
    }
  }

  const slots = [];
  const pushSlot = (kind, summary) => {
    const num = slots.length + 1;
    const brief = String(summary || '').trim() || kind;
    slots.push({ num, tag: `@图片${num}`, kind, summary: brief });
  };
  if (sceneRow && hasMediaRef(sceneRow)) {
    pushSlot('场景', String(sceneRow.location || '').trim() || '场景环境');
  }
  for (const ent of charOrderEntries) {
    let row = null;
    if (ent.key.startsWith('drama:')) {
      row = db
        .prepare('SELECT name, local_path, image_url FROM characters WHERE id = ? AND deleted_at IS NULL')
        .get(Number(ent.key.slice(6)));
    } else if (ent.key.startsWith('lib:')) {
      row = db
        .prepare('SELECT name, local_path, image_url FROM character_libraries WHERE id = ? AND deleted_at IS NULL')
        .get(Number(ent.key.slice(4)));
    }
    if (!hasMediaRef(row)) continue;
    const cn = String(row.name || ent.nameHint || '角色').trim();
    pushSlot('角色', cn);
  }
  for (const pr of propRows) {
    if (!hasMediaRef(pr)) continue;
    pushSlot('道具', String(pr.name || '道具').trim());
  }

  const charSlots = slots.filter((s) => s.kind === '角色');
  const sceneFirst = slots.length > 0 && slots[0].kind === '场景';
  const bindingLines = charSlots.map((s) => `「${s.summary}」 → ${s.tag}`).join('\n');
  const charBindingBlock = charSlots.length > 0
    ? resolveFragment(
        sceneFirst
          ? 'omni.segment.character_binding_scene_first'
          : 'omni.segment.character_binding_primary',
        { binding_lines: bindingLines }
      )
    : resolveFragment('omni.segment.character_binding_empty');

  if (slots.length === 0 && !forceWithoutReferenceImages) {
    return {
      ok: false,
      code: 'bad_request',
      message: '请至少为场景、角色或道具上传一张参考图后再生成，以便对应 @图片1、@图片2 与 API 参考顺序一致',
    };
  }

  let imageSlotMapBlock;
  let line3Required;
  if (slots.length === 0) {
    imageSlotMapBlock = resolveFragment('omni.segment.image_slot_map_empty');
    line3Required = resolveFragment('omni.segment.line3_no_reference');
  } else {
    imageSlotMapBlock = resolveFragment('omni.segment.image_slot_map', {
      slot_lines: slots.map((s) => `${s.tag} = ${s.kind}「${s.summary}」`).join('\n'),
    });
    line3Required = resolveFragment(
      slots[0].kind === '场景'
        ? 'omni.segment.line3_scene_reference'
        : 'omni.segment.line3_primary_reference'
    );
  }

  const charCount = charNamesOrdered.length;
  const propCount = propNames.length;

  let projectClipSec = 5;
  if (dramaRow?.metadata) {
    try {
      const m = typeof dramaRow.metadata === 'string' ? JSON.parse(dramaRow.metadata) : dramaRow.metadata;
      const v = Number(m?.video_clip_duration);
      if (Number.isFinite(v) && v > 0) projectClipSec = Math.min(120, Math.max(1, v));
    } catch (_) {}
  }
  const body = bodyIn;
  const bodyDurRaw = body.duration != null && body.duration !== '' ? Number(body.duration) : NaN;
  const sbDurRaw = sb.duration != null ? Number(sb.duration) : NaN;
  const durationSec = Number.isFinite(bodyDurRaw) && bodyDurRaw > 0
    ? Math.min(120, Math.max(1, bodyDurRaw))
    : Number.isFinite(sbDurRaw) && sbDurRaw > 0
      ? Math.min(120, Math.max(1, sbDurRaw))
      : projectClipSec;
  const durationLabel = Number.isInteger(durationSec) ? String(durationSec) : String(Math.round(durationSec * 10) / 10);

  const genreHint = (dramaRow?.genre && String(dramaRow.genre).trim()) || '';
  const dramaTitle = (dramaRow?.title && String(dramaRow.title).trim()) || '';
  const refContract = slots.length === 0
    ? resolveFragment('omni.segment.reference_rule_empty')
    : resolveFragment('omni.segment.reference_rule', {
        slot_count: slots.length,
        character_count: charCount,
        prop_count: propCount,
      });

  if (lines.length === 0 && !sceneBlock && !charNames && !propNames.length) {
    return { ok: false, code: 'bad_request', message: '分镜中暂无可用信息，请先填写动作、对白、视频提示词或绑定场景/角色等' };
  }

  const hasSceneSlot = slots.some((s) => s.kind === '场景');
  const sceneLayoutBlock = hasSceneSlot
    ? resolveFragment('omni.segment.scene_reference_layout')
    : '';

  let episodeScript = '';
  let episodeTableTitle = '';
  try {
    const ep = db.prepare('SELECT script_content, title FROM episodes WHERE id = ? AND deleted_at IS NULL').get(sb.episode_id);
    if (ep) {
      episodeTableTitle = (ep.title && String(ep.title).trim()) || '';
      episodeScript = ep.script_content != null ? String(ep.script_content) : '';
    }
  } catch (_) {}
  const SCRIPT_CAP = 20000;
  if (episodeScript.length > SCRIPT_CAP) {
    episodeScript = `${episodeScript.slice(0, SCRIPT_CAP)}\n...[EPISODE_SCRIPT_TRUNCATED]`;
  }

  const mHeuristic = Math.min(8, Math.max(1, Math.round(durationSec / 5)));
  let shotPacingBlock = '';
  try {
    const all = db
      .prepare(
        'SELECT id, storyboard_number, segment_index, segment_title FROM storyboards WHERE episode_id = ? AND deleted_at IS NULL ORDER BY storyboard_number ASC'
      )
      .all(sb.episode_id);
    const ix = all.findIndex((r) => Number(r.id) === Number(sb.id));
    const totalShots = all.length || 1;
    const posTag =
      ix <= 0 ? 'first_in_episode' : ix === all.length - 1 ? 'last_in_episode' : 'middle_of_episode';
    const prevSeg = ix > 0 ? String(all[ix - 1].segment_title || '').trim() : '';
    const nextSeg = ix >= 0 && ix < all.length - 1 ? String(all[ix + 1].segment_title || '').trim() : '';
    const currSeg = String(sb.segment_title || '').trim();
    const segChange = ix > 0 && currSeg && prevSeg && currSeg !== prevSeg;
    shotPacingBlock = [
      'SHOT_PACING_AND_POSITION:',
      `TOTAL_CLIP_SECONDS: ${durationLabel}`,
      `M_HEURISTIC_ONLY: ${mHeuristic}`,
      `SHOT_ORDER: ${ix >= 0 ? ix + 1 : '?'} / ${totalShots}`,
      `SHOT_POSITION_TAG: ${posTag}`,
      chunk('SEGMENT_TITLE_PREV', prevSeg || null),
      chunk('SEGMENT_TITLE_CURRENT', currSeg || null),
      chunk('SEGMENT_TITLE_NEXT', nextSeg || null),
      resolveFragment(
        segChange
          ? 'omni.segment.boundary_changed'
          : 'omni.segment.boundary_same'
      ),
    ].join('\n');
  } catch (_) {
    shotPacingBlock = [
      'SHOT_PACING_AND_POSITION:',
      `TOTAL_CLIP_SECONDS: ${durationLabel}`,
      `M_HEURISTIC_ONLY: 约 ${mHeuristic}`,
    ].join('\n');
  }

  let neighborDetailBlock = '';
  try {
    const prevFull = db
      .prepare(
        `SELECT storyboard_number, title, segment_title, action, dialogue, narration, shot_type, movement, atmosphere
         FROM storyboards WHERE episode_id = ? AND storyboard_number < ? AND deleted_at IS NULL ORDER BY storyboard_number DESC LIMIT 1`
      )
      .get(sb.episode_id, sb.storyboard_number);
    const nextFull = db
      .prepare(
        `SELECT storyboard_number, title, segment_title, action, dialogue, narration, shot_type, movement, atmosphere
         FROM storyboards WHERE episode_id = ? AND storyboard_number > ? AND deleted_at IS NULL ORDER BY storyboard_number ASC LIMIT 1`
      )
      .get(sb.episode_id, sb.storyboard_number);
    const fmtN = (row, tag) => {
      if (!row) return `${tag}: (none)`;
      const bits = [
        `${tag}:`,
        chunk('N_NUM', row.storyboard_number),
        chunk('N_TITLE', row.title),
        chunk('N_SEGMENT', row.segment_title),
        chunk('N_ACTION', row.action),
        chunk('N_DIALOGUE', row.dialogue),
        chunk('N_NARRATION', row.narration),
        chunk('N_SHOT_TYPE', row.shot_type),
        chunk('N_MOVEMENT', row.movement),
        chunk('N_ATMOSPHERE', row.atmosphere),
      ].filter(Boolean);
      return bits.join('\n');
    };
    neighborDetailBlock = [fmtN(prevFull, 'NEIGHBOR_PREV_DETAIL'), '', fmtN(nextFull, 'NEIGHBOR_NEXT_DETAIL')].join('\n');
  } catch (_) {}

  const userPrompt = resolveFragment('omni.segment.user', {
    duration_seconds: durationLabel,
    shot_pacing: shotPacingBlock,
    neighbor_details: neighborDetailBlock,
    line3_required: line3Required,
    episode_script: episodeScript,
    episode_title: episodeTableTitle,
    image_slot_map: imageSlotMapBlock,
    scene_reference_layout: sceneLayoutBlock,
    character_image_binding: charBindingBlock,
    drama_title: dramaTitle,
    drama_genre: genreHint,
    style_zh: styleZh,
    style_en: styleEn,
    reference_rule: refContract,
    character_names: charNames || 'none',
    prop_names: propNames.join(', ') || 'none',
    scene_context: sceneBlock,
    previous_context: prevDesc,
    next_context: nextDesc,
    storyboard_fields: lines.join('\n') || '(none)',
  });

  return {
    ok: true,
    userPrompt,
    durationLabel,
    durationSec,
    sbId,
    episodeId: Number(sb.episode_id) || 0,
    storyboardNumber: Number(sb.storyboard_number) || 0,
  };
}

module.exports = { buildUniversalSegmentUserPromptBundle };
