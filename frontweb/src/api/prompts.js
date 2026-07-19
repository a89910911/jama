import request from '@/utils/request'

export const promptsAPI = {
  list(params = {}) {
    return request.get('/settings/prompts', { params })
  },
  update(key, { content, version }) {
    return request.put(`/settings/prompts/${encodeURIComponent(key)}`, { content, version })
  },
  reset(key, { version }) {
    return request.post(`/settings/prompts/${encodeURIComponent(key)}/reset-seed`, { version })
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
  updateProject(dramaId, key, { content, version }) {
    return request.put(`/dramas/${dramaId}/prompts/${encodeURIComponent(key)}`, {
      content,
      version,
    })
  },
  deleteProject(dramaId, key, { version }) {
    return request.delete(`/dramas/${dramaId}/prompts/${encodeURIComponent(key)}`, {
      data: { version },
    })
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
