const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('events');
const { PassThrough } = require('stream');
const {
  CodexAppServerClient,
  resolveCodexInvocation,
} = require('../src/integrations/codex/codexAppServerClient');
const {
  CodexRuntimeManager,
} = require('../src/integrations/codex/codexRuntimeManager');

class FakeProcess extends EventEmitter {
  constructor(onMessage) {
    super();
    this.pid = 12345;
    this.stdout = new PassThrough();
    this.stderr = new PassThrough();
    this.stdin = new PassThrough();
    this.stdin.setEncoding('utf8');
    let buffered = '';
    this.stdin.on('data', (chunk) => {
      buffered += chunk;
      let index;
      while ((index = buffered.indexOf('\n')) >= 0) {
        const line = buffered.slice(0, index);
        buffered = buffered.slice(index + 1);
        if (line.trim()) onMessage(JSON.parse(line), this);
      }
    });
  }

  send(message) {
    this.stdout.write(`${JSON.stringify(message)}\n`);
  }

  kill() {
    this.emit('exit', 0, 'SIGTERM');
    return true;
  }
}

describe('CodexAppServerClient', () => {
  it('uses the pinned local Codex package when installed', () => {
    const invocation = resolveCodexInvocation();
    assert.equal(invocation.command, process.execPath);
    assert.match(invocation.args[0], /@openai[\\/]codex[\\/]bin[\\/]codex\.js$/);
  });

  it('initializes over JSONL and forwards notifications', async () => {
    const writes = [];
    let fake;
    const client = new CodexAppServerClient({
      spawnImpl(command, args) {
        assert.equal(command, 'fake-codex');
        assert.deepEqual(args, ['app-server', '--listen', 'stdio://']);
        fake = new FakeProcess((message, proc) => {
          writes.push(message);
          if (message.method === 'initialize' && message.id) {
            proc.send({ id: message.id, result: { userAgent: 'fake/1.0' } });
          }
        });
        return fake;
      },
      executable: 'fake-codex',
    });

    await client.start();
    assert.equal(client.status().ready, true);
    assert.equal(writes[0].method, 'initialize');
    assert.equal(writes[1].method, 'initialized');

    const received = new Promise((resolve) => client.once('notification', resolve));
    fake.send({ method: 'item/agentMessage/delta', params: { delta: '你好' } });
    assert.equal((await received).params.delta, '你好');
    await client.stop();
  });
});

describe('CodexRuntimeManager', () => {
  it('collects text and image events from a completed turn', async () => {
    class FakeClient extends EventEmitter {
      constructor() {
        super();
        this.ready = false;
      }
      async start() { this.ready = true; }
      status() { return { ready: this.ready }; }
      async stop() { this.ready = false; }
      async request(method) {
        if (method === 'thread/start') return { thread: { id: 'thread-1' } };
        if (method === 'turn/start') {
          setImmediate(() => {
            this.emit('notification', {
              method: 'item/agentMessage/delta',
              params: { threadId: 'thread-1', turnId: 'turn-1', delta: '完成' },
            });
            this.emit('notification', {
              method: 'item/completed',
              params: {
                threadId: 'thread-1',
                turnId: 'turn-1',
                item: {
                  type: 'imageGeneration',
                  id: 'image-1',
                  status: 'completed',
                  savedPath: 'C:\\safe\\image.png',
                  revisedPrompt: 'safe prompt',
                  result: 'large-base64-must-not-be-returned',
                },
              },
            });
            this.emit('notification', {
              method: 'turn/completed',
              params: { threadId: 'thread-1', turn: { id: 'turn-1', status: 'completed' } },
            });
          });
          return { turn: { id: 'turn-1' } };
        }
        throw new Error(`Unexpected method: ${method}`);
      }
    }

    const fake = new FakeClient();
    const manager = new CodexRuntimeManager({
      clientFactory: () => fake,
      workDir: process.cwd(),
      log: { warn() {} },
    });
    const threadId = await manager.ensureThread();
    const deltas = [];
    const result = await manager.runTurn({
      taskId: 'task-1',
      threadId,
      text: 'test',
      onDelta: (delta) => deltas.push(delta),
    });

    assert.equal(result.text, '完成');
    assert.deepEqual(deltas, ['完成']);
    assert.equal(result.images[0].savedPath, 'C:\\safe\\image.png');
    assert.equal('result' in result.images[0], false);
    await manager.shutdown();
  });
});
