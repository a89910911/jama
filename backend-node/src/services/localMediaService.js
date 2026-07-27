const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const DATA_URL_HEADER_RE = /^data:([^;,]*)(?:;[^;,=]+=[^;,]*)*;base64,/i;
const EMBEDDED_DATA_URL_RE =
  /data:([^;,\s]*)(?:;[^;,\s=]+=[^;,\s]*)*;base64,([A-Za-z0-9+/_-]+={0,2})/gi;

const MIME_EXTENSIONS = new Map([
  ['image/png', 'png'],
  ['image/jpeg', 'jpg'],
  ['image/jpg', 'jpg'],
  ['image/webp', 'webp'],
  ['image/gif', 'gif'],
  ['image/avif', 'avif'],
  ['image/bmp', 'bmp'],
  ['image/svg+xml', 'svg'],
  ['video/mp4', 'mp4'],
  ['video/webm', 'webm'],
  ['video/quicktime', 'mov'],
  ['audio/mpeg', 'mp3'],
  ['audio/mp3', 'mp3'],
  ['audio/wav', 'wav'],
  ['audio/x-wav', 'wav'],
  ['audio/ogg', 'ogg'],
  ['audio/mp4', 'm4a'],
  ['application/pdf', 'pdf'],
  ['application/octet-stream', 'bin'],
]);

function isDataUrl(value) {
  return typeof value === 'string' && DATA_URL_HEADER_RE.test(value.trim());
}

function containsDataUrl(value) {
  if (typeof value === 'string') {
    return /data:[^;,\s]*(?:;[^;,\s=]+=[^;,\s]*)*;base64,/i.test(value);
  }
  if (Array.isArray(value)) return value.some(containsDataUrl);
  if (value && typeof value === 'object') {
    return Object.values(value).some(containsDataUrl);
  }
  return false;
}

function parseDataUrl(value) {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  const header = trimmed.match(DATA_URL_HEADER_RE);
  if (!header) return null;
  const mimeType = String(header[1] || 'application/octet-stream').toLowerCase();
  let encoded = trimmed.slice(header[0].length).replace(/\s/g, '');
  encoded = encoded.replace(/-/g, '+').replace(/_/g, '/');
  if (!encoded || !/^[A-Za-z0-9+/]*={0,2}$/.test(encoded)) {
    throw new Error('Invalid Base64 data URL payload');
  }
  while (encoded.length % 4 !== 0) encoded += '=';
  const buffer = Buffer.from(encoded, 'base64');
  if (!buffer.length) throw new Error('Base64 data URL decoded to an empty file');
  return { mimeType, buffer };
}

function sanitizeRelativePath(value) {
  const normalized = String(value || '')
    .trim()
    .replace(/\\/g, '/')
    .replace(/^\/+/, '');
  if (!normalized) return '';
  const parts = normalized.split('/').filter(Boolean);
  if (parts.some((part) => part === '.' || part === '..')) {
    throw new Error('Local media path must stay inside the storage directory');
  }
  return parts.join('/');
}

function sanitizeSegment(value, fallback) {
  const clean = String(value || '')
    .trim()
    .replace(/\\/g, '/')
    .split('/')
    .filter((part) => part && part !== '.' && part !== '..')
    .map((part) => part.replace(/[<>:"|?*\u0000-\u001f]/g, '_'))
    .filter(Boolean)
    .join('/');
  return clean || fallback;
}

function resolveStorageRoot(storagePath) {
  const configured = String(storagePath || './data/storage');
  return path.isAbsolute(configured)
    ? path.normalize(configured)
    : path.resolve(process.cwd(), configured);
}

function localUrl(localPath) {
  return `/static/${sanitizeRelativePath(localPath)}`;
}

function extensionForMime(mimeType) {
  const exact = MIME_EXTENSIONS.get(String(mimeType || '').toLowerCase());
  if (exact) return exact;
  const subtype = String(mimeType || '').split('/')[1] || '';
  const safe = subtype.split('+')[0].replace(/[^a-z0-9]/gi, '').toLowerCase();
  return safe || 'bin';
}

function mediaCategoryForMime(mimeType) {
  const type = String(mimeType || '').toLowerCase();
  if (type.startsWith('image/')) return 'images';
  if (type.startsWith('video/')) return 'videos';
  if (type.startsWith('audio/')) return 'audio';
  return 'files';
}

function localPathFromValue(storageRoot, value, baseUrl) {
  if (typeof value !== 'string' || !value.trim()) return null;
  const raw = value.trim().replace(/\\/g, '/');
  let relative = null;
  if (raw.startsWith('/static/')) {
    relative = raw.slice('/static/'.length).split(/[?#]/)[0];
  } else if (/^https?:\/\//i.test(raw)) {
    try {
      const parsed = new URL(raw);
      const marker = '/static/';
      const markerIndex = parsed.pathname.indexOf(marker);
      if (markerIndex >= 0) relative = parsed.pathname.slice(markerIndex + marker.length);
      if (!relative && baseUrl && raw.startsWith(String(baseUrl).replace(/\/$/, '') + '/')) {
        relative = raw.slice(String(baseUrl).replace(/\/$/, '').length + 1).split(/[?#]/)[0];
      }
    } catch (_) {
      return null;
    }
  } else if (!raw.startsWith('data:')) {
    relative = raw;
  }
  if (!relative) return null;
  let decoded = relative;
  try {
    decoded = decodeURIComponent(relative);
  } catch (_) {}
  const localPath = sanitizeRelativePath(decoded);
  if (!localPath) return null;
  const absolutePath = path.resolve(storageRoot, ...localPath.split('/'));
  const root = path.resolve(storageRoot);
  if (absolutePath !== root && !absolutePath.startsWith(root + path.sep)) return null;
  return { localPath, absolutePath };
}

function existingLocalMedia(storageRoot, value, baseUrl) {
  const resolved = localPathFromValue(storageRoot, value, baseUrl);
  if (!resolved) return null;
  try {
    const stat = fs.statSync(resolved.absolutePath);
    if (!stat.isFile() || stat.size <= 0) return null;
    return {
      url: localUrl(resolved.localPath),
      local_path: resolved.localPath,
      absolute_path: resolved.absolutePath,
      bytes: stat.size,
      reused: true,
    };
  } catch (_) {
    return null;
  }
}

function persistDataUrlToLocal(dataUrl, options = {}) {
  const parsed = parseDataUrl(dataUrl);
  if (!parsed) return null;
  const storageRoot = resolveStorageRoot(options.storagePath);
  const projectSubdir = sanitizeSegment(options.projectSubdir, '');
  const category = sanitizeSegment(
    options.category,
    `base64/${mediaCategoryForMime(parsed.mimeType)}`
  );
  const relativeDir = [projectSubdir, category].filter(Boolean).join('/');
  const absoluteDir = path.resolve(storageRoot, ...relativeDir.split('/'));
  if (absoluteDir !== storageRoot && !absoluteDir.startsWith(storageRoot + path.sep)) {
    throw new Error('Base64 media destination must stay inside the storage directory');
  }
  fs.mkdirSync(absoluteDir, { recursive: true });

  const digest = crypto.createHash('sha256').update(parsed.buffer).digest('hex');
  const prefix = String(options.prefix || 'base64')
    .replace(/[^a-z0-9_-]/gi, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 40) || 'base64';
  const filename = `${prefix}_${digest.slice(0, 24)}.${extensionForMime(parsed.mimeType)}`;
  const absolutePath = path.join(absoluteDir, filename);
  if (!fs.existsSync(absolutePath)) {
    const temporaryPath = `${absolutePath}.${process.pid}.${Date.now()}.tmp`;
    try {
      fs.writeFileSync(temporaryPath, parsed.buffer, { flag: 'wx' });
      try {
        fs.renameSync(temporaryPath, absolutePath);
      } catch (error) {
        if (!fs.existsSync(absolutePath)) throw error;
        fs.unlinkSync(temporaryPath);
      }
    } finally {
      try {
        if (fs.existsSync(temporaryPath)) fs.unlinkSync(temporaryPath);
      } catch (_) {}
    }
  }
  const relativePath = sanitizeRelativePath(
    path.relative(storageRoot, absolutePath).replace(/\\/g, '/')
  );
  options.log?.info?.('Base64 media saved to local storage', {
    mime_type: parsed.mimeType,
    local_path: relativePath,
    bytes: parsed.buffer.length,
  });
  return {
    url: localUrl(relativePath),
    local_path: relativePath,
    absolute_path: absolutePath,
    mime_type: parsed.mimeType,
    bytes: parsed.buffer.length,
    digest,
    reused: fs.statSync(absolutePath).size === parsed.buffer.length,
  };
}

function knownLocalPathForObject(object, key, storageRoot, baseUrl) {
  const keyCandidates = [];
  if (/_image_url$/i.test(key)) {
    keyCandidates.push(key.replace(/_image_url$/i, '_local_path'));
  }
  if (/ImageUrl$/.test(key)) {
    keyCandidates.push(key.replace(/ImageUrl$/, 'LocalPath'));
  }
  if (['image_url', 'video_url', 'audio_url', 'url'].includes(key)) {
    keyCandidates.push('local_path');
  }
  if (['imageUrl', 'videoUrl', 'audioUrl', 'url'].includes(key)) {
    keyCandidates.push('localPath');
  }
  for (const candidate of keyCandidates) {
    if (!object[candidate]) continue;
    const existing = existingLocalMedia(storageRoot, object[candidate], baseUrl);
    if (existing) return existing;
  }
  return null;
}

function normalizeDataUrlsForPersistence(input, options = {}) {
  const storageRoot = resolveStorageRoot(options.storagePath);
  const files = [];
  let replacements = 0;
  const seen = new WeakSet();

  const save = (dataUrl, key) => {
    const saved = persistDataUrlToLocal(dataUrl, {
      ...options,
      storagePath: storageRoot,
      category: options.category,
      prefix: options.prefix || String(key || 'base64'),
    });
    files.push(saved);
    replacements += 1;
    return saved;
  };

  const visitString = (value, key, owner) => {
    if (isDataUrl(value)) {
      const existing = owner
        ? knownLocalPathForObject(owner, key, storageRoot, options.baseUrl)
        : null;
      const media = existing || save(value, key);
      replacements += existing ? 1 : 0;
      return { value: media.url, media };
    }

    if (!containsDataUrl(value)) return { value, media: null };
    try {
      const parsed = JSON.parse(value);
      const normalized = visit(parsed);
      return { value: JSON.stringify(normalized), media: null };
    } catch (_) {}

    const normalized = value.replace(
      EMBEDDED_DATA_URL_RE,
      (match) => save(match, key).url
    );
    return { value: normalized, media: null };
  };

  const visit = (value) => {
    if (typeof value === 'string') return visitString(value, '', null).value;
    if (!value || typeof value !== 'object') return value;
    if (seen.has(value)) throw new Error('Cannot normalize a cyclic value for persistence');
    seen.add(value);
    if (Array.isArray(value)) {
      const normalized = value.map(visit);
      seen.delete(value);
      return normalized;
    }

    const normalized = { ...value };
    let onlyMedia = null;
    let mediaCount = 0;
    for (const [key, item] of Object.entries(value)) {
      if (typeof item === 'string') {
        const result = visitString(item, key, value);
        normalized[key] = result.value;
        if (result.media) {
          mediaCount += 1;
          onlyMedia = result.media;
        }
      } else {
        normalized[key] = visit(item);
      }
    }
    if (
      mediaCount === 1 &&
      onlyMedia &&
      !normalized.local_path &&
      !normalized.localPath
    ) {
      normalized.local_path = onlyMedia.local_path;
    }
    seen.delete(value);
    return normalized;
  };

  const value = visit(input);
  if (containsDataUrl(value)) {
    throw new Error('Base64 data URL normalization left an unprocessed value');
  }
  return { value, files: files.filter(Boolean), replacements };
}

function assertNoDataUrls(values, context = 'database write') {
  const list = Array.isArray(values) ? values : [values];
  if (list.some(containsDataUrl)) {
    const error = new Error(
      `Base64 data URLs must be saved to local storage before ${context}`
    );
    error.code = 'BASE64_PERSISTENCE_BLOCKED';
    throw error;
  }
}

module.exports = {
  assertNoDataUrls,
  containsDataUrl,
  existingLocalMedia,
  isDataUrl,
  localPathFromValue,
  localUrl,
  normalizeDataUrlsForPersistence,
  parseDataUrl,
  persistDataUrlToLocal,
  resolveStorageRoot,
  sanitizeRelativePath,
};
