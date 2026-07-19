import request from '@/utils/request'

export const promptsAPI = {
  list(params = {}) {
    return request.get('/settings/prompts', { params })
  },
  update(key, { locale, content, version }) {
    return request.put(`/settings/prompts/${encodeURIComponent(key)}`, { locale, content, version })
  },
  reset(key, { locale, version }) {
    return request.post(`/settings/prompts/${encodeURIComponent(key)}/reset-seed`, { locale, version })
  },
  preview(key, { locale, variables = {}, content }) {
    return request.post(`/settings/prompts/${encodeURIComponent(key)}/preview`, {
      locale,
      variables,
      content,
    })
  },
  listProject(dramaId, params = {}) {
    return request.get(`/dramas/${dramaId}/prompts`, { params })
  },
  updateProject(dramaId, key, { locale, content, version }) {
    return request.put(`/dramas/${dramaId}/prompts/${encodeURIComponent(key)}`, {
      locale,
      content,
      version,
    })
  },
  deleteProject(dramaId, key, { locale, version }) {
    return request.delete(`/dramas/${dramaId}/prompts/${encodeURIComponent(key)}`, {
      data: { locale, version },
    })
  },
  previewProject(dramaId, key, { locale, variables = {}, content }) {
    return request.post(`/dramas/${dramaId}/prompts/${encodeURIComponent(key)}/preview`, {
      locale,
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
