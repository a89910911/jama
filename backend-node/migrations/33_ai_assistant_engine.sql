ALTER TABLE codex_chat_sessions ADD COLUMN engine TEXT;

UPDATE codex_chat_sessions
SET engine = 'codex'
WHERE engine IS NULL OR TRIM(engine) = '';
