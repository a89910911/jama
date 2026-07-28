ALTER TABLE async_tasks ADD COLUMN user_id INTEGER;

ALTER TABLE image_generations ADD COLUMN requested_by_user_id INTEGER;
ALTER TABLE image_generations ADD COLUMN ai_config_id INTEGER;
ALTER TABLE image_generations ADD COLUMN ai_config_revision_id INTEGER;

ALTER TABLE video_generations ADD COLUMN requested_by_user_id INTEGER;
ALTER TABLE video_generations ADD COLUMN ai_config_id INTEGER;
ALTER TABLE video_generations ADD COLUMN ai_config_revision_id INTEGER;

ALTER TABLE video_merges ADD COLUMN requested_by_user_id INTEGER;
ALTER TABLE video_merges ADD COLUMN tts_config_id INTEGER;
ALTER TABLE video_merges ADD COLUMN tts_config_revision_id INTEGER;

ALTER TABLE redraw_jobs ADD COLUMN user_id INTEGER;
ALTER TABLE action_migration_jobs ADD COLUMN user_id INTEGER;

ALTER TABLE ai_request_logs ADD COLUMN user_ai_config_id INTEGER;
ALTER TABLE ai_request_logs ADD COLUMN user_ai_config_revision_id INTEGER;
ALTER TABLE ai_request_logs ADD COLUMN username_snapshot VARCHAR(255);

-- 既有数据产生于“仅有公共配置”的版本，升级时统一归属给唯一的最高权限账号。
-- 新安装在此时尚无账号或业务数据，标量子查询返回 NULL，不影响后续初始化。
UPDATE async_tasks
SET user_id = (SELECT id FROM user_accounts WHERE LOWER(username) = 'admin' LIMIT 1)
WHERE user_id IS NULL;

UPDATE image_generations
SET requested_by_user_id = (SELECT id FROM user_accounts WHERE LOWER(username) = 'admin' LIMIT 1)
WHERE requested_by_user_id IS NULL;

UPDATE video_generations
SET requested_by_user_id = (SELECT id FROM user_accounts WHERE LOWER(username) = 'admin' LIMIT 1)
WHERE requested_by_user_id IS NULL;

UPDATE video_merges
SET requested_by_user_id = (SELECT id FROM user_accounts WHERE LOWER(username) = 'admin' LIMIT 1)
WHERE requested_by_user_id IS NULL;

UPDATE redraw_jobs
SET user_id = (SELECT id FROM user_accounts WHERE LOWER(username) = 'admin' LIMIT 1)
WHERE user_id IS NULL;

UPDATE action_migration_jobs
SET user_id = (SELECT id FROM user_accounts WHERE LOWER(username) = 'admin' LIMIT 1)
WHERE user_id IS NULL;

CREATE INDEX IF NOT EXISTS idx_async_tasks_user_status
ON async_tasks(user_id, status, updated_at);

CREATE INDEX IF NOT EXISTS idx_image_generations_user_config
ON image_generations(requested_by_user_id, ai_config_id);

CREATE INDEX IF NOT EXISTS idx_video_generations_user_config
ON video_generations(requested_by_user_id, ai_config_id);

CREATE INDEX IF NOT EXISTS idx_ai_request_logs_user_created
ON ai_request_logs(user_id, created_at DESC);
