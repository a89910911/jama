ALTER TABLE prompt_definitions
ADD COLUMN content_type TEXT NOT NULL DEFAULT 'user_template';
