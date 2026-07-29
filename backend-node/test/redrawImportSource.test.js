const test = require('node:test');
const assert = require('node:assert/strict');

const {
  resolveStoryboardSourceVideoPath,
} = require('../src/services/redrawService');

test('redraw import prefers the completed current video local path', () => {
  assert.equal(
    resolveStoryboardSourceVideoPath({
      local_path: 'images/first-frame.jpg',
      video_url: '/static/videos/legacy.mp4',
      current_video_url: '/static/videos/current.mp4',
      current_video_local_path: 'videos/current.mp4',
    }),
    'videos/current.mp4'
  );
});

test('redraw import never treats the storyboard first-frame image as source video', () => {
  assert.equal(
    resolveStoryboardSourceVideoPath({
      local_path: 'images/first-frame.jpg',
      image_url: '/static/images/first-frame.jpg',
    }),
    ''
  );
});

test('redraw import supports legacy storyboard video_url records', () => {
  assert.equal(
    resolveStoryboardSourceVideoPath({
      local_path: 'images/first-frame.jpg',
      video_url: '/static/videos/storyboard.mp4',
    }),
    '/static/videos/storyboard.mp4'
  );
});
