import { createRouter, createWebHistory } from 'vue-router'
import { authState, initializeAuth } from '@/stores/auth'

const router = createRouter({
  history: createWebHistory(import.meta.env.BASE_URL),
  routes: [
    {
      path: '/login',
      name: 'login',
      component: () => import('@/views/Login.vue'),
      meta: { title: '登录', public: true }
    },
    {
      path: '/',
      name: 'list',
      component: () => import('@/views/FilmList.vue'),
      meta: { title: '项目列表' }
    },
    {
      path: '/drama/:id',
      name: 'drama-detail',
      component: () => import('@/views/DramaDetail.vue'),
      meta: { title: '剧集管理' }
    },
    {
      path: '/film/:id',
      name: 'film',
      component: () => import('@/views/FilmCreate.vue'),
      meta: { title: 'AI 视频生成' }
    },
    {
      path: '/film/:id/canvas',
      name: 'film-canvas',
      component: () => import('@/views/DramaCanvas.vue'),
      meta: { title: '画布模式' }
    },
    {
      path: '/film/:id/prompts',
      name: 'project-prompts',
      component: () => import('@/views/ProjectPrompts.vue'),
      meta: { title: '项目提示词' }
    },
    {
      path: '/film/:id/ai-records',
      name: 'ai-records',
      component: () => import('@/views/AiRequests.vue'),
      meta: { title: 'AI 记录' }
    },
    {
      path: '/ai-config',
      name: 'ai-config',
      component: () => import('@/views/AiConfig.vue'),
      meta: { title: 'AI 配置', requiresSuperAdmin: true }
    },
    {
      path: '/accounts',
      name: 'accounts',
      component: () => import('@/views/AccountManagement.vue'),
      meta: { title: '账号管理', requiresSuperAdmin: true }
    },
    {
      path: '/free-create',
      name: 'free-create',
      component: () => import('@/views/FreeCreate.vue'),
      meta: { title: '自由创作' }
    },
    {
      path: '/media-library',
      name: 'media-library',
      component: () => import('@/views/MediaLibrary.vue'),
      meta: { title: '媒体素材库' }
    }
  ]
})

router.beforeEach(async (to) => {
  document.title = 'JamaAI'

  await initializeAuth()

  if (to.meta.public) {
    if (to.name === 'login' && authState.user) {
      const redirect = String(to.query.redirect || '/')
      return redirect.startsWith('/') && !redirect.startsWith('//') ? redirect : '/'
    }
    return true
  }

  if (!authState.user) {
    return {
      name: 'login',
      query: to.fullPath === '/' ? {} : { redirect: to.fullPath }
    }
  }

  if (to.meta.requiresSuperAdmin && !authState.user.is_super_admin) {
    return { name: 'list' }
  }
  return true
})

export default router
