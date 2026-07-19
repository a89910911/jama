ALTER TABLE prompt_definitions
ADD COLUMN subcategory TEXT NOT NULL DEFAULT '';

ALTER TABLE prompt_definitions
ADD COLUMN workflow_stage TEXT NOT NULL DEFAULT '';

ALTER TABLE prompt_definitions
ADD COLUMN workflow_order INTEGER NOT NULL DEFAULT 0;
