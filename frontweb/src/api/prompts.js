import request from '@/utils/request'

export const promptsAPI = {
  list(params = {}) {
    return request.get('/settings/prompts', { params })
  },
  update(key, { content }) {
    return request.put(`/settings/prompts/${encodeURIComponent(key)}`, { content })
  },
  preview(key, { variables = {}, content }) {
    return request.post(`/settings/prompts/${encodeURIComponent(key)}/preview`, {
      variables,
      content,
    })
  },
  listProject(dramaId, params = {}) {
    return request.get(`/dramas/${dramaId}/prompts`, { params })
  },
  updateProject(dramaId, key, { content }) {
    return request.put(`/dramas/${dramaId}/prompts/${encodeURIComponent(key)}`, {
      content,
    })
  },
  deleteProject(dramaId, key) {
    return request.delete(`/dramas/${dramaId}/prompts/${encodeURIComponent(key)}`)
  },
  previewProject(dramaId, key, { variables = {}, content }) {
    return request.post(`/dramas/${dramaId}/prompts/${encodeURIComponent(key)}/preview`, {
      variables,
      content,
    })
  },
}

export const generationSettingsAPI = {
  get() {
    return request.get('/settings/generation')
  },
  update(data) {
    return request.put('/settings/generation', data)
  },
}

export const assistantSettingsAPI = {
  get() {
    return request.get('/settings/assistant')
  },
  update(data) {
    return request.put('/settings/assistant', data)
  },
}
