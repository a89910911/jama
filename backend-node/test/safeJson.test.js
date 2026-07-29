const test = require('node:test');
const assert = require('node:assert/strict');

const {
  safeParseAIJSON,
  extractFirstArray,
  escapeUnescapedQuotesInStrings,
} = require('../src/utils/safeJson');

test('parses every storyboard when dialogue contains raw nested quotes', () => {
  const response = [
    '```json',
    '{',
    '  "storyboards": [',
    '    {"shot_number":1,"dialogue":"林夏："这...不可能。"","narration":"第一镜"},',
    '    {"shot_number":2,"dialogue":"陈默："别再拍！"","narration":"第二镜"},',
    '    {"shot_number":3,"dialogue":"","narration":"第三镜"}',
    '  ]',
    '}',
    '```',
  ].join('\n');

  const parsed = safeParseAIJSON(response, null, { warn() {} });
  const storyboards = extractFirstArray(parsed);

  assert.equal(storyboards.length, 3);
  assert.deepEqual(storyboards.map((row) => row.shot_number), [1, 2, 3]);
  assert.equal(storyboards[0].dialogue, '林夏："这...不可能。"');
  assert.equal(storyboards[1].dialogue, '陈默："别再拍！"');
  assert.deepEqual(storyboards.map((row) => row.narration), ['第一镜', '第二镜', '第三镜']);
});

test('keeps valid escaped quotes and structural delimiters unchanged', () => {
  const valid = JSON.stringify({
    storyboards: [
      {
        shot_number: 1,
        dialogue: '他说："开始"，然后离开。',
        metadata: { enabled: true },
      },
    ],
  });

  assert.equal(escapeUnescapedQuotesInStrings(valid), valid);
  assert.deepEqual(safeParseAIJSON(valid, null, { warn() {} }), JSON.parse(valid));
});
