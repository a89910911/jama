<template>
  <div class="app" :class="{ 'app--login': isLogin }">
    <aside v-if="!isLogin" class="activity-rail" aria-label="全局功能导航">
      <RouterLink class="activity-brand" to="/" aria-label="返回项目首页">
        <img src="/logo.jpg" alt="" />
      </RouterLink>

      <nav class="activity-nav">
        <RouterLink
          v-for="item in railItems"
          :key="item.to"
          :to="item.to"
          class="activity-item"
          :class="{ 'is-active': isRailActive(item) }"
          :title="item.label"
        >
          <el-icon><component :is="item.icon" /></el-icon>
          <span>{{ item.shortLabel }}</span>
        </RouterLink>
      </nav>

      <div class="activity-spacer" />

      <AccountSession compact />

      <button
        class="activity-item activity-theme"
        type="button"
        :title="isDark ? '切换到浅色模式' : '切换到暗色模式'"
        @click="toggleTheme"
      >
        <el-icon><Sunny v-if="isDark" /><Moon v-else /></el-icon>
        <span>{{ isDark ? '浅色' : '暗色' }}</span>
      </button>
    </aside>

    <div class="app-content" :class="{ 'app-content--login': isLogin }">
      <router-view />
    </div>
    <ImageHoverPreview />
    <GenerationProgressCenter v-if="!isLogin" />
  </div>
</template>

<script setup>
import { computed } from 'vue'
import { useRoute } from 'vue-router'
import {
  HomeFilled,
  MagicStick,
  Moon,
  Picture,
  Refresh,
  Setting,
  Sunny,
  VideoCamera,
} from '@element-plus/icons-vue'
import ImageHoverPreview from '@/components/ImageHoverPreview.vue'
import GenerationProgressCenter from '@/components/GenerationProgressCenter.vue'
import AccountSession from '@/components/AccountSession.vue'
import { useTheme } from '@/composables/useTheme'

const route = useRoute()
const { isDark, toggle: toggleTheme } = useTheme()
const isLogin = computed(() => route.name === 'login'
  || route.path === '/login'
  || window.location.pathname === '/login')

const railItems = [
  { to: '/', label: '项目与剧集', shortLabel: '项目', icon: HomeFilled },
  { to: '/free-create', label: '自由创作', shortLabel: '创作', icon: MagicStick },
  { to: '/media-library', label: '媒体素材库', shortLabel: '素材', icon: Picture },
  { to: '/redraw', label: '转绘工作台', shortLabel: '转绘', icon: Refresh },
  { to: '/action-migration', label: '动作迁移', shortLabel: '动迁', icon: VideoCamera },
  { to: '/ai-config', label: 'AI 配置', shortLabel: '设置', icon: Setting },
]

function isRailActive(item) {
  if (item.to === '/') {
    return route.path === '/'
      || route.path.startsWith('/drama/')
      || route.path.startsWith('/film/')
  }
  return route.path === item.to || route.path.startsWith(`${item.to}/`)
}
</script>

<style>
* {
  box-sizing: border-box;
}
html, body, #app, .app {
  margin: 0;
  padding: 0;
  min-height: 100vh;
  background: var(--bg-page);
  color: var(--text-primary);
  transition: background 0.25s, color 0.25s;
}
</style>
