import request from '@/utils/request'

export const actionMigrationAPI = {
  capability() {
    return request.get('/action-migration/capability')
  },
  listJobs(params) {
    return request.get('/action-migration/jobs', { params: params || {} })
  },
  createJob(formData) {
    return request.post('/action-migration/jobs', formData, {
      headers: { 'Content-Type': 'multipart/form-data' }
    })
  },
  getJob(id) {
    return request.get(`/action-migration/jobs/${id}`)
  },
  preflightJob(id) {
    return request.post(`/action-migration/jobs/${id}/preflight`)
  },
  submitJob(id, data) {
    return request.post(`/action-migration/jobs/${id}/submit`, data || {})
  },
  retryJob(id, data) {
    return request.post(`/action-migration/jobs/${id}/retry`, data || {})
  },
  cancelJob(id) {
    return request.post(`/action-migration/jobs/${id}/cancel`)
  },
  deleteJob(id) {
    return request.delete(`/action-migration/jobs/${id}`)
  }
}
