const { v4: uuidv4 } = require('uuid');

const ACTIVE_TASK_STATUSES = ['pending', 'processing', 'running'];
const DEFAULT_ORPHAN_STALE_MS = 60 * 1000;
const DEFAULT_HEARTBEAT_INTERVAL_MS = 10 * 1000;
const DEFAULT_REAPER_INTERVAL_MS = 30 * 1000;
const taskHeartbeats = new Map();

function positiveNumber(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function orphanStaleMs() {
  return positiveNumber(process.env.ASYNC_TASK_STALE_MS, DEFAULT_ORPHAN_STALE_MS);
}

function createTask(db, log, taskType, resourceId) {
  const id = uuidv4();
  const now = new Date().toISOString();
  db.prepare(
    `INSERT INTO async_tasks (id, type, status, progress, message, resource_id, created_at, updated_at)
     VALUES (?, ?, 'pending', 0, '', ?, ?, ?)`
  ).run(id, taskType, resourceId || '', now, now);
  log.info('Task created', { task_id: id, type: taskType, resource_id: resourceId });
  startTaskHeartbeat(db, log, id);
  const task = getTask(db, id);
  return task || { id, type: taskType, status: 'pending', progress: 0, message: '', resource_id: resourceId || '', created_at: now, updated_at: now, completed_at: null };
}

function getTask(db, taskId) {
  const row = db.prepare('SELECT * FROM async_tasks WHERE id = ? AND deleted_at IS NULL').get(taskId);
  if (!row) return null;
  return rowToTask(row);
}

function getTasksByResource(db, resourceId) {
  const rows = db.prepare(
    'SELECT * FROM async_tasks WHERE resource_id = ? AND deleted_at IS NULL ORDER BY created_at DESC'
  ).all(resourceId);
  return rows.map(rowToTask);
}

function getTasksByResources(db, resourceIds, options = {}) {
  const ids = [...new Set(
    (Array.isArray(resourceIds) ? resourceIds : [])
      .map((id) => String(id ?? '').trim())
      .filter(Boolean)
  )].slice(0, 500);
  if (!ids.length) return [];

  const placeholders = ids.map(() => '?').join(',');
  const activeClause = options.activeOnly
    ? " AND status IN ('pending', 'processing', 'running')"
    : '';
  const rows = db.prepare(
    `SELECT * FROM async_tasks
     WHERE resource_id IN (${placeholders})
       AND deleted_at IS NULL
       ${activeClause}
     ORDER BY created_at DESC`
  ).all(...ids);
  return rows.map(rowToTask);
}

function updateTaskStatus(db, taskId, status, progress, message) {
  const now = new Date().toISOString();
  let completedAt = null;
  if (status === 'completed' || status === 'failed') completedAt = now;
  const isActive = ACTIVE_TASK_STATUSES.includes(status);
  db.prepare(
    `UPDATE async_tasks
     SET status = ?, progress = ?, message = ?, updated_at = ?, completed_at = ?,
         error = CASE WHEN ? THEN NULL ELSE error END
     WHERE id = ?`
  ).run(status, progress ?? 0, message || '', now, completedAt, isActive ? 1 : 0, taskId);
  if (isActive) startTaskHeartbeat(db, null, taskId);
  else stopTaskHeartbeat(taskId);
}

function updateTaskError(db, taskId, errMsg) {
  const now = new Date().toISOString();
  try {
    db.prepare(
      `UPDATE async_tasks SET status = 'failed', error = ?, progress = 0, completed_at = ?, updated_at = ?
       WHERE id = ?`
    ).run(errMsg || '', now, now, taskId);
    stopTaskHeartbeat(taskId);
  } catch (e) {
    if ((e.message || '').includes('error')) {
      updateTaskStatus(db, taskId, 'failed', 0, errMsg || '任务失败');
    } else throw e;
  }
}

function updateTaskResult(db, taskId, result) {
  const now = new Date().toISOString();
  const resultStr = typeof result === 'string' ? result : JSON.stringify(result || {});
  db.prepare(
    `UPDATE async_tasks
     SET status = 'completed', progress = 100, message = '', error = NULL,
         result = ?, completed_at = ?, updated_at = ?
     WHERE id = ?`
  ).run(resultStr, now, now, taskId);
  stopTaskHeartbeat(taskId);
}

function touchTask(db, taskId) {
  const now = new Date().toISOString();
  return db.prepare(
    `UPDATE async_tasks SET updated_at = ?
     WHERE id = ? AND status IN ('pending', 'processing', 'running')`
  ).run(now, taskId).changes > 0;
}

/**
 * Keep a long-running in-process task fresh so another backend instance does not
 * mistake it for work abandoned by a crashed/restarted process.
 */
function startTaskHeartbeat(db, log, taskId, intervalMs = DEFAULT_HEARTBEAT_INTERVAL_MS) {
  if (!taskId) return () => {};
  const existing = taskHeartbeats.get(taskId);
  if (existing) return () => {};
  const period = positiveNumber(intervalMs, DEFAULT_HEARTBEAT_INTERVAL_MS);
  let stopped = false;
  let timer;
  const stop = () => {
    if (stopped) return;
    stopped = true;
    clearInterval(timer);
    if (taskHeartbeats.get(taskId)?.timer === timer) taskHeartbeats.delete(taskId);
  };
  const beat = () => {
    if (stopped) return;
    try {
      if (!touchTask(db, taskId)) stop();
    } catch (err) {
      // A concurrent SQLite writer can briefly make a heartbeat fail. Keep the
      // timer alive so one transient lock does not turn healthy work into an orphan.
      log?.warn?.('Async task heartbeat failed', { task_id: taskId, error: err.message });
      if (/not open|closed/i.test(String(err.message || ''))) stop();
    }
  };
  timer = setInterval(beat, period);
  timer.unref?.();
  taskHeartbeats.set(taskId, { timer });
  beat();
  return stop;
}

function stopTaskHeartbeat(taskId) {
  const heartbeat = taskHeartbeats.get(taskId);
  if (!heartbeat) return;
  clearInterval(heartbeat.timer);
  taskHeartbeats.delete(taskId);
}

/** Repair records produced by older workers that completed after a false failure. */
function clearCompletedTaskErrors(db, log) {
  const tasks = db.prepare(
    `UPDATE async_tasks SET error = NULL
     WHERE status = 'completed' AND error IS NOT NULL`
  ).run().changes;
  let images = 0;
  try {
    images = db.prepare(
      `UPDATE image_generations SET error_msg = NULL
       WHERE status = 'completed' AND error_msg IS NOT NULL`
    ).run().changes;
  } catch (err) {
    if (!String(err.message || '').includes('no such table')) throw err;
  }
  if (tasks || images) {
    log?.info?.('Cleared stale errors from completed generation records', { tasks, images });
  }
  return { tasks, images };
}

function rowToTask(r) {
  let promptSnapshot = [];
  if (r.prompt_snapshot) {
    try {
      promptSnapshot = JSON.parse(r.prompt_snapshot);
      if (!Array.isArray(promptSnapshot)) promptSnapshot = [];
    } catch (_) {
      promptSnapshot = [];
    }
  }
  return {
    id: r.id,
    type: r.type,
    status: r.status,
    progress: r.progress ?? 0,
    message: r.message,
    error: r.error,
    result: r.result,
    prompt_snapshot: promptSnapshot,
    resource_id: r.resource_id,
    created_at: r.created_at,
    updated_at: r.updated_at,
    completed_at: r.completed_at,
  };
}

const ORPHAN_ASYNC_TASK_MSG = '服务重启后任务中断，请重新操作';
const USER_CANCEL_TASK_MSG = '用户已取消';

/**
 * 用户主动取消进行中的异步任务（无法中断已在执行的 AI 调用，但会停止前端轮询并防止恢复）。
 */
function cancelTask(db, log, taskId, reason) {
  const task = getTask(db, taskId);
  if (!task) return { ok: false, reason: 'not_found' };
  if (task.status === 'completed' || task.status === 'failed') {
    return { ok: true, already_done: true, task };
  }
  const msg = (reason || USER_CANCEL_TASK_MSG).toString().trim() || USER_CANCEL_TASK_MSG;
  updateTaskError(db, taskId, msg);
  log.info('Task cancelled by user', { task_id: taskId, type: task.type });
  return { ok: true, task: getTask(db, taskId) };
}

/**
 * 进程内任务在重启后会丢失。这里只清理超过心跳租期的任务，避免
 * 同一数据库上的另一个存活后端把正在生成的任务误判为孤儿任务。
 */
function failOrphanedAsyncTasksOnStartup(db, log, options = {}) {
  const staleAfterMs = options.staleAfterMs === 0
    ? 0
    : positiveNumber(options.staleAfterMs, orphanStaleMs());
  const staleBefore = new Date(Date.now() - staleAfterMs).toISOString();
  const hasVideoGenerationsTable = !!db.prepare(
    "SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'video_generations'"
  ).get();
  const resumableVideoFilter = hasVideoGenerationsTable
    ? `AND NOT (
         type = 'video_generation'
         AND EXISTS (
           SELECT 1
           FROM video_generations AS vg
           WHERE vg.task_id = async_tasks.id
             AND vg.status = 'processing'
             AND vg.deleted_at IS NULL
             AND vg.provider_task_id IS NOT NULL
             AND TRIM(vg.provider_task_id) != ''
         )
       )`
    : '';
  const rows = db.prepare(
    `SELECT id, type, status, resource_id FROM async_tasks
     WHERE status IN ('pending', 'processing', 'running')
       AND deleted_at IS NULL
       AND (updated_at IS NULL OR updated_at <= ?)
       ${resumableVideoFilter}`
  ).all(staleBefore);
  if (!rows.length) return 0;
  let failedCount = 0;
  for (const row of rows) {
    const now = new Date().toISOString();
    const changed = db.prepare(
      `UPDATE async_tasks
       SET status = 'failed', error = ?, progress = 0, completed_at = ?, updated_at = ?
       WHERE id = ? AND status IN ('pending', 'processing', 'running')`
    ).run(ORPHAN_ASYNC_TASK_MSG, now, now, row.id).changes;
    if (!changed) continue;
    failedCount += 1;
    if (row.type === 'image_generation') {
      try {
        db.prepare(
          `UPDATE image_generations
           SET status = 'failed', error_msg = ?, completed_at = ?, updated_at = ?
           WHERE task_id = ? AND status IN ('pending', 'processing', 'running') AND deleted_at IS NULL`
        ).run(ORPHAN_ASYNC_TASK_MSG, now, now, row.id);
      } catch (err) {
        if (!String(err.message || '').includes('no such table')) throw err;
      }
    }
    log.info('Orphaned async task marked failed', {
      task_id: row.id,
      type: row.type,
      resource_id: row.resource_id,
      previous_status: row.status,
    });
  }
  if (failedCount) {
    log.warn('Failed stale orphaned async tasks', { count: failedCount, stale_after_ms: staleAfterMs });
  }
  return failedCount;
}

/** Periodically reap tasks whose owning process stopped heartbeating. */
function startOrphanedAsyncTaskReaper(db, log, options = {}) {
  const staleAfterMs = positiveNumber(options.staleAfterMs, orphanStaleMs());
  const intervalMs = positiveNumber(options.intervalMs, DEFAULT_REAPER_INTERVAL_MS);
  const sweep = () => {
    try {
      failOrphanedAsyncTasksOnStartup(db, log, { staleAfterMs });
    } catch (err) {
      log?.warn?.('Async task orphan sweep failed', { error: err.message });
    }
  };
  const timer = setInterval(sweep, intervalMs);
  timer.unref?.();
  return () => clearInterval(timer);
}

module.exports = {
  createTask,
  getTask,
  getTasksByResource,
  getTasksByResources,
  updateTaskStatus,
  updateTaskError,
  updateTaskResult,
  touchTask,
  startTaskHeartbeat,
  clearCompletedTaskErrors,
  failOrphanedAsyncTasksOnStartup,
  startOrphanedAsyncTaskReaper,
  cancelTask,
  ORPHAN_ASYNC_TASK_MSG,
  USER_CANCEL_TASK_MSG,
};
