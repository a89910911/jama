const STORYBOARD_MIN_DURATION = 4;
const STORYBOARD_MAX_DURATION = 15;
const DEFAULT_FIXED_DURATION = 5;
const SPEECH_CHARS_PER_SECOND = 3.5;

function clampStoryboardDuration(value, fallback = DEFAULT_FIXED_DURATION) {
  const n = Number(value);
  const safe = Number.isFinite(n) && n > 0 ? Math.round(n) : Number(fallback);
  return Math.min(STORYBOARD_MAX_DURATION, Math.max(STORYBOARD_MIN_DURATION, safe));
}

function normalizeDurationMode(value, hasLegacyFixedDuration = false) {
  const mode = String(value || '').trim().toLowerCase();
  if (mode === 'adaptive' || mode === 'smart') return 'adaptive';
  if (mode === 'fixed' || mode === 'legacy') return 'fixed';
  return hasLegacyFixedDuration ? 'fixed' : 'adaptive';
}

function stripOuterQuotes(value) {
  const text = String(value || '').trim();
  if (text.length < 2) return text;
  const pairs = new Map([
    ['“', '”'], ['「', '」'], ['『', '』'], ['"', '"'], ["'", "'"],
  ]);
  return pairs.get(text[0]) === text[text.length - 1] ? text.slice(1, -1).trim() : text;
}

/**
 * 将“角色：台词”解析为有序条目。无角色标签时仍返回一条，确保台词不丢失。
 */
function parseDialogueToEntries(value) {
  const raw = String(value || '').trim();
  if (!raw) return [];
  const marker = /(^|[\s\n。！？!?；;”"'」』])([\u3400-\u9fffA-Za-z0-9_·]{1,20})\s*[：:]\s*/g;
  const matches = [];
  let match;
  while ((match = marker.exec(raw)) !== null) {
    matches.push({
      speaker: match[2].trim(),
      contentStart: marker.lastIndex,
      markerStart: match.index + match[1].length,
    });
  }
  if (!matches.length) return [{ speaker: '', text: stripOuterQuotes(raw) }];

  const entries = [];
  for (let i = 0; i < matches.length; i++) {
    const current = matches[i];
    const end = i + 1 < matches.length ? matches[i + 1].markerStart : raw.length;
    const text = stripOuterQuotes(raw.slice(current.contentStart, end).trim());
    if (text) entries.push({ speaker: current.speaker, text });
  }
  return entries.length ? entries : [{ speaker: '', text: stripOuterQuotes(raw) }];
}

function speechUnits(value) {
  const text = String(value || '')
    .replace(/(^|[\s\n。！？!?；;”"'」』])[\u3400-\u9fffA-Za-z0-9_·]{1,20}\s*[：:]\s*/g, '$1')
    .trim();
  if (!text) return 0;
  const han = (text.match(/[\u3400-\u9fff]/g) || []).length;
  const latinWords = (text.match(/[A-Za-z0-9]+/g) || []).length;
  const strongPauses = (text.match(/[。！？!?；;…]/g) || []).length;
  const lightPauses = (text.match(/[，,、：:]/g) || []).length;
  return han + latinWords * 1.5 + strongPauses * 1.4 + lightPauses * 0.55;
}

/** 返回包含自然停顿和口型收尾的对白预计秒数。 */
function charSpeechWeight(value) {
  const units = speechUnits(value);
  if (!units) return 0;
  return units / SPEECH_CHARS_PER_SECOND + 1.2;
}

function splitSemanticUnits(value, separators) {
  const text = String(value || '').trim();
  if (!text) return [];
  const pattern = separators === 'clause'
    ? /[^，,、：:\n]+[，,、：:]?\s*/g
    : /[^。！？!?；;\n]+[。！？!?；;]?\s*/g;
  return (text.match(pattern) || [text]).map((part) => part.trim()).filter(Boolean);
}

function hardSplitText(value, maxDuration) {
  const chars = Array.from(String(value || '').trim());
  const maxChars = Math.max(4, Math.floor((maxDuration - 1.2) * SPEECH_CHARS_PER_SECOND));
  const result = [];
  for (let i = 0; i < chars.length; i += maxChars) {
    result.push(chars.slice(i, i + maxChars).join('').trim());
  }
  return result.filter(Boolean);
}

/** 按完整句、从句、最后才按字符安全切分，保证每段朗读预计不超过 maxDuration。 */
function splitTextForDuration(value, maxDuration = STORYBOARD_MAX_DURATION) {
  const max = clampStoryboardDuration(maxDuration, STORYBOARD_MAX_DURATION);
  const sentences = splitSemanticUnits(value, 'sentence');
  const atomic = [];
  for (const sentence of sentences) {
    if (charSpeechWeight(sentence) <= max) {
      atomic.push(sentence);
      continue;
    }
    const clauses = splitSemanticUnits(sentence, 'clause');
    for (const clause of clauses) {
      if (charSpeechWeight(clause) <= max) atomic.push(clause);
      else atomic.push(...hardSplitText(clause, max));
    }
  }

  const packed = [];
  let current = '';
  for (const part of atomic) {
    const candidate = current ? `${current}${part}` : part;
    if (current && charSpeechWeight(candidate) > max) {
      packed.push(current);
      current = part;
    } else {
      current = candidate;
    }
  }
  if (current) packed.push(current);
  return packed.length ? packed : [String(value || '').trim()].filter(Boolean);
}

function textJoin(a, b, separator = '；') {
  const left = String(a || '').trim();
  const right = String(b || '').trim();
  if (!left) return right;
  if (!right) return left;
  return `${left}${separator}${right}`;
}

function arrayUnion(a, b) {
  const values = [...(Array.isArray(a) ? a : []), ...(Array.isArray(b) ? b : [])];
  return [...new Set(values.map((item) => {
    if (item && typeof item === 'object' && item.id != null) return Number(item.id);
    const n = Number(item);
    return Number.isFinite(n) ? n : item;
  }))];
}

function sameScene(a, b) {
  if (a?.scene_id != null || b?.scene_id != null) {
    return Number(a?.scene_id) === Number(b?.scene_id);
  }
  return String(a?.location || '').trim() === String(b?.location || '').trim()
    && String(a?.time || '').trim() === String(b?.time || '').trim();
}

function speakerSet(row) {
  return new Set(parseDialogueToEntries(row?.dialogue).map((entry) => entry.speaker).filter(Boolean));
}

function canMergeShortBeats(a, b, maxDuration) {
  if (!a || !b || !sameScene(a, b)) return false;
  const speakersA = speakerSet(a);
  const speakersB = speakerSet(b);
  if (speakersA.size && speakersB.size) {
    for (const speaker of speakersA) {
      if (!speakersB.has(speaker)) return false;
    }
    for (const speaker of speakersB) {
      if (!speakersA.has(speaker)) return false;
    }
  }
  const combined = Math.max(0, Number(a.duration) || 0) + Math.max(0, Number(b.duration) || 0);
  return combined > 0 && combined <= maxDuration;
}

function mergeStoryboardRows(a, b) {
  return {
    ...a,
    title: textJoin(a.title, b.title, '·').slice(0, 200),
    action: textJoin(a.action, b.action),
    dialogue: textJoin(a.dialogue, b.dialogue, '\n'),
    narration: textJoin(a.narration, b.narration, '\n'),
    result: String(b.result || a.result || '').trim(),
    atmosphere: textJoin(a.atmosphere, b.atmosphere),
    duration: (Number(a.duration) || 0) + (Number(b.duration) || 0),
    characters: arrayUnion(a.characters, b.characters),
    props: arrayUnion(a.props, b.props),
    universal_segment_text: null,
  };
}

function mergeSubMinimumRows(rows, maxDuration) {
  const result = [];
  for (let i = 0; i < rows.length; i++) {
    const row = { ...rows[i] };
    const raw = Number(row.duration);
    if (!(Number.isFinite(raw) && raw > 0 && raw < STORYBOARD_MIN_DURATION)) {
      result.push(row);
      continue;
    }
    const next = rows[i + 1];
    if (next && canMergeShortBeats(row, next, maxDuration)) {
      result.push(mergeStoryboardRows(row, next));
      i++;
      continue;
    }
    const previous = result[result.length - 1];
    if (previous && canMergeShortBeats(previous, row, maxDuration)) {
      result[result.length - 1] = mergeStoryboardRows(previous, row);
      continue;
    }
    row.duration = STORYBOARD_MIN_DURATION;
    result.push(row);
  }
  return result;
}

function estimateActionDuration(row) {
  const action = String(row?.action || '').trim();
  const result = String(row?.result || '').trim();
  const text = `${action}${result}`;
  if (!text) return STORYBOARD_MIN_DURATION;
  const isTransition = /(转场|空镜|建立镜头|环境|天色|街景|远景|过渡)/.test(text);
  const base = isTransition ? 5 : 4;
  return Math.min(12, base + Math.floor(Array.from(text).length / 32) * 2);
}

function estimateStoryboardDuration(row) {
  const dialogueSeconds = charSpeechWeight(row?.dialogue);
  const narrationSeconds = charSpeechWeight(row?.narration);
  const speechSeconds = dialogueSeconds + narrationSeconds;
  const contentMinimum = speechSeconds > 0
    ? Math.max(STORYBOARD_MIN_DURATION, Math.ceil(speechSeconds))
    : estimateActionDuration(row);
  const aiDuration = Number(row?.duration);
  return Math.max(contentMinimum, Number.isFinite(aiDuration) && aiDuration > 0 ? Math.round(aiDuration) : 0);
}

function formatDialogue(speaker, text) {
  return speaker ? `${speaker}：${text}` : text;
}

function audioSegmentsForRow(row, maxDuration) {
  const segments = [];
  for (const entry of parseDialogueToEntries(row.dialogue)) {
    for (const text of splitTextForDuration(entry.text, maxDuration)) {
      segments.push({ kind: 'dialogue', speaker: entry.speaker, text });
    }
  }
  const narration = String(row.narration || '').trim();
  if (narration) {
    for (const text of splitTextForDuration(narration, maxDuration)) {
      segments.push({ kind: 'narration', speaker: '', text });
    }
  }
  return segments;
}

function expandLongAudioRow(row, mode, fixedDuration) {
  const maxDuration = mode === 'fixed' ? fixedDuration : STORYBOARD_MAX_DURATION;
  const segments = audioSegmentsForRow(row, maxDuration);
  const totalSpeech = charSpeechWeight(row.dialogue) + charSpeechWeight(row.narration);
  if (segments.length <= 1 && totalSpeech <= maxDuration) return [{ ...row }];

  return segments.map((segment, index) => {
    const last = index === segments.length - 1;
    const who = segment.kind === 'dialogue' ? (segment.speaker || '角色') : '旁白';
    const continuationAction = segment.kind === 'dialogue'
      ? `${who}继续完成当前台词，镜头保留自然停顿和说完后的情绪反应。`
      : '画面延续当前动作与氛围，承接画外旁白。';
    const duration = mode === 'fixed'
      ? fixedDuration
      : clampStoryboardDuration(Math.ceil(charSpeechWeight(segment.text)), STORYBOARD_MIN_DURATION);
    return {
      ...row,
      title: segments.length > 1 ? `${String(row.title || '分镜').trim()}·${index + 1}` : row.title,
      dialogue: segment.kind === 'dialogue' ? formatDialogue(segment.speaker, segment.text) : null,
      narration: segment.kind === 'narration' ? segment.text : null,
      action: index === 0 ? row.action : continuationAction,
      result: last ? row.result : `${who}尚未结束当前表达，情绪和动作自然延续。`,
      duration,
      universal_segment_text: null,
    };
  });
}

function splitActionIntoParts(value, desiredParts) {
  const clauses = splitSemanticUnits(value, 'sentence')
    .flatMap((part) => splitSemanticUnits(part, 'clause'))
    .filter(Boolean);
  if (desiredParts <= 1 || clauses.length < 2) return [String(value || '').trim()].filter(Boolean);
  const partCount = Math.min(desiredParts, clauses.length);
  const result = [];
  for (let i = 0; i < partCount; i++) {
    const start = Math.floor((i * clauses.length) / partCount);
    const end = Math.floor(((i + 1) * clauses.length) / partCount);
    result.push(clauses.slice(start, Math.max(start + 1, end)).join('').trim());
  }
  return result.filter(Boolean);
}

function expandLongActionRow(row, mode, fixedDuration) {
  if (String(row.dialogue || '').trim() || String(row.narration || '').trim()) return [{ ...row }];
  const requested = Number(row.duration);
  const maxDuration = mode === 'fixed' ? fixedDuration : STORYBOARD_MAX_DURATION;
  if (!Number.isFinite(requested) || requested <= maxDuration) return [{ ...row }];
  const actionParts = splitActionIntoParts(row.action, Math.ceil(requested / maxDuration));
  if (actionParts.length <= 1) return [{ ...row }];
  const distributed = Math.max(STORYBOARD_MIN_DURATION, Math.ceil(requested / actionParts.length));
  return actionParts.map((action, index) => ({
    ...row,
    title: `${String(row.title || '分镜').trim()}·${index + 1}`,
    action,
    result: index === actionParts.length - 1
      ? row.result
      : '当前动作阶段完成，人物与镜头自然衔接到下一动作。',
    duration: mode === 'fixed'
      ? fixedDuration
      : clampStoryboardDuration(distributed, STORYBOARD_MIN_DURATION),
    universal_segment_text: null,
  }));
}

/**
 * 对 AI 分镜做确定性收口：短镜合并/补足，长对白按语义拆分，最终统一为 4–15 秒并连续编号。
 */
function planStoryboardDurations(rows, options = {}) {
  const requestedFixed = clampStoryboardDuration(options.fixedDuration, DEFAULT_FIXED_DURATION);
  const mode = normalizeDurationMode(options.mode, options.hasLegacyFixedDuration);
  const mergeMax = mode === 'fixed' ? requestedFixed : STORYBOARD_MAX_DURATION;
  const merged = mergeSubMinimumRows(Array.isArray(rows) ? rows : [], mergeMax);
  const expanded = [];
  let splitCount = 0;
  for (const row of merged) {
    const audioParts = expandLongAudioRow(row, mode, requestedFixed);
    const parts = audioParts.length > 1
      ? audioParts
      : expandLongActionRow(audioParts[0], mode, requestedFixed);
    splitCount += Math.max(0, parts.length - 1);
    expanded.push(...parts);
  }

  const storyboards = expanded.map((row, index) => {
    const duration = mode === 'fixed'
      ? requestedFixed
      : clampStoryboardDuration(estimateStoryboardDuration(row), STORYBOARD_MIN_DURATION);
    return {
      ...row,
      shot_number: index + 1,
      storyboard_number: index + 1,
      duration,
    };
  });
  return {
    storyboards,
    mode,
    fixedDuration: requestedFixed,
    mergedCount: Math.max(0, (Array.isArray(rows) ? rows.length : 0) - merged.length),
    splitCount,
    totalDuration: storyboards.reduce((sum, row) => sum + row.duration, 0),
  };
}

function buildDurationPromptConstraint(mode, fixedDuration) {
  const normalizedMode = normalizeDurationMode(mode, mode === 'fixed');
  if (normalizedMode === 'fixed') {
    const duration = clampStoryboardDuration(fixedDuration, DEFAULT_FIXED_DURATION);
    return `【最高优先级——固定分镜时长】每条分镜 duration 必须填写 ${duration} 秒。任何对白或动作若无法在 ${duration} 秒内自然完成，必须按完整语句、说话人变化或动作结果拆成多条分镜；不得删改台词。`;
  }
  return `【最高优先级——智能分镜时长】每条分镜 duration 必须是 4～15 之间的整数秒。先按场景变化、说话人、完整对白、动作结果和情绪转折划分叙事节拍；不足4秒的短对白/动作应与同场景相邻动作或反应自然合并，无法合并时补足合理停顿、运镜或情绪余韵到4秒；预计超过15秒的对白或复杂动作必须按完整语句或动作结果拆镜。严禁删改、压缩或遗漏原台词。不要把所有镜头机械设成同一时长。`;
}

function validateDurationBudget(storyboardCount, videoDuration) {
  const count = Number(storyboardCount);
  const total = Number(videoDuration);
  if (!Number.isFinite(count) || count <= 0 || !Number.isFinite(total) || total <= 0) {
    return { valid: true, minTotal: null, maxTotal: null };
  }
  const roundedCount = Math.max(1, Math.round(count));
  const minTotal = roundedCount * STORYBOARD_MIN_DURATION;
  const maxTotal = roundedCount * STORYBOARD_MAX_DURATION;
  return {
    valid: total >= minTotal && total <= maxTotal,
    minTotal,
    maxTotal,
  };
}

module.exports = {
  STORYBOARD_MIN_DURATION,
  STORYBOARD_MAX_DURATION,
  DEFAULT_FIXED_DURATION,
  clampStoryboardDuration,
  normalizeDurationMode,
  parseDialogueToEntries,
  charSpeechWeight,
  splitTextForDuration,
  estimateStoryboardDuration,
  planStoryboardDurations,
  buildDurationPromptConstraint,
  validateDurationBudget,
};
