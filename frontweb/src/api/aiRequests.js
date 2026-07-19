import request from '@/utils/request'

export const aiRequestsAPI = {
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
