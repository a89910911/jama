import request from '@/utils/request'

export const sceneModelMapAPI = {
  definitions() {
    return request.get('/scene-model-map-definitions')
  },
  overview() {
    return request.get('/business-scenes/overview')
  },
  list() {
    return request.get('/scene-model-map')
  },
  get(key) {
    return request.get(`/scene-model-map/${key}`)
  },
  create(body) {
    return request.post('/scene-model-map', body)
  },
  update(key, body) {
    return request.put(`/scene-model-map/${key}`, body)
  },
  delete(key) {
    return request.delete(`/scene-model-map/${key}`)
  }
}
