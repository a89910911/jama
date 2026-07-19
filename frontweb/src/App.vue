<template>
  <div class="app">
    <router-view />

    <el-dropdown
      v-if="route.name !== 'login' && authState.user"
      class="account-session"
      trigger="click"
      placement="top-end"
      @command="handleAccountCommand"
    >
      <button class="account-trigger" type="button">
        <span class="account-avatar">{{ authState.user.username.slice(0, 1).toUpperCase() }}</span>
        <span class="account-copy">
          <strong>{{ authState.user.username }}</strong>
          <small>{{ authState.user.is_super_admin ? '最高权限' : '普通账号' }}</small>
        </span>
        <el-icon><ArrowUp /></el-icon>
      </button>
      <template #dropdown>
        <el-dropdown-menu>
          <el-dropdown-item v-if="authState.user.is_super_admin" command="accounts">
            <el-icon><UserFilled /></el-icon>账号管理
          </el-dropdown-item>
          <el-dropdown-item command="password">
            <el-icon><Key /></el-icon>修改密码
          </el-dropdown-item>
          <el-dropdown-item divided command="logout">
            <el-icon><SwitchButton /></el-icon>退出登录
          </el-dropdown-item>
        </el-dropdown-menu>
      </template>
    </el-dropdown>

    <el-dialog v-model="passwordVisible" title="修改密码" width="420px" :close-on-click-modal="false">
      <el-form label-position="top">
        <el-form-item label="当前密码">
          <el-input v-model="passwordForm.current" type="password" show-password autocomplete="current-password" />
        </el-form-item>
        <el-form-item label="新密码">
          <el-input v-model="passwordForm.next" type="password" show-password autocomplete="new-password" placeholder="6-128 位" />
        </el-form-item>
        <el-form-item label="确认新密码">
          <el-input v-model="passwordForm.confirm" type="password" show-password autocomplete="new-password" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="passwordVisible = false">取消</el-button>
        <el-button type="primary" :loading="passwordSaving" @click="submitPassword">保存并重新登录</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup>
import { reactive, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { ElMessage } from 'element-plus'
import { ArrowUp, Key, SwitchButton, UserFilled } from '@element-plus/icons-vue'
import { authState, changePassword, logout } from '@/stores/auth'

const route = useRoute()
const router = useRouter()
const passwordVisible = ref(false)
const passwordSaving = ref(false)
const passwordForm = reactive({ current: '', next: '', confirm: '' })

async function handleAccountCommand(command) {
  if (command === 'accounts') {
    await router.push({ name: 'accounts' })
    return
  }
  if (command === 'password') {
    Object.assign(passwordForm, { current: '', next: '', confirm: '' })
    passwordVisible.value = true
    return
  }
  if (command === 'logout') {
    await logout()
    await router.replace({ name: 'login' })
  }
}

async function submitPassword() {
  if (!passwordForm.current) return ElMessage.warning('请输入当前密码')
  if (passwordForm.next.length < 6 || passwordForm.next.length > 128) {
    return ElMessage.warning('新密码长度需为 6-128 位')
  }
  if (passwordForm.next !== passwordForm.confirm) {
    return ElMessage.warning('两次输入的新密码不一致')
  }
  passwordSaving.value = true
  try {
    await changePassword(passwordForm.current, passwordForm.next)
    passwordVisible.value = false
    ElMessage.success('密码已修改，请重新登录')
    await router.replace({ name: 'login' })
  } finally {
    passwordSaving.value = false
  }
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
.account-session {
  position: fixed !important;
  z-index: 4000;
  right: 18px;
  bottom: 18px;
}
.account-trigger {
  display: flex;
  align-items: center;
  gap: 10px;
  min-width: 156px;
  padding: 8px 11px 8px 8px;
  border: 1px solid var(--border-color);
  border-radius: 14px;
  color: var(--text-primary);
  background: color-mix(in srgb, var(--bg-card) 92%, transparent);
  box-shadow: 0 12px 36px rgba(0, 0, 0, .2);
  cursor: pointer;
  backdrop-filter: blur(14px);
}
.account-trigger:hover { border-color: #d99a48; }
.account-avatar {
  display: grid;
  width: 34px;
  height: 34px;
  flex: 0 0 auto;
  place-items: center;
  border-radius: 10px;
  color: #4d3008;
  background: linear-gradient(135deg, #f5c171, #d99035);
  font-weight: 800;
}
.account-copy {
  display: flex;
  min-width: 0;
  flex: 1;
  flex-direction: column;
  align-items: flex-start;
}
.account-copy strong {
  overflow: hidden;
  max-width: 105px;
  font-size: 13px;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.account-copy small { margin-top: 2px; color: var(--text-secondary); font-size: 10px; }
</style>
