import { computed, reactive } from 'vue'
import { authAPI } from '@/api/auth'

function readCachedUser() {
  try {
    const value = sessionStorage.getItem('auth_user')
    return value ? JSON.parse(value) : null
  } catch {
    return null
  }
}

export const authState = reactive({
  user: readCachedUser(),
  initialized: false,
})

export const isSuperAdmin = computed(() => Boolean(authState.user?.is_super_admin))

let initializePromise = null

function setUser(user) {
  authState.user = user || null
  if (user) {
    sessionStorage.setItem('auth_user', JSON.stringify(user))
  } else {
    sessionStorage.removeItem('auth_user')
  }
}

export function clearAuthSession() {
  setUser(null)
  authState.initialized = true
}

export async function initializeAuth() {
  if (authState.initialized) return authState.user
  if (initializePromise) return initializePromise
  initializePromise = authAPI.me()
    .then((result) => {
      setUser(result?.user)
      return authState.user
    })
    .catch(() => {
      setUser(null)
      return null
    })
    .finally(() => {
      authState.initialized = true
      initializePromise = null
    })
  return initializePromise
}

export async function login(username, password) {
  const result = await authAPI.login(username, password)
  setUser(result?.user)
  authState.initialized = true
  return authState.user
}

export async function logout() {
  try {
    await authAPI.logout()
  } finally {
    clearAuthSession()
  }
}

export async function changePassword(currentPassword, newPassword) {
  const result = await authAPI.changePassword(currentPassword, newPassword)
  clearAuthSession()
  return result
}

if (typeof window !== 'undefined') {
  window.addEventListener('auth:unauthorized', clearAuthSession)
}
