import request from '@/utils/request'

export const codexChatAPI = {
  status() {
    return request.get('/codex/status')
  },

  listSessions(dramaId, episodeId) {
    return request.get(`/dramas/${dramaId}/ai-chat/sessions`, {
      params: episodeId != null ? { episode_id: episodeId } : {},
    })
  },

  createSession(dramaId, body = {}) {
    return request.post(`/dramas/${dramaId}/ai-chat/sessions`, body)
  },

  listMessages(sessionId) {
    return request.get(`/ai-chat/sessions/${sessionId}/messages`)
  },

  sendMessage(sessionId, body) {
    return request.post(`/ai-chat/sessions/${sessionId}/messages`, body)
  },

  eventsUrl(sessionId, afterId = 0) {
    const query = afterId ? `?after=${encodeURIComponent(afterId)}` : ''
    return `/api/v1/ai-chat/sessions/${encodeURIComponent(sessionId)}/events${query}`
  },
}
