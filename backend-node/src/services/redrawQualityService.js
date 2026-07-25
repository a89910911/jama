const fs = require('fs');
const path = require('path');

function storageRootFromConfig(cfg) {
  return path.isAbsolute(cfg.storage?.local_path)
    ? cfg.storage.local_path
    : path.join(process.cwd(), cfg.storage?.local_path || './data/storage');
}

function resolveStoragePath(cfg, value) {
  const raw = String(value || '').trim();
  if (!raw) return null;
  if (/^https?:\/\//i.test(raw) && !raw.includes('/static/')) return null;
  if (path.isAbsolute(raw)) return raw;
  let rel = raw;
  if (raw.includes('/static/')) rel = raw.split('/static/')[1] || '';
  rel = rel.replace(/^\/?static\//i, '').replace(/^[/\\]+/, '').split(/[?#]/)[0];
  return path.join(storageRootFromConfig(cfg), rel);
}

function fileInfo(cfg, value) {
  const abs = resolveStoragePath(cfg, value);
  if (!abs) return { exists: /^https?:\/\//i.test(String(value || '')), absolute_path: null };
  try {
    const stat = fs.statSync(abs);
    return { exists: stat.isFile(), absolute_path: abs, bytes: stat.size };
  } catch (_) {
    return { exists: false, absolute_path: abs };
  }
}

function inspectResult(cfg, row) {
  const local = fileInfo(cfg, row.local_path || row.video_url);
  const issues = [];
  if (!row.video_url && !row.local_path) issues.push({ level: 'error', code: 'missing_output_url', message: '结果缺少视频地址' });
  if ((row.local_path || row.video_url) && !local.exists) issues.push({ level: 'error', code: 'output_missing', message: '结果文件不存在' });
  return {
    ok: issues.filter((i) => i.level === 'error').length === 0,
    issues,
    file: local,
    checked_at: new Date().toISOString(),
  };
}

module.exports = {
  storageRootFromConfig,
  resolveStoragePath,
  fileInfo,
  inspectResult,
};
