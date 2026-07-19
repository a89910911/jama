CREATE TABLE IF NOT EXISTS ai_request_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  request_uuid TEXT NOT NULL UNIQUE,
  drama_id INTEGER,
  user_id INTEGER,
  service_type TEXT NOT NULL,
  operation TEXT NOT NULL,
  scene_key TEXT,
  provider TEXT,
  model TEXT,
  config_id INTEGER,
  status TEXT NOT NULL DEFAULT 'processing',
  request_payload TEXT,
  response_payload TEXT,
  error_message TEXT,
  duration_ms INTEGER,
  related_type TEXT,
  related_id TEXT,
  created_at TEXT NOT NULL,
  completed_at TEXT,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_ai_request_logs_drama_created
ON ai_request_logs(drama_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_ai_request_logs_drama_status
ON ai_request_logs(drama_id, status);

CREATE INDEX IF NOT EXISTS idx_ai_request_logs_service_type
ON ai_request_logs(service_type);

CREATE INDEX IF NOT EXISTS idx_ai_request_logs_related
ON ai_request_logs(related_type, related_id, created_at DESC);
