<template>
  <div class="project-prompts">
    <header class="header">
      <div class="header-inner">
        <h1 class="logo" @click="goList">
          <BrandLogo />
        </h1>
        <div class="page-heading">
          <span class="page-title">项目提示词</span>
          <span v-if="projectTitle" class="project-title">{{ projectTitle }}</span>
        </div>
        <el-button class="btn-back" @click="goBack">
          <el-icon><ArrowLeft /></el-icon>
          返回
        </el-button>
      </div>
    </header>

    <main class="main">
      <PromptEditor :drama-id="projectId" />
    </main>
  </div>
</template>

<script setup>
import { computed, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { ArrowLeft } from '@element-plus/icons-vue'
import { dramaAPI } from '@/api/drama'
import PromptEditor from '@/components/PromptEditor.vue'
import BrandLogo from '@/components/BrandLogo.vue'

const route = useRoute()
const router = useRouter()
const projectTitle = ref('')

const projectId = computed(() => String(route.params.id || ''))
const returnTo = computed(() => {
  const value = Array.isArray(route.query.returnTo) ? route.query.returnTo[0] : route.query.returnTo
  return typeof value === 'string' && value.startsWith('/') && !value.startsWith('//')
    ? value
    : `/film/${projectId.value}`
})

function goList() {
  router.push({ name: 'list' })
}

function goBack() {
  router.push(returnTo.value)
}

watch(projectId, async (id) => {
  projectTitle.value = ''
  if (!id) return
  try {
    const drama = await dramaAPI.get(id)
    projectTitle.value = drama?.title || `项目 #${id}`
  } catch (_) {
    projectTitle.value = `项目 #${id}`
  }
}, { immediate: true })
</script>

<style scoped>
.project-prompts {
  min-height: 100vh;
  background: #0f0f12;
  background-image:
    radial-gradient(ellipse 80% 50% at 20% -20%, rgba(120, 60, 220, 0.18) 0%, transparent 60%),
    radial-gradient(ellipse 60% 40% at 80% 110%, rgba(60, 100, 220, 0.12) 0%, transparent 60%);
}
html.light .project-prompts {
  background: #f5f3ff;
  background-image:
    radial-gradient(ellipse 80% 50% at 20% -20%, rgba(139, 92, 246, 0.12) 0%, transparent 60%),
    radial-gradient(ellipse 60% 40% at 80% 110%, rgba(99, 102, 241, 0.08) 0%, transparent 60%);
}
.header {
  position: sticky;
  top: 0;
  z-index: 100;
  background: rgba(18, 18, 22, 0.82);
  backdrop-filter: blur(16px);
  -webkit-backdrop-filter: blur(16px);
  border-bottom: 1px solid rgba(139, 92, 246, 0.18);
  box-shadow: 0 2px 20px rgba(0, 0, 0, 0.4);
}
html.light .header {
  background: rgba(255, 255, 255, 0.85);
  border-bottom-color: rgba(139, 92, 246, 0.2);
  box-shadow: 0 2px 16px rgba(139, 92, 246, 0.08);
}
.header-inner {
  max-width: 1600px;
  margin: 0 auto;
  padding: 12px 24px;
  display: flex;
  align-items: center;
  gap: 16px;
}
.logo {
  margin: 0;
  cursor: pointer;
  display: flex;
  flex-direction: column;
  gap: 1px;
  line-height: 1;
  transition: filter 0.3s;
}
.logo:hover {
  filter: drop-shadow(0 0 10px rgba(139, 92, 246, 0.5));
}
.logo-main {
  font-size: 1.1rem;
  font-weight: 700;
  background: linear-gradient(135deg, #c4b5fd 0%, #818cf8 50%, #a78bfa 100%);
  -webkit-background-clip: text;
  -webkit-text-fill-color: transparent;
  background-clip: text;
}
.logo-sub {
  font-size: 0.68rem;
  font-weight: 400;
  letter-spacing: 0.02em;
  color: #6d6d7a;
  -webkit-text-fill-color: #6d6d7a;
}
html.light .logo-main {
  background: linear-gradient(135deg, #7c3aed, #6366f1);
  -webkit-background-clip: text;
  -webkit-text-fill-color: transparent;
  background-clip: text;
}
html.light .logo-sub {
  color: #9ca3af;
  -webkit-text-fill-color: #9ca3af;
}
.page-heading {
  flex: 1;
  min-width: 0;
  display: flex;
  align-items: center;
  gap: 10px;
}
.page-title {
  color: #a1a1aa;
  font-size: 16px;
  white-space: nowrap;
}
.project-title {
  min-width: 0;
  overflow: hidden;
  color: #71717a;
  font-size: 13px;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.project-title::before {
  content: '·';
  margin-right: 10px;
}
html.light .page-title { color: #6b7280; }
html.light .project-title { color: #9ca3af; }
.main {
  width: calc(100% - 40px);
  max-width: 1600px;
  min-height: calc(100vh - 96px);
  margin: 20px auto;
  padding: 20px 24px;
  background: rgba(24, 24, 27, 0.75);
  backdrop-filter: blur(12px);
  -webkit-backdrop-filter: blur(12px);
  border: 1px solid rgba(63, 63, 70, 0.7);
  border-radius: 16px;
  box-shadow: 0 4px 24px rgba(0, 0, 0, 0.25);
}
html.light .main {
  background: rgba(255, 255, 255, 0.88);
  border-color: rgba(139, 92, 246, 0.15);
  box-shadow: 0 4px 20px rgba(139, 92, 246, 0.08);
}
@media (max-width: 720px) {
  .header-inner { padding: 10px 14px; }
  .logo-sub, .project-title { display: none; }
  .page-title { font-size: 14px; }
  .main {
    width: calc(100% - 20px);
    margin: 10px auto;
    padding: 14px;
    border-radius: 12px;
  }
}
</style>
