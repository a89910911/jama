import request from '@/utils/request'

export const characterLookAPI = {
  list(characterId, params = {}) {
    return request.get(`/characters/${characterId}/looks`, { params })
  },
  get(lookId) {
    return request.get(`/character-looks/${lookId}`)
  },
  create(characterId, data) {
    return request.post(`/characters/${characterId}/looks`, data)
  },
  update(lookId, data) {
    return request.put(`/character-looks/${lookId}`, data)
  },
  setDefault(lookId) {
    return request.post(`/character-looks/${lookId}/set-default`, {})
  },
  generateImage(lookId, data = {}) {
    return request.post(`/character-looks/${lookId}/generate-image`, data)
  },
  uploadImage(lookId, file) {
    const form = new FormData()
    form.append('file', file)
    return request.post(`/character-looks/${lookId}/upload-image`, form, {
      headers: { 'Content-Type': 'multipart/form-data' },
    })
  },
  remove(lookId, replacementLookId = null) {
    return request.delete(`/character-looks/${lookId}`, {
      data: replacementLookId ? { replacement_look_id: replacementLookId } : {},
    })
  },
  bind(data) {
    return request.put('/look-bindings', data)
  },
  unbind(scopeType, scopeId, characterId) {
    return request.delete(
      `/look-bindings/${scopeType}/${scopeId}/characters/${characterId}`
    )
  },
  episodeContext(episodeId) {
    return request.get(`/episodes/${episodeId}/look-context`)
  },
  storyboardContext(storyboardId) {
    return request.get(`/storyboards/${storyboardId}/visual-context`)
  },
  preflight(episodeId, persist = false) {
    return request.post(`/episodes/${episodeId}/visual-preflight`, { persist })
  },
}
