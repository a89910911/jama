-- Persist the minimum input needed to resume safe, idempotent async jobs after a restart.
ALTER TABLE async_tasks ADD COLUMN request_payload TEXT;
ALTER TABLE async_tasks ADD COLUMN recovery_attempts INTEGER DEFAULT 0;
