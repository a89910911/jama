const DEFAULT_IMAGE_LIMIT_PER_STORYBOARD = 100;
const DEFAULT_VIDEO_LIMIT_PER_STORYBOARD = 50;

function normalizeStoryboardIds(storyboardIds) {
  if (!Array.isArray(storyboardIds)) return [];
  return [...new Set(
    storyboardIds
      .map((id) => Number(id))
      .filter((id) => Number.isInteger(id) && id > 0)
  )].slice(0, 500);
}

function buildStoryboardFilter(ids, column = 's.id') {
  if (!ids.length) return { sql: '', params: [] };
  return {
    sql: ` AND ${column} IN (${ids.map(() => '?').join(',')})`,
    params: ids,
  };
}

function queryRankedMedia(db, {
  table,
  episodeId,
  storyboardIds,
  limitPerStoryboard,
}) {
  const filter = buildStoryboardFilter(storyboardIds);
  return db.prepare(`
    WITH ranked_media AS (
      SELECT media.*,
             ROW_NUMBER() OVER (
               PARTITION BY media.storyboard_id
               ORDER BY media.created_at DESC, media.id DESC
             ) AS media_rank
      FROM ${table} media
      INNER JOIN storyboards s ON s.id = media.storyboard_id
      WHERE s.episode_id = ?
        AND s.deleted_at IS NULL
        AND media.deleted_at IS NULL
        ${filter.sql}
    )
    SELECT *
    FROM ranked_media
    WHERE media_rank <= ?
    ORDER BY storyboard_id ASC, created_at DESC, id DESC
  `).all(Number(episodeId), ...filter.params, limitPerStoryboard);
}

function imageRowToItem(row) {
  return {
    id: row.id,
    storyboard_id: row.storyboard_id,
    drama_id: row.drama_id,
    scene_id: row.scene_id ?? undefined,
    character_id: row.character_id,
    provider: row.provider,
    prompt: row.prompt,
    model: row.model,
    image_url: row.image_url,
    local_path: row.local_path,
    status: row.status,
    task_id: row.task_id,
    error_msg: row.error_msg,
    frame_type: row.frame_type ?? undefined,
    created_at: row.created_at,
    updated_at: row.updated_at,
    completed_at: row.completed_at,
  };
}

function videoRowToItem(row) {
  return {
    id: row.id,
    storyboard_id: row.storyboard_id,
    drama_id: row.drama_id,
    provider: row.provider,
    prompt: row.prompt,
    model: row.model,
    image_gen_id: row.image_gen_id,
    image_url: row.image_url,
    video_url: row.video_url,
    local_path: row.local_path,
    status: row.status,
    task_id: row.task_id,
    error_msg: row.error_msg,
    created_at: row.created_at,
    updated_at: row.updated_at,
    completed_at: row.completed_at,
  };
}

function groupByStoryboard(rows, mapper) {
  const grouped = {};
  for (const row of rows) {
    const key = String(row.storyboard_id);
    if (!grouped[key]) grouped[key] = [];
    grouped[key].push(mapper(row));
  }
  return grouped;
}

function getEpisodeMedia(db, episodeId, options = {}) {
  const id = Number(episodeId);
  if (!Number.isInteger(id) || id <= 0) return null;

  const episode = db.prepare(
    'SELECT id FROM episodes WHERE id = ? AND deleted_at IS NULL'
  ).get(id);
  if (!episode) return null;

  const storyboardIds = normalizeStoryboardIds(options.storyboardIds);
  const imageLimit = Math.min(
    100,
    Math.max(1, Number(options.imageLimitPerStoryboard) || DEFAULT_IMAGE_LIMIT_PER_STORYBOARD)
  );
  const videoLimit = Math.min(
    100,
    Math.max(1, Number(options.videoLimitPerStoryboard) || DEFAULT_VIDEO_LIMIT_PER_STORYBOARD)
  );

  const images = queryRankedMedia(db, {
    table: 'image_generations',
    episodeId: id,
    storyboardIds,
    limitPerStoryboard: imageLimit,
  });
  const videos = queryRankedMedia(db, {
    table: 'video_generations',
    episodeId: id,
    storyboardIds,
    limitPerStoryboard: videoLimit,
  });

  return {
    episode_id: id,
    images_by_storyboard: groupByStoryboard(images, imageRowToItem),
    videos_by_storyboard: groupByStoryboard(videos, videoRowToItem),
  };
}

module.exports = {
  getEpisodeMedia,
  normalizeStoryboardIds,
};
