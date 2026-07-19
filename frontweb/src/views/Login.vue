<template>
  <main class="login-page">
    <div class="login-glow login-glow-one" />
    <div class="login-glow login-glow-two" />
    <section class="login-card">
      <div class="brand-mark"><img src="/logo.jpg" alt="JamaAI" /></div>
      <div class="login-heading">
        <p class="eyebrow">JamaAI</p>
        <h1>JamaAI</h1>
        <p>登录后进入创作工作台</p>
      </div>

      <el-form ref="formRef" :model="form" :rules="rules" size="large" @submit.prevent="submit">
        <el-form-item prop="username">
          <el-input
            v-model.trim="form.username"
            autocomplete="username"
            placeholder="账号"
            :prefix-icon="User"
            autofocus
            @keyup.enter="submit"
          />
        </el-form-item>
        <el-form-item prop="password">
          <el-input
            v-model="form.password"
            type="password"
            autocomplete="current-password"
            placeholder="密码"
            :prefix-icon="Lock"
            show-password
            @keyup.enter="submit"
          />
        </el-form-item>
        <el-button class="login-submit" type="primary" native-type="submit" :loading="submitting" @click="submit">
          进入系统
        </el-button>
      </el-form>
      <p class="security-note"><el-icon><Lock /></el-icon>账号由管理员统一创建和管理</p>
    </section>
  </main>
</template>

<script setup>
import { reactive, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { User, Lock } from '@element-plus/icons-vue'
import { login } from '@/stores/auth'

const route = useRoute()
const router = useRouter()
const formRef = ref()
const submitting = ref(false)
const form = reactive({ username: '', password: '' })
const rules = {
  username: [{ required: true, message: '请输入账号', trigger: 'blur' }],
  password: [{ required: true, message: '请输入密码', trigger: 'blur' }],
}

function safeRedirect() {
  const target = String(route.query.redirect || '/')
  return target.startsWith('/') && !target.startsWith('//') ? target : '/'
}

async function submit() {
  if (submitting.value) return
  try {
    await formRef.value?.validate()
  } catch {
    return
  }
  submitting.value = true
  try {
    await login(form.username, form.password)
    await router.replace(safeRedirect())
  } catch {
    // 错误消息由统一请求层展示。
  } finally {
    submitting.value = false
  }
}
</script>

<style scoped>
.login-page {
  position: relative;
  display: grid;
  min-height: 100vh;
  place-items: center;
  overflow: hidden;
  padding: 28px;
  background:
    radial-gradient(circle at 12% 12%, rgba(234, 166, 66, 0.14), transparent 30%),
    radial-gradient(circle at 88% 88%, rgba(91, 126, 255, 0.13), transparent 32%),
    #090b11;
}
.login-page::before {
  position: absolute;
  inset: 0;
  background-image:
    linear-gradient(rgba(255,255,255,.025) 1px, transparent 1px),
    linear-gradient(90deg, rgba(255,255,255,.025) 1px, transparent 1px);
  background-size: 44px 44px;
  content: '';
  mask-image: linear-gradient(to bottom, black, transparent 86%);
}
.login-card {
  position: relative;
  z-index: 1;
  width: min(420px, 100%);
  padding: 42px 42px 32px;
  border: 1px solid rgba(255, 255, 255, 0.11);
  border-radius: 24px;
  background: rgba(20, 23, 32, 0.86);
  box-shadow: 0 28px 80px rgba(0, 0, 0, 0.48);
  backdrop-filter: blur(22px);
}
.brand-mark {
  display: grid;
  width: 58px;
  height: 58px;
  margin-bottom: 24px;
  place-items: center;
  border-radius: 17px;
  overflow: hidden;
  background: #101010;
  box-shadow: 0 12px 34px rgba(221, 144, 47, 0.28);
}
.brand-mark img {
  width: 100%;
  height: 100%;
  object-fit: cover;
  object-position: center 32%;
}
.login-heading { margin-bottom: 30px; }
.eyebrow {
  margin: 0 0 8px;
  color: #dca45c;
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.22em;
}
.login-heading h1 {
  margin: 0 0 9px;
  color: #f6f7fb;
  font-size: 29px;
  letter-spacing: -0.02em;
}
.login-heading > p:last-child {
  margin: 0;
  color: #949aaa;
  font-size: 14px;
}
.login-card :deep(.el-input__wrapper) {
  padding: 4px 14px;
  border: 1px solid rgba(255, 255, 255, 0.08);
  border-radius: 12px;
  background: rgba(5, 7, 12, 0.62);
  box-shadow: none;
}
.login-card :deep(.el-input__wrapper.is-focus) {
  border-color: #d99a48;
  box-shadow: 0 0 0 3px rgba(217, 154, 72, 0.12);
}
.login-card :deep(.el-input__inner) { color: #f4f5f8; }
.login-submit {
  width: 100%;
  height: 48px;
  margin-top: 6px;
  border: 0;
  border-radius: 12px;
  color: #171109;
  background: linear-gradient(135deg, #f7c476, #dc9337);
  font-weight: 700;
}
.login-submit:hover { color: #171109; filter: brightness(1.06); }
.security-note {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 6px;
  margin: 24px 0 0;
  color: #6f7584;
  font-size: 12px;
}
@media (max-width: 520px) {
  .login-card { padding: 34px 24px 26px; }
}
</style>
