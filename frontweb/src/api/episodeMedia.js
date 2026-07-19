import request from '@/utils/request'

export const episodeMediaAPI = {
  get(episodeId, storyboardIds = []) {
    const ids = [...new Set(
      (storyboardIds || [])
        .map((id) => Number(id))
        .filter((id) => Number.isInteger(id) && id > 0)
    )]
    return request.get(`/episodes/${episodeId}/media`, {
      params: ids.length ? { storyboard_ids: ids.join(',') } : {},
    })
  },
}
