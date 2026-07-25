const taskService = require('./taskService');
const videoClient = require('./videoClient');
const {
  buildRedrawPrompt,
  buildNegativePrompt,
  collectReferenceUrls,
  parseJson,
} = require('./redrawPromptService');
const { makeStructureReference } = require('./redrawStructureService');
const { inspectResult, fileInfo } = require('./redrawQualityService');

function nowIso() {
  return new Date().toISOString();
}

function stringify(value) {
  if (value == null) return null;
  return typeof value === 'string' ? value : JSON.stringify(value);
}

function parseMaybeJson(value, fallback) {
  return parseJson(value, fallback);
}

function classifyError(message) {
  const text = String(message || '').toLowerCase();
  if (/copyright|policy|sensitive|violation|restricted/.test(text)) return 'policy_copyright';
  if (/timeout|timed out|超时/.test(text)) return 'provider_timeout';
  if (/download|下载/.test(text)) return 'download_failed';
  if (/missing|不存在|not found|no such file/.test(text)) return 'missing_asset';
  if (/interrupted|重启|provider.*id|任务 id/.test(text)) return 'stale_running';
  return 'provider_failed';
}

function publicUrlFromLocalPath(value) {
  const raw = String(value || '').trim();
  if (!raw) return '';
  if (/^https?:\/\//i.test(raw) || raw.startsWith('data:')) return raw;
  if (raw.startsWith('/static/')) return raw;
  return `/static/${raw.replace(/^[/\\]+/, '').replace(/\\/g, '/')}`;
}

function videoModelFromConfig(config) {
  if (!config) return null;
  if (config.default_model) return config.default_model;
  if (Array.isArray(config.model)) return config.model[0] || null;
  if (typeof config.model === 'string') {
    const s = config.model.trim();
    if (!s) return null;
    try {
      const parsed = JSON.parse(s);
      if (Array.isArray(parsed)) return parsed[0] || null;
    } catch (_) {}
    return s.split(',').map((x) => x.trim()).filter(Boolean)[0] || s;
  }
  return null;
}

function event(db, jobId, cardId, eventType, message, payload) {
  db.prepare(
    `INSERT INTO redraw_events (job_id, card_id, event_type, message, payload, created_at)
     VALUES (?, ?, ?, ?, ?, ?)`
  ).run(jobId || null, cardId || null, eventType, message || '', stringify(payload), nowIso());
}

function rowToJob(row, stats = null) {
  if (!row) return null;
  return {
    ...row,
    settings: parseMaybeJson(row.settings, {}),
    stats: stats || parseMaybeJson(row.stats, {}),
  };
}

function rowToCard(row) {
  if (!row) return null;
  return {
    ...row,
    character_refs: parseMaybeJson(row.character_refs, []),
    scene_ref: parseMaybeJson(row.scene_ref, null),
    prop_refs: parseMaybeJson(row.prop_refs, []),
    asset_bindings: parseMaybeJson(row.asset_bindings, {}),
    timeline: parseMaybeJson(row.timeline, []),
    preflight_report: parseMaybeJson(row.preflight_report, null),
    quality_report: parseMaybeJson(row.quality_report, null),
  };
}

function rowToResult(row) {
  if (!row) return null;
  return {
    ...row,
    quality_report: parseMaybeJson(row.quality_report, null),
  };
}

function getJobRow(db, jobId) {
  return db.prepare('SELECT * FROM redraw_jobs WHERE id = ? AND deleted_at IS NULL').get(Number(jobId));
}

function getCardRow(db, cardId) {
  return db.prepare(
    `SELECT c.*, j.drama_id AS job_drama_id, j.episode_id AS job_episode_id, j.aspect_ratio AS job_aspect_ratio,
            j.resolution AS job_resolution, j.overall_goal AS job_overall_goal
       FROM redraw_cards c
       JOIN redraw_jobs j ON j.id = c.job_id AND j.deleted_at IS NULL
      WHERE c.id = ? AND c.deleted_at IS NULL`
  ).get(Number(cardId));
}

function calcJobStats(db, jobId) {
  const rows = db.prepare(
    `SELECT status, COUNT(*) AS count
       FROM redraw_cards
      WHERE job_id = ? AND deleted_at IS NULL
      GROUP BY status`
  ).all(Number(jobId));
  const byStatus = {};
  let total = 0;
  for (const row of rows) {
    const count = Number(row.count || 0);
    byStatus[row.status || 'unknown'] = count;
    total += count;
  }
  const done = byStatus.completed || 0;
  const failed = byStatus.failed || 0;
  const running = (byStatus.running || 0) + (byStatus.processing || 0);
  const draft = byStatus.draft || 0;
  const ready = byStatus.ready || 0;
  let status = 'draft';
  if (total === 0) status = 'draft';
  else if (running > 0) status = 'running';
  else if (failed > 0 && done === 0) status = 'failed';
  else if (failed > 0 || done < total) status = 'partial';
  else if (done === total) status = 'completed';
  else if (ready > 0 || draft > 0) status = 'ready';
  return { total, done, failed, running, draft, ready, by_status: byStatus, status };
}

function updateJobStatus(db, jobId) {
  const stats = calcJobStats(db, jobId);
  db.prepare('UPDATE redraw_jobs SET status = ?, stats = ?, updated_at = ? WHERE id = ?')
    .run(stats.status, JSON.stringify(stats), nowIso(), Number(jobId));
  return stats;
}

function listJobs(db, query = {}) {
  let sql = 'FROM redraw_jobs WHERE deleted_at IS NULL';
  const params = [];
  if (query.drama_id) {
    sql += ' AND drama_id = ?';
    params.push(Number(query.drama_id));
  }
  if (query.episode_id) {
    sql += ' AND episode_id = ?';
    params.push(Number(query.episode_id));
  }
  if (query.status) {
    sql += ' AND status = ?';
    params.push(String(query.status));
  }
  const rows = db.prepare(`SELECT * ${sql} ORDER BY updated_at DESC, id DESC`).all(...params);
  return rows.map((row) => {
    const stats = updateJobStatus(db, row.id);
    return rowToJob({ ...row, status: stats.status, stats: JSON.stringify(stats) }, stats);
  });
}

function getJob(db, cfg, jobId) {
  reconcileJob(db, cfg, jobId);
  const job = getJobRow(db, jobId);
  if (!job) return null;
  const stats = updateJobStatus(db, jobId);
  const cards = db.prepare(
    `SELECT * FROM redraw_cards
      WHERE job_id = ? AND deleted_at IS NULL
      ORDER BY sort_order ASC, id ASC`
  ).all(Number(jobId)).map(rowToCard);
  const cardIds = cards.map((c) => c.id);
  let results = [];
  if (cardIds.length) {
    const placeholders = cardIds.map(() => '?').join(',');
    results = db.prepare(
      `SELECT * FROM redraw_card_results
        WHERE card_id IN (${placeholders}) AND deleted_at IS NULL
        ORDER BY card_id ASC, version DESC`
    ).all(...cardIds).map(rowToResult);
  }
  const byCard = new Map();
  for (const result of results) {
    if (!byCard.has(result.card_id)) byCard.set(result.card_id, []);
    byCard.get(result.card_id).push(result);
  }
  return {
    ...rowToJob(job, stats),
    cards: cards.map((card) => ({
      ...card,
      results: byCard.get(card.id) || [],
      current_result: (byCard.get(card.id) || []).find((r) => r.id === card.current_result_id) || null,
    })),
  };
}

function createJob(db, body = {}) {
  const now = nowIso();
  const info = db.prepare(
    `INSERT INTO redraw_jobs
      (drama_id, episode_id, title, overall_goal, aspect_ratio, resolution, status, settings, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, 'draft', ?, ?, ?)`
  ).run(
    body.drama_id ? Number(body.drama_id) : null,
    body.episode_id ? Number(body.episode_id) : null,
    String(body.title || '转绘任务').trim() || '转绘任务',
    body.overall_goal || '',
    body.aspect_ratio || '9:16',
    body.resolution || '480p',
    stringify(body.settings || {}),
    now,
    now
  );
  const id = info.lastInsertRowid;
  if (Array.isArray(body.cards)) {
    body.cards.forEach((card, index) => addCard(db, id, { ...card, sort_order: card.sort_order ?? index }));
  }
  event(db, id, null, 'job_created', '创建转绘任务', body);
  updateJobStatus(db, id);
  return getJob(db, null, id);
}

function createCardsFromEpisode(db, jobId) {
  const job = getJobRow(db, jobId);
  if (!job?.episode_id) return [];
  const rows = db.prepare(
    `SELECT s.*, sc.location AS scene_location, sc.prompt AS scene_prompt, sc.image_url AS scene_image_url, sc.local_path AS scene_local_path
       FROM storyboards s
       LEFT JOIN scenes sc ON sc.id = s.scene_id
      WHERE s.episode_id = ? AND s.deleted_at IS NULL
      ORDER BY s.storyboard_number ASC, s.id ASC`
  ).all(Number(job.episode_id));
  const created = [];
  rows.forEach((sb, index) => {
    const sceneRef = sb.scene_id ? {
      id: sb.scene_id,
      name: sb.scene_location || sb.location || '场景',
      description: sb.scene_prompt || sb.location || '',
      image_url: sb.scene_image_url || '',
      local_path: sb.scene_local_path || '',
    } : null;
    created.push(addCard(db, jobId, {
      storyboard_id: sb.id,
      card_key: `sb_${sb.id}`,
      title: sb.title || `镜头 ${sb.storyboard_number || index + 1}`,
      sort_order: index,
      source_video_path: sb.local_path || sb.video_url || '',
      prompt: sb.video_prompt || sb.description || sb.action || '',
      duration: sb.duration || null,
      scene_ref: sceneRef,
      timeline: [{
        range: `0-${Math.round(Number(sb.duration) || 5)}s`,
        text: [sb.shot_type, sb.angle, sb.movement, sb.action, sb.dialogue].filter(Boolean).join('，'),
      }],
    }));
  });
  updateJobStatus(db, jobId);
  return created;
}

function addCard(db, jobId, body = {}) {
  const job = getJobRow(db, jobId);
  if (!job) throw new Error('转绘任务不存在');
  const now = nowIso();
  const info = db.prepare(
    `INSERT INTO redraw_cards
      (job_id, storyboard_id, card_key, title, sort_order, source_video_path, structure_video_path,
       structure_strength, prompt, negative_prompt, timeline, character_refs, scene_ref, prop_refs,
       asset_bindings, duration, aspect_ratio, status, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'draft', ?, ?)`
  ).run(
    Number(jobId),
    body.storyboard_id ? Number(body.storyboard_id) : null,
    body.card_key || '',
    body.title || '',
    Number(body.sort_order || 0),
    body.source_video_path || '',
    body.structure_video_path || '',
    body.structure_strength || 'balanced',
    body.prompt || '',
    body.negative_prompt || '',
    stringify(body.timeline || []),
    stringify(body.character_refs || []),
    stringify(body.scene_ref || null),
    stringify(body.prop_refs || []),
    stringify(body.asset_bindings || {}),
    body.duration != null && body.duration !== '' ? Number(body.duration) : null,
    body.aspect_ratio || job.aspect_ratio || '9:16',
    now,
    now
  );
  updateJobStatus(db, jobId);
  return rowToCard(db.prepare('SELECT * FROM redraw_cards WHERE id = ?').get(info.lastInsertRowid));
}

function updateCard(db, cardId, body = {}) {
  const card = getCardRow(db, cardId);
  if (!card) return null;
  const allowed = [
    'title', 'source_video_path', 'structure_video_path', 'structure_strength',
    'prompt', 'negative_prompt', 'timeline', 'character_refs', 'scene_ref',
    'prop_refs', 'asset_bindings', 'duration', 'aspect_ratio', 'sort_order',
  ];
  const sets = [];
  const params = [];
  for (const key of allowed) {
    if (!(key in body)) continue;
    sets.push(`${key} = ?`);
    if (['timeline', 'character_refs', 'scene_ref', 'prop_refs', 'asset_bindings'].includes(key)) {
      params.push(stringify(body[key]));
    } else if (key === 'duration') {
      params.push(body[key] != null && body[key] !== '' ? Number(body[key]) : null);
    } else {
      params.push(body[key]);
    }
  }
  if (!sets.length) return rowToCard(card);
  params.push(nowIso(), Number(cardId));
  db.prepare(`UPDATE redraw_cards SET ${sets.join(', ')}, updated_at = ? WHERE id = ?`).run(...params);
  event(db, card.job_id, card.id, 'card_updated', '更新转绘镜头', body);
  updateJobStatus(db, card.job_id);
  return rowToCard(getCardRow(db, cardId));
}

function preflightCard(db, cfg, cardId) {
  const card = getCardRow(db, cardId);
  if (!card) return null;
  const issues = [];
  const source = fileInfo(cfg, card.source_video_path);
  const structure = fileInfo(cfg, card.structure_video_path);
  const characters = parseMaybeJson(card.character_refs, []);
  const props = parseMaybeJson(card.prop_refs, []);
  const scene = parseMaybeJson(card.scene_ref, null);
  const hasRemoteSource = /^https?:\/\//i.test(String(card.source_video_path || ''));
  const hasRemoteStructure = /^https?:\/\//i.test(String(card.structure_video_path || ''));

  if (!card.source_video_path) issues.push({ level: 'error', code: 'missing_source', message: '缺少源视频' });
  else if (!source.exists && !hasRemoteSource) issues.push({ level: 'error', code: 'source_missing', message: '源视频文件不存在' });
  if (!card.structure_video_path) issues.push({ level: 'error', code: 'missing_structure', message: '缺少低细节结构视频' });
  else if (!structure.exists && !hasRemoteStructure) issues.push({ level: 'error', code: 'structure_missing', message: '结构视频文件不存在' });
  if (!Array.isArray(characters) || characters.length === 0) issues.push({ level: 'warning', code: 'missing_character_refs', message: '未绑定角色参考图，多人或近景容易身份漂移' });
  if (!scene) issues.push({ level: 'warning', code: 'missing_scene_ref', message: '未绑定场景参考图，可能保留源场景' });
  if (Array.isArray(props) && props.some((p) => !p.image_url && !p.url && !p.local_path && !p.ref_image)) {
    issues.push({ level: 'warning', code: 'prop_ref_incomplete', message: '部分道具缺少参考图' });
  }
  if (/字幕|花字|logo|水印|标题卡|文字/.test(String(card.prompt || ''))) {
    issues.push({ level: 'warning', code: 'text_risk', message: '提示词包含文字/字幕相关内容，容易生成可读文字' });
  }
  if (/原剧|同款|复刻|照搬|copyright/i.test(String(card.prompt || ''))) {
    issues.push({ level: 'warning', code: 'copyright_prompt_risk', message: '提示词有版权化复刻倾向，建议改为结构迁移和资产替换描述' });
  }

  const report = {
    ok: issues.filter((i) => i.level === 'error').length === 0,
    issues,
    checked_at: nowIso(),
  };
  const status = report.ok ? (card.status === 'completed' ? 'completed' : 'ready') : 'draft';
  db.prepare(
    'UPDATE redraw_cards SET preflight_report = ?, status = ?, error_code = ?, error_msg = ?, updated_at = ? WHERE id = ?'
  ).run(JSON.stringify(report), status, report.ok ? null : issues.find((i) => i.level === 'error')?.code || null, report.ok ? null : issues.find((i) => i.level === 'error')?.message || null, nowIso(), Number(cardId));
  updateJobStatus(db, card.job_id);
  return report;
}

function generateStructure(db, cfg, log, cardId, strength) {
  const card = getCardRow(db, cardId);
  if (!card) return null;
  const chosen = strength || card.structure_strength || 'balanced';
  const result = makeStructureReference(db, cfg, log, card, chosen);
  db.prepare('UPDATE redraw_cards SET structure_video_path = ?, structure_strength = ?, updated_at = ? WHERE id = ?')
    .run(result.local_path, chosen, nowIso(), Number(cardId));
  event(db, card.job_id, card.id, 'structure_created', '生成低细节结构视频', result);
  preflightCard(db, cfg, cardId);
  return result;
}

function insertVideoGeneration(db, card, config, prompt, negativePrompt, refs) {
  const task = taskService.createTask(db, console, 'redraw_video_generation', String(card.id));
  const model = videoModelFromConfig(config);
  const provider = config?.provider || '';
  const now = nowIso();
  const info = db.prepare(
    `INSERT INTO video_generations
      (drama_id, storyboard_id, provider, prompt, model, duration, aspect_ratio, resolution,
       watermark, reference_image_urls, source_video_url, status, task_id, redraw_card_id, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, 'processing', ?, ?, ?, ?)`
  ).run(
    card.job_drama_id || null,
    card.storyboard_id || null,
    provider,
    prompt,
    model,
    card.duration || null,
    card.aspect_ratio || card.job_aspect_ratio || '9:16',
    card.job_resolution || '480p',
    JSON.stringify(refs || []),
    publicUrlFromLocalPath(card.structure_video_path),
    task.id,
    card.id,
    now,
    now
  );
  return { videoGenId: info.lastInsertRowid, taskId: task.id, model, provider };
}

function submitCard(db, cfg, log, cardId) {
  const card = getCardRow(db, cardId);
  if (!card) return null;
  const report = preflightCard(db, cfg, cardId);
  if (!report?.ok) {
    const first = report?.issues?.find((i) => i.level === 'error');
    throw new Error(first?.message || '预检未通过');
  }
  const config = videoClient.getDefaultVideoConfig(db, null, 'redraw_generation') || videoClient.getDefaultVideoConfig(db, null);
  if (!config) throw new Error('未配置视频 AI 模型');
  const job = getJobRow(db, card.job_id);
  const latestCard = getCardRow(db, cardId);
  const prompt = buildRedrawPrompt(job, latestCard);
  const negativePrompt = buildNegativePrompt(latestCard);
  const refs = collectReferenceUrls(latestCard);
  const { videoGenId, taskId } = insertVideoGeneration(db, latestCard, config, prompt, negativePrompt, refs);
  const versionRow = db.prepare(
    'SELECT COALESCE(MAX(version), 0) + 1 AS next_version FROM redraw_card_results WHERE card_id = ? AND deleted_at IS NULL'
  ).get(Number(cardId));
  const version = Number(versionRow?.next_version || 1);
  const resultInfo = db.prepare(
    `INSERT INTO redraw_card_results
      (card_id, video_generation_id, version, status, is_current, created_at)
     VALUES (?, ?, ?, 'processing', 1, ?)`
  ).run(Number(cardId), videoGenId, version, nowIso());
  db.prepare('UPDATE redraw_card_results SET is_current = 0 WHERE card_id = ? AND id != ?')
    .run(Number(cardId), resultInfo.lastInsertRowid);
  db.prepare(
    `UPDATE redraw_cards
        SET status = 'running', current_video_generation_id = ?, current_result_id = ?,
            error_code = NULL, error_msg = NULL, updated_at = ?
      WHERE id = ?`
  ).run(videoGenId, resultInfo.lastInsertRowid, nowIso(), Number(cardId));
  updateJobStatus(db, card.job_id);
  event(db, card.job_id, card.id, 'generation_submitted', '提交转绘生成', {
    video_generation_id: videoGenId,
    task_id: taskId,
    reference_count: refs.length,
  });
  setImmediate(() => {
    try {
      require('./videoService').processVideoGeneration(db, log, videoGenId);
    } catch (error) {
      log.error('[redraw] start video generation failed', { card_id: cardId, error: error.message });
    }
  });
  return rowToCard(getCardRow(db, cardId));
}

function submitJob(db, cfg, log, jobId, options = {}) {
  const rows = db.prepare(
    `SELECT id FROM redraw_cards
      WHERE job_id = ? AND deleted_at IS NULL
      ORDER BY sort_order ASC, id ASC`
  ).all(Number(jobId));
  const submitted = [];
  const skipped = [];
  for (const row of rows) {
    const card = getCardRow(db, row.id);
    if (!options.retry_failed && ['completed', 'running'].includes(card.status)) {
      skipped.push({ id: row.id, reason: card.status });
      continue;
    }
    try {
      submitted.push(submitCard(db, cfg, log, row.id));
    } catch (error) {
      skipped.push({ id: row.id, reason: error.message });
    }
  }
  updateJobStatus(db, jobId);
  return { submitted: submitted.length, skipped };
}

function syncVideoGenerationResult(db, log, videoGenId, cfg = null) {
  const video = db.prepare('SELECT * FROM video_generations WHERE id = ? AND deleted_at IS NULL').get(Number(videoGenId));
  if (!video) return null;
  const result = db.prepare(
    'SELECT * FROM redraw_card_results WHERE video_generation_id = ? AND deleted_at IS NULL ORDER BY id DESC LIMIT 1'
  ).get(Number(videoGenId));
  const card = result ? getCardRow(db, result.card_id) : (
    video.redraw_card_id ? getCardRow(db, video.redraw_card_id) : null
  );
  if (!card) return null;
  const now = nowIso();
  if (video.status === 'completed') {
    const quality = cfg ? inspectResult(cfg, video) : null;
    db.prepare(
      `UPDATE redraw_card_results
          SET status = 'completed', video_url = ?, local_path = ?, error_code = NULL, error_msg = NULL,
              quality_report = COALESCE(?, quality_report), completed_at = COALESCE(?, completed_at)
        WHERE id = ?`
    ).run(video.video_url || null, video.local_path || null, quality ? JSON.stringify(quality) : null, video.completed_at || now, result?.id || card.current_result_id);
    db.prepare(
      `UPDATE redraw_cards
          SET status = 'completed', current_video_generation_id = ?, error_code = NULL, error_msg = NULL,
              quality_report = COALESCE(?, quality_report), updated_at = ?
        WHERE id = ?`
    ).run(video.id, quality ? JSON.stringify(quality) : null, now, card.id);
    event(db, card.job_id, card.id, 'generation_completed', '转绘生成完成', { video_generation_id: video.id });
  } else if (video.status === 'failed') {
    const code = classifyError(video.error_msg);
    db.prepare(
      `UPDATE redraw_card_results
          SET status = 'failed', error_code = ?, error_msg = ?, completed_at = COALESCE(completed_at, ?)
        WHERE id = ?`
    ).run(code, video.error_msg || '生成失败', now, result?.id || card.current_result_id);
    db.prepare(
      `UPDATE redraw_cards
          SET status = 'failed', error_code = ?, error_msg = ?, updated_at = ?
        WHERE id = ?`
    ).run(code, video.error_msg || '生成失败', now, card.id);
    event(db, card.job_id, card.id, 'generation_failed', '转绘生成失败', { video_generation_id: video.id, code, error: video.error_msg });
  }
  updateJobStatus(db, card.job_id);
  return rowToCard(getCardRow(db, card.id));
}

function reconcileJob(db, cfg, jobId) {
  const rows = db.prepare(
    `SELECT current_video_generation_id AS id FROM redraw_cards
      WHERE job_id = ? AND deleted_at IS NULL AND current_video_generation_id IS NOT NULL`
  ).all(Number(jobId));
  for (const row of rows) syncVideoGenerationResult(db, null, row.id, cfg);
  updateJobStatus(db, jobId);
}

function repairJobResults(db, cfg, jobId) {
  reconcileJob(db, cfg, jobId);
  const cards = db.prepare(
    `SELECT * FROM redraw_cards
      WHERE job_id = ? AND deleted_at IS NULL AND current_result_id IS NOT NULL`
  ).all(Number(jobId));
  const repaired = [];
  for (const card of cards) {
    const current = db.prepare('SELECT * FROM redraw_card_results WHERE id = ?').get(card.current_result_id);
    if (!current) continue;
    const currentCheck = inspectResult(cfg, current);
    if (currentCheck.ok) continue;
    const candidates = db.prepare(
      `SELECT * FROM redraw_card_results
        WHERE card_id = ? AND status = 'completed' AND deleted_at IS NULL
        ORDER BY version DESC`
    ).all(card.id);
    const replacement = candidates.find((item) => inspectResult(cfg, item).ok);
    if (!replacement) continue;
    db.prepare('UPDATE redraw_card_results SET is_current = 0 WHERE card_id = ?').run(card.id);
    db.prepare('UPDATE redraw_card_results SET is_current = 1 WHERE id = ?').run(replacement.id);
    db.prepare(
      `UPDATE redraw_cards SET current_result_id = ?, current_video_generation_id = ?, status = 'completed',
       error_code = NULL, error_msg = NULL, updated_at = ? WHERE id = ?`
    ).run(replacement.id, replacement.video_generation_id, nowIso(), card.id);
    repaired.push({ card_id: card.id, result_id: replacement.id });
  }
  updateJobStatus(db, jobId);
  return { repaired };
}

module.exports = {
  listJobs,
  getJob,
  createJob,
  addCard,
  updateCard,
  createCardsFromEpisode,
  preflightCard,
  generateStructure,
  submitCard,
  submitJob,
  syncVideoGenerationResult,
  reconcileJob,
  repairJobResults,
  classifyError,
};
