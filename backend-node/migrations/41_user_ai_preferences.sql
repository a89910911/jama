CREATE TABLE IF NOT EXISTS user_ai_preferences (
  user_id INTEGER PRIMARY KEY,
  assistant_engine VARCHAR(64) NOT NULL DEFAULT 'configured_api',
  image_concurrency INTEGER NOT NULL DEFAULT 3,
  video_concurrency INTEGER NOT NULL DEFAULT 3,
  created_at VARCHAR(32) NOT NULL DEFAULT '',
  updated_at VARCHAR(32) NOT NULL DEFAULT ''
);

