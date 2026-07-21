const test = require('node:test');
const assert = require('node:assert/strict');

const {
  STORYBOARD_MIN_DURATION,
  STORYBOARD_MAX_DURATION,
  clampStoryboardDuration,
  normalizeDurationMode,
  parseDialogueToEntries,
  charSpeechWeight,
  splitTextForDuration,
  planStoryboardDurations,
  validateDurationBudget,
} = require('../src/services/storyboardDurationPlanner');

test('normalizes duration mode and clamps every duration to the model range', () => {
  assert.equal(STORYBOARD_MIN_DURATION, 4);
  assert.equal(STORYBOARD_MAX_DURATION, 15);
  assert.equal(clampStoryboardDuration(1), 4);
  assert.equal(clampStoryboardDuration(20), 15);
  assert.equal(clampStoryboardDuration(8.4), 8);
  assert.equal(normalizeDurationMode('adaptive', true), 'adaptive');
  assert.equal(normalizeDurationMode('', true), 'fixed');
  assert.equal(normalizeDurationMode('', false), 'adaptive');
});

test('merges adjacent compatible sub-four-second beats before normalization', () => {
  const result = planStoryboardDurations([
    { shot_number: 1, scene_id: 7, duration: 2, title: '抬头', action: '女孩抬头。' },
    { shot_number: 2, scene_id: 7, duration: 2, title: '望门', action: '女孩望向门外。' },
  ], { mode: 'adaptive' });

  assert.equal(result.storyboards.length, 1);
  assert.equal(result.storyboards[0].duration, 4);
  assert.match(result.storyboards[0].action, /抬头/);
  assert.match(result.storyboards[0].action, /门外/);
  assert.equal(result.mergedCount, 1);
});

test('parses adjacent speaker turns without requiring a newline', () => {
  assert.deepEqual(parseDialogueToEntries('小雨：“走吧。”阿青：“好。”'), [
    { speaker: '小雨', text: '走吧。' },
    { speaker: '阿青', text: '好。' },
  ]);
});

test('does not merge short beats across different scenes', () => {
  const result = planStoryboardDurations([
    { shot_number: 1, scene_id: 7, duration: 2, action: '室内停顿。' },
    { shot_number: 2, scene_id: 8, duration: 2, action: '街道空镜。' },
  ], { mode: 'adaptive' });

  assert.equal(result.storyboards.length, 2);
  assert.deepEqual(result.storyboards.map((row) => row.duration), [4, 5]);
});

test('splits long dialogue on semantic boundaries without losing or reordering text', () => {
  const line = '这是第一句需要完整保留的长对白，用来说明人物当前的处境和选择。接下来是第二句，同样不能删改，也不能为了压缩时长而省略。最后一句负责收束情绪，并自然连接到人物说完后的反应。';
  assert.ok(charSpeechWeight(line) > 15);
  const chunks = splitTextForDuration(line, 15);
  assert.ok(chunks.length >= 2);
  assert.equal(chunks.join(''), line);
  assert.ok(chunks.every((chunk) => charSpeechWeight(chunk) <= 15));

  const result = planStoryboardDurations([
    {
      shot_number: 1,
      scene_id: 3,
      duration: 30,
      title: '坦白',
      dialogue: `小雨：“${line}”`,
      action: '小雨望着对方说出心里话。',
      result: '小雨说完后沉默。',
    },
  ], { mode: 'adaptive' });

  assert.ok(result.storyboards.length >= 2);
  assert.ok(result.storyboards.every((row) => row.duration >= 4 && row.duration <= 15));
  const restored = result.storyboards
    .flatMap((row) => parseDialogueToEntries(row.dialogue))
    .map((entry) => entry.text)
    .join('');
  assert.equal(restored, line);
  assert.deepEqual(result.storyboards.map((row) => row.shot_number),
    result.storyboards.map((_, index) => index + 1));
});

test('fixed mode keeps the selected duration and splits dialogue that cannot fit', () => {
  const line = '第一段对白包含足够多的信息，需要在固定时长下拆开。第二段对白继续推进剧情，原文仍然必须完整保留。';
  const result = planStoryboardDurations([
    { shot_number: 1, duration: 20, title: '说明', dialogue: `阿青：${line}`, action: '阿青解释。' },
  ], { mode: 'fixed', fixedDuration: 8 });

  assert.ok(result.storyboards.length >= 2);
  assert.ok(result.storyboards.every((row) => row.duration === 8));
  const restored = result.storyboards
    .flatMap((row) => parseDialogueToEntries(row.dialogue))
    .map((entry) => entry.text)
    .join('');
  assert.equal(restored, line);
});

test('splits complex over-limit action when semantic action clauses are available', () => {
  const result = planStoryboardDurations([
    {
      shot_number: 1,
      duration: 30,
      title: '追逐',
      action: '他猛地起身，推开桌边的人，冲到门口，拉开木门，沿着长廊追出去。',
      result: '他消失在长廊尽头。',
    },
  ], { mode: 'adaptive' });

  assert.ok(result.storyboards.length >= 2);
  assert.ok(result.storyboards.every((row) => row.duration >= 4 && row.duration <= 15));
  assert.equal(result.storyboards.map((row) => row.action).join(''), '他猛地起身，推开桌边的人，冲到门口，拉开木门，沿着长廊追出去。');
});

test('validates count and total-duration feasibility against 4–15 seconds', () => {
  assert.equal(validateDurationBudget(10, 40).valid, true);
  assert.equal(validateDurationBudget(10, 150).valid, true);
  assert.deepEqual(validateDurationBudget(10, 39), { valid: false, minTotal: 40, maxTotal: 150 });
  assert.deepEqual(validateDurationBudget(10, 151), { valid: false, minTotal: 40, maxTotal: 150 });
  assert.equal(validateDurationBudget(undefined, 100).valid, true);
});
