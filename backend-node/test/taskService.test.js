const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');
const taskService = require('../src/services/taskService');

function createTestDb() {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE async_tasks (
      id TEXT PRIMARY KEY,
      type TEXT,
      status TEXT,
      progress INTEGER DEFAULT 0,
      message TEXT,
      error TEXT,
      result TEXT,
      resource_id TEXT,
      created_at TEXT,
      updated_at TEXT,
      completed_at TEXT,
      prompt_snapshot TEXT,
      deleted_at TEXT
    );
    CREATE TABLE image_generations (
      id INTEGER PRIMARY KEY,
      task_id TEXT,
      status TEXT,
      error_msg TEXT,
      completed_at TEXT,
      updated_at TEXT,
      deleted_at TEXT
    );
    CREATE TABLE codex_chat_messages (
      id TEXT PRIMARY KEY,
      task_id TEXT,
      status TEXT,
      content TEXT,
      updated_at TEXT,
      deleted_at TEXT
    );
  `);
  return db;
}

describe('taskService.failOrphanedAsyncTasksOnStartup', () => {
  it('marks pending and processing tasks as failed on startup', () => {
    const db = createTestDb();
    const now = '2020-01-01T00:00:00.000Z';
    db.prepare(
      `INSERT INTO async_tasks (id, type, status, progress, message, resource_id, created_at, updated_at)
       VALUES (?, ?, ?, 0, '', ?, ?, ?)`
    ).run('task-pending', 'background_extraction', 'pending', '42', now, now);
    db.prepare(
      `INSERT INTO async_tasks (id, type, status, progress, message, resource_id, created_at, updated_at)
       VALUES (?, ?, ?, 0, '', ?, ?, ?)`
    ).run('task-processing', 'background_extraction', 'processing', '42', now, now);
    db.prepare(
      `INSERT INTO async_tasks (id, type, status, progress, message, resource_id, created_at, updated_at, completed_at)
       VALUES (?, ?, ?, 100, '', ?, ?, ?, ?)`
    ).run('task-done', 'background_extraction', 'completed', '42', now, now, now);

    const count = taskService.failOrphanedAsyncTasksOnStartup(db, { warn() {}, info() {} });
    assert.equal(count, 2);

    const pending = taskService.getTask(db, 'task-pending');
    const processing = taskService.getTask(db, 'task-processing');
    const done = taskService.getTask(db, 'task-done');

    assert.equal(pending.status, 'failed');
    assert.equal(processing.status, 'failed');
    assert.equal(pending.error, taskService.ORPHAN_ASYNC_TASK_MSG);
    assert.equal(done.status, 'completed');
  });

  it('does not fail a fresh task that may belong to another live backend', () => {
    const db = createTestDb();
    const now = new Date().toISOString();
    db.prepare(
      `INSERT INTO async_tasks (id, type, status, progress, message, resource_id, created_at, updated_at)
       VALUES (?, 'image_generation', 'processing', 5, 'working', '1', ?, ?)`
    ).run('task-live-image', now, now);

    const count = taskService.failOrphanedAsyncTasksOnStartup(
      db,
      { warn() {}, info() {} },
      { staleAfterMs: 60_000 }
    );

    assert.equal(count, 0);
    assert.equal(taskService.getTask(db, 'task-live-image').status, 'processing');
  });

  it('fails a stale image task and keeps its generation record in sync', () => {
    const db = createTestDb();
    const old = '2020-01-01T00:00:00.000Z';
    db.prepare(
      `INSERT INTO async_tasks (id, type, status, progress, message, resource_id, created_at, updated_at)
       VALUES ('task-stale-image', 'image_generation', 'processing', 5, 'working', '1', ?, ?)`
    ).run(old, old);
    db.prepare(
      `INSERT INTO image_generations (id, task_id, status, updated_at)
       VALUES (1, 'task-stale-image', 'processing', ?)`
    ).run(old);

    const count = taskService.failOrphanedAsyncTasksOnStartup(db, { warn() {}, info() {} });
    const image = db.prepare('SELECT * FROM image_generations WHERE id = 1').get();

    assert.equal(count, 1);
    assert.equal(taskService.getTask(db, 'task-stale-image').status, 'failed');
    assert.equal(image.status, 'failed');
    assert.equal(image.error_msg, taskService.ORPHAN_ASYNC_TASK_MSG);
  });

  it('fails the assistant message when a stale Codex chat task is interrupted', () => {
    const db = createTestDb();
    const old = '2020-01-01T00:00:00.000Z';
    db.prepare(
      `INSERT INTO async_tasks (id, type, status, progress, message, resource_id, created_at, updated_at)
       VALUES ('task-stale-codex', 'codex_chat', 'processing', 20, 'working', 'chat:1', ?, ?)`
    ).run(old, old);
    db.prepare(
      `INSERT INTO codex_chat_messages (id, task_id, status, content, updated_at)
       VALUES ('message-stale-codex', 'task-stale-codex', 'processing', '', ?)`
    ).run(old);

    const count = taskService.failOrphanedAsyncTasksOnStartup(db, { warn() {}, info() {} });
    const message = db.prepare(
      'SELECT status, content FROM codex_chat_messages WHERE id = ?'
    ).get('message-stale-codex');

    assert.equal(count, 1);
    assert.equal(message.status, 'failed');
    assert.match(message.content, /生成中断/);
    assert.match(message.content, /服务重启后任务中断/);
  });

  it('keeps resumable provider video tasks active for startup recovery', () => {
    const db = createTestDb();
    db.exec(`
      CREATE TABLE video_generations (
        id INTEGER PRIMARY KEY,
        task_id TEXT,
        status TEXT,
        provider_task_id TEXT,
        deleted_at TEXT
      );
    `);
    const now = '2020-01-01T00:00:00.000Z';
    const insertTask = db.prepare(
      `INSERT INTO async_tasks (id, type, status, progress, message, resource_id, created_at, updated_at)
       VALUES (?, 'video_generation', 'processing', 0, '', '1', ?, ?)`
    );
    insertTask.run('task-resumable-video', now, now);
    insertTask.run('task-stuck-video', now, now);
    db.prepare(
      `INSERT INTO video_generations (id, task_id, status, provider_task_id, deleted_at)
       VALUES (?, ?, 'processing', ?, NULL)`
    ).run(1, 'task-resumable-video', 'holycrab:remote-task-id');
    db.prepare(
      `INSERT INTO video_generations (id, task_id, status, provider_task_id, deleted_at)
       VALUES (?, ?, 'processing', NULL, NULL)`
    ).run(2, 'task-stuck-video');

    const count = taskService.failOrphanedAsyncTasksOnStartup(db, { warn() {}, info() {} });

    assert.equal(count, 1);
    assert.equal(taskService.getTask(db, 'task-resumable-video').status, 'processing');
    assert.equal(taskService.getTask(db, 'task-resumable-video').error, null);
    assert.equal(taskService.getTask(db, 'task-stuck-video').status, 'failed');
    assert.equal(
      taskService.getTask(db, 'task-stuck-video').error,
      taskService.ORPHAN_ASYNC_TASK_MSG
    );
  });

  it('cancelTask marks active task as failed', () => {
    const db = createTestDb();
    const now = new Date().toISOString();
    db.prepare(
      `INSERT INTO async_tasks (id, type, status, progress, message, resource_id, created_at, updated_at)
       VALUES (?, ?, ?, 0, '', ?, ?, ?)`
    ).run('task-active', 'background_extraction', 'processing', '42', now, now);

    const result = taskService.cancelTask(db, { info() {} }, 'task-active');
    assert.equal(result.ok, true);
    const task = taskService.getTask(db, 'task-active');
    assert.equal(task.status, 'failed');
    assert.equal(task.error, taskService.USER_CANCEL_TASK_MSG);
  });
});

describe('taskService task lifecycle', () => {
  it('clears a transient failure when a late result completes successfully', () => {
    const db = createTestDb();
    const old = '2020-01-01T00:00:00.000Z';
    db.prepare(
      `INSERT INTO async_tasks
        (id, type, status, progress, message, error, resource_id, created_at, updated_at, completed_at)
       VALUES ('task-late-success', 'image_generation', 'failed', 0, 'old message', ?, '1', ?, ?, ?)`
    ).run(taskService.ORPHAN_ASYNC_TASK_MSG, old, old, old);

    taskService.updateTaskResult(db, 'task-late-success', { ok: true });
    const task = taskService.getTask(db, 'task-late-success');

    assert.equal(task.status, 'completed');
    assert.equal(task.progress, 100);
    assert.equal(task.message, '');
    assert.equal(task.error, null);
    assert.deepEqual(JSON.parse(task.result), { ok: true });
  });

  it('repairs completed records that retained an error from an older worker', () => {
    const db = createTestDb();
    const old = '2020-01-01T00:00:00.000Z';
    db.prepare(
      `INSERT INTO async_tasks
        (id, type, status, error, resource_id, created_at, updated_at, completed_at)
       VALUES ('task-already-complete', 'image_generation', 'completed', ?, '1', ?, ?, ?)`
    ).run(taskService.ORPHAN_ASYNC_TASK_MSG, old, old, old);
    db.prepare(
      `INSERT INTO image_generations
        (id, task_id, status, error_msg, completed_at, updated_at)
       VALUES (1, 'task-already-complete', 'completed', ?, ?, ?)`
    ).run(taskService.ORPHAN_ASYNC_TASK_MSG, old, old);

    const repaired = taskService.clearCompletedTaskErrors(db, { info() {} });

    assert.deepEqual(repaired, { tasks: 1, images: 1 });
    assert.equal(taskService.getTask(db, 'task-already-complete').error, null);
    assert.equal(
      db.prepare('SELECT error_msg FROM image_generations WHERE id = 1').get().error_msg,
      null
    );
  });

  it('touches only active tasks', () => {
    const db = createTestDb();
    const old = '2020-01-01T00:00:00.000Z';
    const insert = db.prepare(
      `INSERT INTO async_tasks (id, type, status, resource_id, created_at, updated_at)
       VALUES (?, 'image_generation', ?, '1', ?, ?)`
    );
    insert.run('task-active-touch', 'processing', old, old);
    insert.run('task-done-touch', 'completed', old, old);

    assert.equal(taskService.touchTask(db, 'task-active-touch'), true);
    assert.notEqual(taskService.getTask(db, 'task-active-touch').updated_at, old);
    assert.equal(taskService.touchTask(db, 'task-done-touch'), false);
    assert.equal(taskService.getTask(db, 'task-done-touch').updated_at, old);
  });
});

describe('taskService.getTasksByResources', () => {
  it('loads multiple resource ids in one query and ignores deleted rows', () => {
    const db = createTestDb();
    try {
      const insert = db.prepare(
        `INSERT INTO async_tasks
          (id, type, status, resource_id, created_at, updated_at, deleted_at)
         VALUES (?, 'image_generation', 'processing', ?, ?, ?, ?)`
      );
      insert.run('task-a', 'character_1', '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z', null);
      insert.run('task-b', 'scene_2', '2026-01-02T00:00:00Z', '2026-01-02T00:00:00Z', null);
      insert.run('task-c', 'other', '2026-01-03T00:00:00Z', '2026-01-03T00:00:00Z', null);
      insert.run('task-deleted', 'character_1', '2026-01-04T00:00:00Z', '2026-01-04T00:00:00Z', 'deleted');

      const tasks = taskService.getTasksByResources(db, [
        'character_1',
        'scene_2',
        'character_1',
      ]);

      assert.deepEqual(tasks.map((task) => task.id), ['task-b', 'task-a']);

      db.prepare("UPDATE async_tasks SET status = 'completed' WHERE id = 'task-a'").run();
      const activeTasks = taskService.getTasksByResources(
        db,
        ['character_1', 'scene_2'],
        { activeOnly: true }
      );
      assert.deepEqual(activeTasks.map((task) => task.id), ['task-b']);
    } finally {
      db.close();
    }
  });
});
