import request from '@/utils/request'

export const redrawAPI = {
  listJobs(params) {
    return request.get('/redraw/jobs', { params: params || {} })
  },
  createJob(data) {
    return request.post('/redraw/jobs', data || {})
  },
  getJob(id) {
    return request.get(`/redraw/jobs/${id}`)
  },
  createCard(jobId, data) {
    return request.post(`/redraw/jobs/${jobId}/cards`, data || {})
  },
  importEpisodeCards(jobId) {
    return request.post(`/redraw/jobs/${jobId}/import-episode-cards`)
  },
  submitJob(jobId, data) {
    return request.post(`/redraw/jobs/${jobId}/submit`, data || {})
  },
  reconcileJob(jobId) {
    return request.post(`/redraw/jobs/${jobId}/reconcile`)
  },
  repairJob(jobId) {
    return request.post(`/redraw/jobs/${jobId}/repair`)
  },
  updateCard(cardId, data) {
    return request.put(`/redraw/cards/${cardId}`, data || {})
  },
  preflightCard(cardId) {
    return request.post(`/redraw/cards/${cardId}/preflight`)
  },
  generateStructure(cardId, strength) {
    return request.post(`/redraw/cards/${cardId}/structure`, { strength })
  },
  submitCard(cardId) {
    return request.post(`/redraw/cards/${cardId}/submit`)
  }
}
