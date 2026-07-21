import request from '@/utils/request'

export const aiRequestsAPI = {
  systemList(params = {}) {
    return request.get('/ai-requests', { params })
  },
  systemStats() {
    return request.get('/ai-requests/stats')
  },
  systemGet(requestId) {
    return request.get(`/ai-requests/${requestId}`)
  },
  systemDelete(requestId) {
    return request.delete(`/ai-requests/${requestId}`)
  },
  systemClear(status) {
    return request.delete('/ai-requests', {
      params: status ? { status } : {},
    })
  },
  list(dramaId, params = {}) {
    return request.get(`/dramas/${dramaId}/ai-requests`, { params })
  },
  stats(dramaId) {
    return request.get(`/dramas/${dramaId}/ai-requests/stats`)
  },
  get(dramaId, requestId) {
    return request.get(`/dramas/${dramaId}/ai-requests/${requestId}`)
  },
  delete(dramaId, requestId) {
    return request.delete(`/dramas/${dramaId}/ai-requests/${requestId}`)
  },
  clear(dramaId, status) {
    return request.delete(`/dramas/${dramaId}/ai-requests`, {
      params: status ? { status } : {},
    })
  },
}
