CREATE TABLE IF NOT EXISTS codex_chat_sessions (
  id TEXT PRIMARY KEY,
  drama_id INTEGER NOT NULL,
  episode_id INTEGER,
  user_id INTEGER,
  codex_thread_id TEXT,
  title TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'active',
  last_message_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  deleted_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_codex_chat_sessions_drama_updated
ON codex_chat_sessions(drama_id, updated_at DESC);

CREATE INDEX IF NOT EXISTS idx_codex_chat_sessions_episode_updated
ON codex_chat_sessions(episode_id, updated_at DESC);

CREATE TABLE IF NOT EXISTS codex_chat_messages (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  role TEXT NOT NULL,
  content_type TEXT NOT NULL DEFAULT 'text',
  content TEXT NOT NULL DEFAULT '',
  action_type TEXT,
  status TEXT NOT NULL DEFAULT 'completed',
  task_id TEXT,
  codex_turn_id TEXT,
  metadata TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  deleted_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_codex_chat_messages_session_created
ON codex_chat_messages(session_id, created_at ASC);

CREATE INDEX IF NOT EXISTS idx_codex_chat_messages_task
ON codex_chat_messages(task_id);
