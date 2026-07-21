const { EventEmitter } = require('events');
const { spawn } = require('child_process');
const readline = require('readline');
const path = require('path');

const DEFAULT_REQUEST_TIMEOUT_MS = 30_000;

function resolveCodexInvocation(options = {}) {
  const configured = options.executable || process.env.CODEX_EXECUTABLE;
  if (configured) {
    if (/\.m?js$/i.test(configured)) {
      return { command: process.execPath, args: [configured] };
    }
    return { command: configured, args: [] };
  }

  try {
    const packageJson = require.resolve('@openai/codex/package.json');
    const cliScript = path.join(path.dirname(packageJson), 'bin', 'codex.js');
    return { command: process.execPath, args: [cliScript] };
  } catch (_) {
    return { command: 'codex', args: [], shell: process.platform === 'win32' };
  }
}

class CodexAppServerClient extends EventEmitter {
  constructor(options = {}) {
    super();
    this.options = options;
    this.log = options.log || console;
    this.spawnImpl = options.spawnImpl || spawn;
    this.requestTimeoutMs = options.requestTimeoutMs || DEFAULT_REQUEST_TIMEOUT_MS;
    this.proc = null;
    this.reader = null;
    this.pending = new Map();
    this.nextId = 1;
    this.ready = false;
    this.startPromise = null;
    this.stderrTail = [];
  }

  async start() {
    if (this.ready && this.proc) return this;
    if (this.startPromise) return this.startPromise;
    this.startPromise = this._start();
    try {
      await this.startPromise;
      return this;
    } finally {
      this.startPromise = null;
    }
  }

  async _start() {
    const invocation = resolveCodexInvocation(this.options);
    const args = [...invocation.args, 'app-server', '--listen', 'stdio://'];
    this.proc = this.spawnImpl(invocation.command, args, {
      cwd: this.options.cwd || process.cwd(),
      env: { ...process.env, ...(this.options.env || {}) },
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true,
      shell: invocation.shell === true,
    });

    this.proc.once('error', (error) => this._handleExit(error));
    this.proc.once('exit', (code, signal) => {
      this._handleExit(new Error(`Codex app-server exited (code=${code}, signal=${signal || 'none'})`));
    });
    this.proc.stderr?.setEncoding('utf8');
    this.proc.stderr?.on('data', (chunk) => {
      const text = String(chunk || '').trim();
      if (!text) return;
      this.stderrTail.push(text);
      if (this.stderrTail.length > 20) this.stderrTail.shift();
      this.emit('stderr', text);
    });

    this.reader = readline.createInterface({ input: this.proc.stdout });
    this.reader.on('line', (line) => this._handleLine(line));

    await this.request('initialize', {
      clientInfo: {
        name: 'jama-local-mini-drama',
        title: 'LocalMiniDrama',
        version: this.options.clientVersion || '1.2.8',
      },
      capabilities: { experimentalApi: true },
    });
    this.notify('initialized', {});
    this.ready = true;
    this.emit('ready');
  }

  _handleLine(line) {
    const text = String(line || '').trim();
    if (!text) return;
    let message;
    try {
      message = JSON.parse(text);
    } catch (error) {
      this.emit('protocolError', new Error(`Invalid app-server JSON: ${error.message}`));
      return;
    }

    if (message.id !== undefined && (message.result !== undefined || message.error !== undefined)) {
      const entry = this.pending.get(message.id);
      if (!entry) return;
      this.pending.delete(message.id);
      clearTimeout(entry.timer);
      if (message.error) {
        const error = new Error(message.error.message || 'Codex app-server request failed');
        error.code = message.error.code;
        error.data = message.error.data;
        entry.reject(error);
      } else {
        entry.resolve(message.result);
      }
      return;
    }

    if (message.id !== undefined && message.method) {
      // This integration never allows model-initiated approvals or external actions.
      this._send({
        id: message.id,
        error: { code: -32000, message: 'Client approvals are disabled for AI chat' },
      });
      this.emit('serverRequestRejected', message);
      return;
    }

    if (message.method) {
      this.emit('notification', message);
      this.emit(message.method, message.params);
    }
  }

  _handleExit(error) {
    const wasRunning = !!this.proc;
    this.ready = false;
    this.proc = null;
    this.reader?.close?.();
    this.reader = null;
    for (const entry of this.pending.values()) {
      clearTimeout(entry.timer);
      entry.reject(error);
    }
    this.pending.clear();
    if (wasRunning) this.emit('exit', error);
  }

  _send(payload) {
    if (!this.proc?.stdin?.writable) {
      throw new Error('Codex app-server is not running');
    }
    this.proc.stdin.write(`${JSON.stringify(payload)}\n`);
  }

  request(method, params = {}, timeoutMs = this.requestTimeoutMs) {
    if (!this.proc?.stdin?.writable) {
      return Promise.reject(new Error('Codex app-server is not running'));
    }
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        const error = new Error(`Codex app-server request timed out: ${method}`);
        error.code = 'CODEX_REQUEST_TIMEOUT';
        reject(error);
      }, timeoutMs);
      timer.unref?.();
      this.pending.set(id, { resolve, reject, timer, method });
      try {
        this._send({ id, method, params });
      } catch (error) {
        clearTimeout(timer);
        this.pending.delete(id);
        reject(error);
      }
    });
  }

  notify(method, params = {}) {
    this._send({ method, params });
  }

  async stop() {
    const proc = this.proc;
    this.ready = false;
    this.proc = null;
    this.reader?.close?.();
    this.reader = null;
    if (!proc) return;
    try {
      proc.stdin?.end?.();
      proc.kill?.();
    } catch (_) {}
  }

  status() {
    return {
      ready: this.ready,
      pid: this.proc?.pid || null,
      stderr: this.stderrTail.slice(-5),
    };
  }
}

module.exports = {
  CodexAppServerClient,
  resolveCodexInvocation,
  DEFAULT_REQUEST_TIMEOUT_MS,
};
