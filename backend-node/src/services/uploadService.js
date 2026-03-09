// 与 Go UploadService 对齐：保存到 local_path，返回 url / local_path
const fs = require('fs');
const path = require('path');
const { randomUUID } = require('crypto');

function ensureDir(dir) {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}

function uploadFile(storagePath, baseUrl, log, fileBuffer, originalName, mimeType, category) {
  const categoryPath = path.join(storagePath, category);
  ensureDir(categoryPath);
  const ext = path.extname(originalName) || '.png';
  const timestamp = new Date().toISOString().replace(/[-:]/g, '').slice(0, 15);
  const name = `${timestamp}_${randomUUID()}${ext}`;
  const filePath = path.join(categoryPath, name);
  fs.writeFileSync(filePath, fileBuffer);
  const relativePath = `${category}/${name}`;
  const url = baseUrl ? `${baseUrl.replace(/\/$/, '')}/${relativePath}` : `/static/${relativePath}`;
  log.info('File uploaded', { path: filePath, url });
  return { url, local_path: relativePath };
}

/**
 * 将远程/Base64 图片保存到本地 storage，避免 AI 链接过期后无法访问
 * @param {string} storagePath - 存储根目录（如 ./data/storage）
 * @param {string} imageUrl - 图片地址（http(s) URL 或 data:image/xxx;base64,...）
 * @param {string} category - 子目录：characters / scenes / images
 * @param {object} log - logger
 * @param {string} [prefix] - 文件名前缀，如 ig_123
 * @returns {Promise<string|null>} 相对路径如 characters/xxx.png，失败返回 null
 */
async function downloadImageToLocal(storagePath, imageUrl, category, log, prefix = '') {
  if (!imageUrl || typeof imageUrl !== 'string') return null;
  const categoryPath = path.join(storagePath, category);
  try {
    ensureDir(categoryPath);
    let buffer;
    let ext = 'png';
    if (imageUrl.startsWith('data:')) {
      const match = imageUrl.match(/^data:image\/(\w+);base64,(.+)$/);
      if (!match) {
        log.warn('downloadImageToLocal: invalid data URL');
        return null;
      }
      buffer = Buffer.from(match[2], 'base64');
      ext = match[1] === 'jpeg' ? 'jpg' : match[1];
    } else {
      const res = await fetch(imageUrl, { method: 'GET' });
      if (!res.ok) {
        log.warn('downloadImageToLocal: fetch failed', { status: res.status });
        return null;
      }
      const contentType = res.headers.get('content-type') || '';
      ext = contentType.includes('png') ? 'png' : contentType.includes('webp') ? 'webp' : 'jpg';
      buffer = Buffer.from(await res.arrayBuffer());
    }
    const name = `${prefix}${prefix ? '_' : ''}${randomUUID().slice(0, 8)}.${ext}`;
    const filePath = path.join(categoryPath, name);
    fs.writeFileSync(filePath, buffer);
    const relativePath = `${category}/${name}`;
    log.info('Image saved to local', { category, local_path: relativePath });
    return relativePath;
  } catch (e) {
    log.warn('downloadImageToLocal error', { category, error: e.message });
    return null;
  }
}

/**
 * 将图片 Buffer 上传到中转图床，返回公开访问 URL。
 * 接口：POST https://imageproxy.zhongzhuan.chat/api/upload  (multipart/form-data, field: file)
 * 响应：{ url: "https://imageproxy.zhongzhuan.chat/api/proxy/image/<hash>", created: ... }
 * 失败自动重试，最多 3 次；成功返回 string URL，全部失败返回 null。
 */
async function uploadToImageProxy(imageBuffer, mimeType, log, tag) {
  const UPLOAD_URL = 'https://imageproxy.zhongzhuan.chat/api/upload';
  const extMap = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/gif': 'gif' };
  const ext = extMap[mimeType] || 'jpg';
  const filename = `ref_${Date.now()}.${ext}`;
  const MAX_ATTEMPTS = 3;
  log.info('[图床上传] ▶ 开始', { tag, filename, size_kb: Math.round(imageBuffer.length / 1024) });
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    const t0 = Date.now();
    try {
      const boundary = 'imgproxy_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8);
      const headerLine = `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${filename}"\r\nContent-Type: ${mimeType}\r\n\r\n`;
      const footerLine = `\r\n--${boundary}--\r\n`;
      const body = Buffer.concat([Buffer.from(headerLine, 'utf-8'), imageBuffer, Buffer.from(footerLine, 'utf-8')]);
      const res = await fetch(UPLOAD_URL, {
        method: 'POST',
        headers: { 'Content-Type': `multipart/form-data; boundary=${boundary}` },
        body,
      });
      const raw = await res.text();
      const ms = Date.now() - t0;
      if (!res.ok) {
        log.warn('[图床上传] 失败', { tag, attempt, status: res.status, ms, body: raw.slice(0, 200) });
        if (attempt < MAX_ATTEMPTS) continue;
        return null;
      }
      const data = JSON.parse(raw);
      const url = data?.url || null;
      if (url) { log.info('[图床上传] ✓ 成功', { tag, attempt, url, ms }); return url; }
      log.warn('[图床上传] 响应无 url 字段', { tag, attempt, ms, raw: raw.slice(0, 200) });
      if (attempt < MAX_ATTEMPTS) continue;
      return null;
    } catch (err) {
      log.warn('[图床上传] 请求异常', { tag, attempt, ms: Date.now() - t0, err: err.message });
      if (attempt < MAX_ATTEMPTS) continue;
      return null;
    }
  }
  return null;
}

/**
 * 将本地文件路径或 localhost URL 的图片上传到图床，返回公网 URL。
 * - localPath: 相对 storagePath 的路径，如 "images/ig_xxx.jpg"
 * - localhostUrl: 类似 "http://localhost:5679/static/images/ig_xxx.jpg" 的 URL
 * 两者传其中一个即可；失败返回 null。
 */
async function uploadLocalImageToProxy(storagePath, localPathOrUrl, log, tag) {
  try {
    let filePath = null;
    let mimeType = 'image/jpeg';
    if (localPathOrUrl && localPathOrUrl.startsWith('http')) {
      // localhost URL → 提取 /static/ 后的相对路径
      const afterStatic = localPathOrUrl.split('/static/')[1];
      if (afterStatic && storagePath) {
        filePath = path.join(storagePath, afterStatic.replace(/^\//, ''));
      }
    } else if (localPathOrUrl && storagePath) {
      filePath = path.isAbsolute(localPathOrUrl)
        ? localPathOrUrl
        : path.join(storagePath, localPathOrUrl.replace(/^\//, ''));
    }
    if (!filePath || !fs.existsSync(filePath)) {
      log.warn('[图床上传] 本地文件不存在', { tag, filePath });
      return null;
    }
    const ext = path.extname(filePath).toLowerCase();
    const mimeMap = { '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp' };
    mimeType = mimeMap[ext] || 'image/jpeg';
    const buf = fs.readFileSync(filePath);
    return await uploadToImageProxy(buf, mimeType, log, tag);
  } catch (e) {
    log.warn('[图床上传] uploadLocalImageToProxy 异常', { tag, err: e.message });
    return null;
  }
}

module.exports = {
  uploadFile,
  downloadImageToLocal,
  uploadToImageProxy,
  uploadLocalImageToProxy,
};
