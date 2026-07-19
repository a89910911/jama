import request from '@/utils/request'

export const taskAPI = {
  get(taskId) {
    return request.get(`/tasks/${taskId}`)
  },
  cancel(taskId, body) {
    return request.post(`/tasks/${taskId}/cancel`, body || {})
  },
  listByResource(resourceId) {
    return request.get('/tasks', { params: { resource_id: String(resourceId) } })
  },
  listByResources(resourceIds) {
    const ids = [...new Set(
      (resourceIds || [])
        .map((id) => String(id ?? '').trim())
        .filter(Boolean)
    )]
    if (!ids.length) return Promise.resolve([])
    return request.get('/tasks', {
      params: { resource_ids: ids.join(','), active_only: 1 },
    })
  },
}
