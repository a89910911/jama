import request from '@/utils/request'

export const authAPI = {
  login(username, password) {
    return request.post('/auth/login', { username, password })
  },
  logout() {
    return request.post('/auth/logout')
  },
  me() {
    return request.get('/auth/me', { suppressAuthFeedback: true })
  },
  changePassword(currentPassword, newPassword) {
    return request.put('/auth/password', {
      current_password: currentPassword,
      new_password: newPassword,
    })
  },
}

export const accountsAPI = {
  list() {
    return request.get('/accounts')
  },
  create(data) {
    return request.post('/accounts', data)
  },
  setActive(id, isActive) {
    return request.put(`/accounts/${id}`, { is_active: isActive })
  },
  resetPassword(id, password) {
    return request.put(`/accounts/${id}/password`, { password })
  },
  delete(id) {
    return request.delete(`/accounts/${id}`)
  },
}
