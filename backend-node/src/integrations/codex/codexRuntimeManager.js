const fs = require('fs');
const path = require('path');
const { CodexAppServerClient } = require('./codexAppServerClient');

const DEFAULT_TURN_TIMEOUT_MS = 5 * 60_000;
const BASE_DEVELOPER_INSTRUCTIONS = [
  '你是 LocalMiniDrama 内置的短剧创作助手。',
  '只生成用户需要的文字或使用 Codex 内置图片生成能力生成图片。',
  '不要调用 shell、文件系统、网页、MCP 或其他外部工具。',
  '不要尝试操作数据库；数据库变更由宿主应用验证并执行。',
  '需要结构化输出时必须严格遵守宿主应用提供的 JSON Schema。',
].join('\n');

class CodexRuntimeManager {
  constructor(options = {}) {
    this.options = options;
    this.log = options.log || console;
    this.clientFactory = options.clientFactory
      || (() => new CodexAppServerClient({ ...options, log: this.log }));
    this.client = null;
    this.readyPromise = null;
    this.loadedThreads = new Set();
    this.activeTasks = new Map();
    this.activeThreads = new Set();
    this.cancelledTasks = new Set();
    this.lastError = null;
    this.workDir = options.workDir
      || path.join(process.cwd(), 'data', 'codex-workspace');
  }

  async ensureReady() {
    if (this.client?.ready) return this.client;
    if (this.readyPromise) return this.readyPromise;
    this.readyPromise = (async () => {
      fs.mkdirSync(this.workDir, { recursive: true });
      const client = this.clientFactory();
      client.on('exit', (error) => {
        this.lastError = error;
        this.loadedThreads.clear();
        this.activeTasks.clear();
        this.activeThreads.clear();
        this.cancelledTasks.clear();
        if (this.client === client) this.client = null;
        this.log?.warn?.('Codex app-server stopped', { error: error.message });
      });
      client.on('protocolError', (error) => {
        this.log?.warn?.('Codex app-server protocol error', { error: error.message });
      });
      try {
        await client.start();
      } catch (error) {
        await client.stop().catch(() => {});
        throw error;
      }
      this.client = client;
      this.lastError = null;
      return client;
    })();
    try {
      return await this.readyPromise;
    } catch (error) {
      this.lastError = error;
      throw error;
    } finally {
      this.readyPromise = null;
    }
  }

  async ensureThread(existingThreadId) {
    const client = await this.ensureReady();
    if (existingThreadId && this.loadedThreads.has(existingThreadId)) {
      return existingThreadId;
    }
    if (existingThreadId) {
      try {
        const resumed = await client.request('thread/resume', { threadId: existingThreadId });
        const id = resumed?.thread?.id || existingThreadId;
        this.loadedThreads.add(id);
        return id;
      } catch (error) {
        this.log?.warn?.('Codex thread resume failed; starting a new thread', {
          thread_id: existingThreadId,
          error: error.message,
        });
      }
    }
    const started = await client.request('thread/start', {
      cwd: path.resolve(this.workDir),
      approvalPolicy: 'never',
      sandbox: 'read-only',
      ephemeral: false,
      personality: 'pragmatic',
      developerInstructions: BASE_DEVELOPER_INSTRUCTIONS,
    });
    const id = started?.thread?.id;
    if (!id) throw new Error('Codex app-server did not return a thread id');
    this.loadedThreads.add(id);
    return id;
  }

  async runTurn(options) {
    const {
      taskId,
      threadId,
      text,
      outputSchema,
      onDelta,
      onImage,
      onTurnStarted,
      timeoutMs = DEFAULT_TURN_TIMEOUT_MS,
    } = options;
    if (!threadId) throw new Error('Codex thread id is required');
    if (this.activeThreads.has(threadId)) {
      const error = new Error('当前对话已有生成任务，请等待完成或先停止');
      error.code = 'CODEX_THREAD_BUSY';
      throw error;
    }

    const client = await this.ensureReady();
    this.activeThreads.add(threadId);
    let turnId = null;
    let agentText = '';
    const images = [];
    let completed = false;
    let timeout = null;
    let settle;
    let rejectTurn;
    const turnDone = new Promise((resolve, reject) => {
      settle = resolve;
      rejectTurn = reject;
    });

    const onNotification = (message) => {
      const params = message.params || {};
      if (params.threadId && params.threadId !== threadId) return;
      if (turnId && params.turnId && params.turnId !== turnId) return;
      if (message.method === 'item/agentMessage/delta') {
        const delta = String(params.delta || '');
        agentText += delta;
        onDelta?.(delta);
        return;
      }
      if (message.method === 'item/completed' && params.item?.type === 'agentMessage') {
        agentText = String(params.item.text || agentText || '');
        return;
      }
      if (message.method === 'item/completed' && params.item?.type === 'imageGeneration') {
        const image = {
          id: params.item.id,
          status: params.item.status,
          revisedPrompt: params.item.revisedPrompt || '',
          savedPath: params.item.savedPath || '',
        };
        images.push(image);
        onImage?.(image);
        return;
      }
      if (message.method === 'turn/completed' && (!turnId || params.turn?.id === turnId)) {
        completed = true;
        settle(params.turn);
      }
    };
    client.on('notification', onNotification);
    const onClientExit = (error) => rejectTurn(error);
    client.once('exit', onClientExit);

    try {
      const params = {
        threadId,
        input: [{ type: 'text', text: String(text || ''), text_elements: [] }],
        approvalPolicy: 'never',
        sandboxPolicy: { type: 'readOnly', networkAccess: false },
      };
      if (outputSchema) params.outputSchema = outputSchema;
      const started = await client.request('turn/start', params);
      turnId = started?.turn?.id;
      if (!turnId) throw new Error('Codex app-server did not return a turn id');
      this.activeTasks.set(String(taskId), { threadId, turnId });
      onTurnStarted?.(turnId);
      timeout = setTimeout(async () => {
        if (completed) return;
        try {
          await client.request('turn/interrupt', { threadId, turnId }, 10_000);
        } catch (_) {}
        const error = new Error('Codex 生成超时');
        error.code = 'CODEX_TURN_TIMEOUT';
        rejectTurn(error);
      }, timeoutMs);
      timeout.unref?.();
      if (this.cancelledTasks.has(String(taskId))) {
        await client.request('turn/interrupt', { threadId, turnId }, 10_000);
      }

      const finalTurn = await turnDone;
      if (finalTurn?.status === 'interrupted') {
        const error = new Error('用户已取消');
        error.code = 'CODEX_TURN_INTERRUPTED';
        throw error;
      }
      if (finalTurn?.status !== 'completed') {
        const error = new Error(finalTurn?.error?.message || `Codex 生成失败：${finalTurn?.status || 'unknown'}`);
        error.code = 'CODEX_TURN_FAILED';
        throw error;
      }
      return { turnId, text: agentText.trim(), images, turn: finalTurn };
    } finally {
      if (timeout) clearTimeout(timeout);
      client.off('notification', onNotification);
      client.off('exit', onClientExit);
      this.activeTasks.delete(String(taskId));
      this.activeThreads.delete(threadId);
      this.cancelledTasks.delete(String(taskId));
    }
  }

  async interruptTask(taskId) {
    const key = String(taskId);
    const active = this.activeTasks.get(key);
    if (!active || !this.client?.ready) {
      this.cancelledTasks.add(key);
      return false;
    }
    await this.client.request('turn/interrupt', active, 10_000);
    return true;
  }

  status() {
    return {
      available: !!this.client?.ready,
      starting: !!this.readyPromise,
      active_turns: this.activeTasks.size,
      error: this.lastError?.message || null,
      runtime: this.client?.status?.() || null,
    };
  }

  async shutdown() {
    const client = this.client;
    this.client = null;
    this.loadedThreads.clear();
    this.activeTasks.clear();
    this.activeThreads.clear();
    this.cancelledTasks.clear();
    await client?.stop?.();
  }
}

let singleton;

function getCodexRuntime(options = {}) {
  if (!singleton) singleton = new CodexRuntimeManager(options);
  return singleton;
}

function resetCodexRuntimeForTests() {
  singleton = null;
}

module.exports = {
  CodexRuntimeManager,
  getCodexRuntime,
  resetCodexRuntimeForTests,
  BASE_DEVELOPER_INSTRUCTIONS,
  DEFAULT_TURN_TIMEOUT_MS,
};
