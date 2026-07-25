const test = require('node:test');
const assert = require('node:assert/strict');

const dramaService = require('../src/services/dramaService');

test('getDrama preserves storyboard layout_description', () => {
  const layoutDescription = '主角位于画面左侧三分线，面向右侧人物。';
  const dramaRow = {
    id: 1,
    title: '测试短剧',
    style: 'realistic',
    status: 'draft',
  };
  const episodeRow = {
    id: 10,
    drama_id: 1,
    episode_number: 1,
    title: '第一集',
    status: 'draft',
  };
  const storyboardRow = {
    id: 100,
    episode_id: 10,
    storyboard_number: 1,
    title: '相遇',
    description: '两人在房间内相遇。',
    layout_description: layoutDescription,
    duration: 5,
    characters: '[]',
    status: 'pending',
  };

  const db = {
    prepare(sql) {
      return {
        get() {
          if (sql.includes('FROM dramas')) return dramaRow;
          throw new Error(`Unexpected get query: ${sql}`);
        },
        all() {
          if (sql.includes('FROM episodes')) return [episodeRow];
          if (sql.includes('FROM storyboards')) return [storyboardRow];
          if (
            sql.includes('FROM characters')
            || sql.includes('FROM scenes')
            || sql.includes('FROM props')
            || sql.includes('FROM storyboard_props')
            || sql.includes('FROM episode_characters')
          ) {
            return [];
          }
          throw new Error(`Unexpected all query: ${sql}`);
        },
      };
    },
  };

  const drama = dramaService.getDrama(db, 1);

  assert.equal(
    drama.episodes[0].storyboards[0].layout_description,
    layoutDescription
  );
});
