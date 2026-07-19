-- FilmCreate / DramaCanvas detail and media-loading hot paths.
CREATE INDEX IF NOT EXISTS idx_episodes_drama_active_order
  ON episodes (drama_id, episode_number, id)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_storyboards_episode_active_order
  ON storyboards (episode_id, storyboard_number, id)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_characters_drama_active_order
  ON characters (drama_id, sort_order, name)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_scenes_episode_active
  ON scenes (episode_id, id)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_scenes_drama_active
  ON scenes (drama_id, id)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_props_episode_active
  ON props (episode_id, id)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_props_drama_active
  ON props (drama_id, id)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_image_generations_storyboard_active_created
  ON image_generations (storyboard_id, created_at DESC, id DESC)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_image_generations_drama_status_active
  ON image_generations (drama_id, status, created_at DESC)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_video_generations_storyboard_active_created
  ON video_generations (storyboard_id, created_at DESC, id DESC)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_video_generations_drama_status_active
  ON video_generations (drama_id, status, created_at DESC)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_async_tasks_resource_active_created
  ON async_tasks (resource_id, created_at DESC)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_async_tasks_status_active_updated
  ON async_tasks (status, updated_at)
  WHERE deleted_at IS NULL;
