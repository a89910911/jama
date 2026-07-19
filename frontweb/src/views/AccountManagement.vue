<template>
  <div class="accounts-page">
    <header class="accounts-header">
      <div>
        <p class="eyebrow">ADMINISTRATION</p>
        <h1>账号管理</h1>
        <p class="subtitle">创建和维护可进入系统的普通账号</p>
      </div>
      <div class="header-actions">
        <el-button @click="router.push('/')"><el-icon><ArrowLeft /></el-icon>返回项目</el-button>
        <el-button type="primary" @click="openCreate"><el-icon><Plus /></el-icon>创建账号</el-button>
      </div>
    </header>

    <main class="accounts-content">
      <section class="summary-grid">
        <div class="summary-card">
          <span>账号总数</span>
          <strong>{{ accounts.length }}</strong>
        </div>
        <div class="summary-card">
          <span>启用账号</span>
          <strong>{{ activeCount }}</strong>
        </div>
        <div class="summary-card admin-card">
          <span>最高权限</span>
          <strong>zhangzexing</strong>
        </div>
      </section>

      <section class="table-card">
        <div class="table-heading">
          <div>
            <h2>系统账号</h2>
            <p>普通账号无法访问 AI 配置和账号管理</p>
          </div>
          <el-button :loading="loading" circle :icon="Refresh" @click="loadAccounts" />
        </div>
        <el-table v-loading="loading" :data="accounts" row-key="id">
          <el-table-column label="账号" min-width="180">
            <template #default="{ row }">
              <div class="account-name">
                <span class="avatar">{{ row.username.slice(0, 1).toUpperCase() }}</span>
                <div>
                  <strong>{{ row.username }}</strong>
                  <span>#{{ row.id }}</span>
                </div>
              </div>
            </template>
          </el-table-column>
          <el-table-column label="权限" width="150">
            <template #default="{ row }">
              <el-tag v-if="row.is_super_admin" type="warning" effect="dark">最高权限</el-tag>
              <el-tag v-else type="info">普通账号</el-tag>
            </template>
          </el-table-column>
          <el-table-column label="状态" width="130">
            <template #default="{ row }">
              <el-switch
                :model-value="row.is_active"
                :disabled="row.is_super_admin"
                inline-prompt
                active-text="启用"
                inactive-text="停用"
                @change="(value) => toggleAccount(row, value)"
              />
            </template>
          </el-table-column>
          <el-table-column label="最后登录" min-width="180">
            <template #default="{ row }">{{ formatTime(row.last_login_at) }}</template>
          </el-table-column>
          <el-table-column label="创建时间" min-width="180">
            <template #default="{ row }">{{ formatTime(row.created_at) }}</template>
          </el-table-column>
          <el-table-column label="操作" width="180" fixed="right">
            <template #default="{ row }">
              <template v-if="!row.is_super_admin">
                <el-button link type="primary" @click="resetPassword(row)">重置密码</el-button>
                <el-button link type="danger" @click="removeAccount(row)">删除</el-button>
              </template>
              <span v-else class="protected-text">系统保护</span>
            </template>
          </el-table-column>
        </el-table>
      </section>
    </main>

    <el-dialog v-model="createVisible" title="创建普通账号" width="440px" :close-on-click-modal="false">
      <el-form ref="createFormRef" :model="createForm" :rules="createRules" label-position="top">
        <el-form-item label="账号" prop="username">
          <el-input v-model.trim="createForm.username" maxlength="50" placeholder="3-50 位字母、数字、点、下划线或短横线" />
        </el-form-item>
        <el-form-item label="初始密码" prop="password">
          <el-input v-model="createForm.password" type="password" show-password maxlength="128" placeholder="至少 6 位" />
        </el-form-item>
        <el-form-item label="确认密码" prop="confirmPassword">
          <el-input v-model="createForm.confirmPassword" type="password" show-password maxlength="128" placeholder="再次输入密码" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="createVisible = false">取消</el-button>
        <el-button type="primary" :loading="creating" @click="createAccount">创建账号</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup>
import { computed, onMounted, reactive, ref } from 'vue'
import { useRouter } from 'vue-router'
import { ElMessage, ElMessageBox } from 'element-plus'
import { ArrowLeft, Plus, Refresh } from '@element-plus/icons-vue'
import { accountsAPI } from '@/api/auth'

const router = useRouter()
const accounts = ref([])
const loading = ref(false)
const creating = ref(false)
const createVisible = ref(false)
const createFormRef = ref()
const createForm = reactive({ username: '', password: '', confirmPassword: '' })
const activeCount = computed(() => accounts.value.filter((item) => item.is_active).length)

const createRules = {
  username: [
    { required: true, message: '请输入账号', trigger: 'blur' },
    { pattern: /^[A-Za-z0-9._-]{3,50}$/, message: '账号格式不正确', trigger: 'blur' },
  ],
  password: [
    { required: true, message: '请输入初始密码', trigger: 'blur' },
    { min: 6, max: 128, message: '密码长度需为 6-128 位', trigger: 'blur' },
  ],
  confirmPassword: [{
    validator: (_rule, value, callback) => {
      if (!value) callback(new Error('请再次输入密码'))
      else if (value !== createForm.password) callback(new Error('两次输入的密码不一致'))
      else callback()
    },
    trigger: 'blur',
  }],
}

function formatTime(value) {
  if (!value) return '从未登录'
  return new Date(value).toLocaleString('zh-CN', { hour12: false })
}

async function loadAccounts() {
  loading.value = true
  try {
    const result = await accountsAPI.list()
    accounts.value = result?.items || []
  } finally {
    loading.value = false
  }
}

function openCreate() {
  Object.assign(createForm, { username: '', password: '', confirmPassword: '' })
  createFormRef.value?.clearValidate()
  createVisible.value = true
}

async function createAccount() {
  try {
    await createFormRef.value?.validate()
  } catch {
    return
  }
  creating.value = true
  try {
    await accountsAPI.create({ username: createForm.username, password: createForm.password })
    ElMessage.success('账号已创建')
    createVisible.value = false
    await loadAccounts()
  } finally {
    creating.value = false
  }
}

async function toggleAccount(row, value) {
  try {
    const result = await accountsAPI.setActive(row.id, value)
    Object.assign(row, result.user)
    ElMessage.success(value ? '账号已启用' : '账号已停用')
  } catch {
    await loadAccounts()
  }
}

async function resetPassword(row) {
  try {
    const { value } = await ElMessageBox.prompt(
      `为账号 ${row.username} 设置新密码`,
      '重置密码',
      {
        inputType: 'password',
        inputPlaceholder: '请输入 6-128 位新密码',
        inputValidator: (text) => {
          const length = String(text || '').length
          return (length >= 6 && length <= 128) || '密码长度需为 6-128 位'
        },
        confirmButtonText: '确认重置',
        cancelButtonText: '取消',
      }
    )
    await accountsAPI.resetPassword(row.id, value)
    ElMessage.success('密码已重置，原登录会话已失效')
  } catch (error) {
    if (error !== 'cancel' && error !== 'close') throw error
  }
}

async function removeAccount(row) {
  try {
    await ElMessageBox.confirm(
      `确定删除账号“${row.username}”吗？删除后无法恢复。`,
      '删除账号',
      { type: 'warning', confirmButtonText: '确定删除', cancelButtonText: '取消' }
    )
    await accountsAPI.delete(row.id)
    ElMessage.success('账号已删除')
    await loadAccounts()
  } catch (error) {
    if (error !== 'cancel' && error !== 'close') throw error
  }
}

onMounted(loadAccounts)
</script>

<style scoped>
.accounts-page { min-height: 100vh; background: var(--bg-page); color: var(--text-primary); }
.accounts-header {
  display: flex;
  align-items: flex-end;
  justify-content: space-between;
  gap: 24px;
  padding: 34px max(32px, calc((100vw - 1280px) / 2));
  border-bottom: 1px solid var(--border-color);
  background: var(--bg-card);
}
.eyebrow { margin: 0 0 6px; color: #d99a48; font-size: 11px; font-weight: 700; letter-spacing: .18em; }
.accounts-header h1 { margin: 0; font-size: 28px; }
.subtitle { margin: 8px 0 0; color: var(--text-secondary); }
.header-actions { display: flex; gap: 10px; }
.accounts-content { width: min(1280px, calc(100% - 48px)); margin: 28px auto; }
.summary-grid { display: grid; grid-template-columns: 1fr 1fr 1.5fr; gap: 16px; margin-bottom: 20px; }
.summary-card {
  display: flex; min-height: 104px; flex-direction: column; justify-content: center; gap: 8px;
  padding: 22px; border: 1px solid var(--border-color); border-radius: 16px; background: var(--bg-card);
}
.summary-card span { color: var(--text-secondary); font-size: 13px; }
.summary-card strong { font-size: 26px; }
.admin-card { background: linear-gradient(135deg, rgba(217,154,72,.15), var(--bg-card)); }
.admin-card strong { color: #d99a48; font-size: 20px; }
.table-card { overflow: hidden; border: 1px solid var(--border-color); border-radius: 16px; background: var(--bg-card); }
.table-heading { display: flex; align-items: center; justify-content: space-between; padding: 22px 24px; border-bottom: 1px solid var(--border-color); }
.table-heading h2 { margin: 0 0 5px; font-size: 17px; }
.table-heading p { margin: 0; color: var(--text-secondary); font-size: 13px; }
.account-name { display: flex; align-items: center; gap: 11px; }
.avatar { display: grid; width: 36px; height: 36px; place-items: center; border-radius: 10px; color: #5a390d; background: #e7b466; font-weight: 800; }
.account-name div { display: flex; flex-direction: column; gap: 3px; }
.account-name div span { color: var(--text-secondary); font-size: 11px; }
.protected-text { color: var(--text-secondary); font-size: 12px; }
@media (max-width: 760px) {
  .accounts-header { align-items: stretch; flex-direction: column; padding: 24px; }
  .header-actions { justify-content: flex-end; }
  .accounts-content { width: calc(100% - 24px); }
  .summary-grid { grid-template-columns: 1fr; }
}
</style>
