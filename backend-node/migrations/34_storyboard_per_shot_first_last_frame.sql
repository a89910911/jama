-- Per-storyboard override for the classic first/last-frame workflow.
-- NULL keeps backward-compatible inheritance from drama.metadata.
ALTER TABLE storyboards ADD COLUMN use_first_last_frame INTEGER;
