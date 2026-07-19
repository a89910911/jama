const response = require('../response');
const episodeMediaService = require('../services/episodeMediaService');

function parseStoryboardIds(value) {
  const values = Array.isArray(value) ? value : [value];
  return values
    .flatMap((item) => String(item || '').split(','))
    .map((item) => item.trim())
    .filter(Boolean);
}

module.exports = function episodeMediaRoutes(db, log) {
  return {
    get: (req, res) => {
      try {
        const result = episodeMediaService.getEpisodeMedia(
          db,
          req.params.episode_id,
          { storyboardIds: parseStoryboardIds(req.query.storyboard_ids) }
        );
        if (!result) return response.notFound(res, '剧集不存在');
        return response.success(res, result);
      } catch (err) {
        log.error('Get episode media failed', {
          episode_id: req.params.episode_id,
          error: err.message,
        });
        return response.internalError(res, err.message || '加载剧集媒体失败');
      }
    },
  };
};
