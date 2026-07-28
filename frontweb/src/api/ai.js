import request from '@/utils/request'

export const aiAPI = {
  list(serviceType) {
    return request.get('/ai-configs', { params: serviceType ? { service_type: serviceType } : {} })
  },
  listRuntime(serviceType) {
    return request.get('/runtime/ai-configs', { params: { service_type: serviceType } })
  },
  get(id) {
    return request.get(`/ai-configs/${id}`)
  },
  create(body) {
    return request.post('/ai-configs', body)
  },
  update(id, body) {
    return request.put(`/ai-configs/${id}`, body)
  },
  setDefault(id) {
    return request.put(`/ai-configs/${id}/default`)
  },
  listModels(id, serviceType = 'text') {
    return request.get(`/ai-configs/${id}/models`, { params: { service_type: serviceType } })
  },
  delete(id) {
    return request.delete(`/ai-configs/${id}`)
  },
  testConnection(body) {
    return request.post('/ai-configs/test', body)
  },
  /** MediaBridge 素材管理（列表、详情、URL 导入和删除） */
  mediaBridgeAsset(body) {
    return request.post('/ai-configs/mediabridge-assets', body)
  },
  /** 上传本地文件到 MediaBridge 素材库 */
  uploadMediaBridgeAsset(form) {
    return request.post('/ai-configs/mediabridge-assets/upload', form, {
      headers: { 'Content-Type': 'multipart/form-data' },
      timeout: 600000,
    })
  },
  getVendorLock() {
    return request.get('/ai-configs/vendor-lock')
  },
  bulkUpdateKey(apiKey) {
    return request.put('/ai-configs/bulk-update-key', { api_key: apiKey })
  }
}
