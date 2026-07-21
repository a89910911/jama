const path = require('path');
const crypto = require('crypto');
const http = require('http');
const https = require('https');
const {
  isHolyCrabConfig,
  holyCrabApiBase,
  joinHolyCrabUrl,
  holyCrabHeaders,
  holyCrabRequest,
  parseHolyCrabEnvelope,
} = require('./holyCrabClient');

const HOLYCRAB_ASSET_ID_RE = /^[A-Za-z0-9]{1,64}$/;

function requireHolyCrabConfig(config) {
  if (!config || !isHolyCrabConfig(config)) {
    throw new Error('请选择有效的 HolyCrab 配置');
  }
  if (!String(config.api_key || '').trim()) {
    throw new Error('HolyCrab 配置缺少 API Key');
  }
  return config;
}

function normalizeAssetId(value) {
  const id = String(value || '').trim();
  if (!HOLYCRAB_ASSET_ID_RE.test(id)) {
    throw new Error('HolyCrab 素材 uniqId 格式无效');
  }
  return id;
}

function clampInteger(value, fallback, min, max) {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, parsed));
}

async function requestAsset(config, endpoint, options, fallback, requestImpl) {
  const cfg = requireHolyCrabConfig(config);
  const response = await requestImpl(joinHolyCrabUrl(cfg.base_url, endpoint), {
    ...options,
    headers: holyCrabHeaders(cfg.api_key, options?.headers || {}),
  });
  return parseHolyCrabEnvelope(response, fallback);
}

async function listAssets(config, params = {}, requestImpl = holyCrabRequest) {
  const page = clampInteger(params.page ?? params.current, 1, 1, 1000000);
  const pageSize = clampInteger(params.page_size ?? params.pageSize, 50, 1, 100);
  const query = new URLSearchParams({ page: String(page), pageSize: String(pageSize) });
  const name = String(params.name || '').trim();
  const status = String(params.status || '').trim();
  if (name) query.set('name', name.slice(0, 200));
  if (status) query.set('status', status.slice(0, 32));

  return requestAsset(
    config,
    `/api/user-assets?${query.toString()}`,
    { method: 'GET' },
    'HolyCrab 素材列表查询失败',
    requestImpl
  );
}

async function getAsset(config, uniqId, requestImpl = holyCrabRequest) {
  const id = normalizeAssetId(uniqId);
  return requestAsset(
    config,
    `/api/user-assets/${encodeURIComponent(id)}`,
    { method: 'GET' },
    'HolyCrab 素材详情查询失败',
    requestImpl
  );
}

async function createAssetFromUrl(config, input = {}, requestImpl = holyCrabRequest) {
  const rawUrl = String(input.url || '').trim();
  let parsed;
  try {
    parsed = new URL(rawUrl);
  } catch (_) {
    throw new Error('请输入有效的素材 URL');
  }
  if (!['http:', 'https:'].includes(parsed.protocol)) {
    throw new Error('素材 URL 仅支持 http 或 https');
  }

  const body = new URLSearchParams({ url: parsed.toString() });
  const name = String(input.name || '').trim();
  if (name) body.set('name', name.slice(0, 200));
  return requestAsset(
    config,
    '/api/user-assets/create-asset-from-url',
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded; charset=utf-8' },
      body: body.toString(),
    },
    'HolyCrab URL 素材创建失败',
    requestImpl
  );
}

async function deleteAsset(config, uniqId, requestImpl = holyCrabRequest) {
  const id = normalizeAssetId(uniqId);
  await requestAsset(
    config,
    '/api/user-assets/delete',
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json; charset=utf-8' },
      body: { uniq_id: id },
    },
    'HolyCrab 素材删除失败',
    requestImpl
  );
  return { uniqId: id, deleted: true };
}

function contentTypeForAsset(asset) {
  const type = String(asset?.assetType || '').toLowerCase();
  if (type === 'image') return 'image/jpeg';
  if (type === 'video') return 'video/mp4';
  if (type === 'audio') return 'audio/mpeg';
  return 'application/octet-stream';
}

function safeAssetFilename(asset, contentUrl) {
  const id = normalizeAssetId(asset?.uniqId || asset?.uniq_id || asset?.id);
  const urlPath = new URL(contentUrl).pathname;
  const urlExtension = path.extname(urlPath).slice(0, 12);
  let name = String(asset?.name || '').trim() || `holycrab-${id}`;
  name = name.replace(/[\u0000-\u001f\u007f<>:"/\\|?*]+/g, '_').trim();
  if (!name) name = `holycrab-${id}`;
  if (!path.extname(name) && urlExtension) name += urlExtension;
  return name.slice(0, 240);
}

function resolveAssetContentDescriptor(config, asset) {
  const cfg = requireHolyCrabConfig(config);
  const rawUrl = String(asset?.url || '').trim();
  if (!rawUrl) throw new Error('HolyCrab 素材暂无可播放或下载的文件');
  let contentUrl;
  try {
    contentUrl = new URL(rawUrl, `${holyCrabApiBase(cfg.base_url)}/`);
  } catch (_) {
    throw new Error('HolyCrab 素材文件地址无效');
  }
  if (!['http:', 'https:'].includes(contentUrl.protocol)) {
    throw new Error('HolyCrab 素材文件地址仅支持 http 或 https');
  }
  const apiUrl = new URL(`${holyCrabApiBase(cfg.base_url)}/`);
  return {
    url: contentUrl.toString(),
    api_origin: apiUrl.origin,
    filename: safeAssetFilename(asset, contentUrl),
    fallback_content_type: contentTypeForAsset(asset),
  };
}

function encodeContentDispositionFilename(filename) {
  const ascii = String(filename).replace(/[^\x20-\x7e]|["\\]/g, '_') || 'asset';
  const encoded = encodeURIComponent(String(filename)).replace(/[!'()*]/g, (char) =>
    `%${char.charCodeAt(0).toString(16).toUpperCase()}`
  );
  return `filename="${ascii}"; filename*=UTF-8''${encoded}`;
}

/**
 * 将 HolyCrab 素材流式代理到当前响应。Range 会原样转发，因此 video/audio
 * 元素可以读取元数据、拖动进度条；仅访问 HolyCrab API 主机时携带用户 Token。
 */
function streamAssetContent(config, asset, req, res, options = {}) {
  const cfg = requireHolyCrabConfig(config);
  const descriptor = resolveAssetContentDescriptor(cfg, asset);
  const download = options.download === true;
  const maxRedirects = 5;

  return new Promise((resolve, reject) => {
    let settled = false;
    let activeRequest = null;
    const finish = (error) => {
      if (settled) return;
      settled = true;
      if (error) reject(error);
      else resolve(descriptor);
    };

    const relay = (rawUrl, redirectCount) => {
      let target;
      try {
        target = new URL(rawUrl);
      } catch (_) {
        finish(new Error('HolyCrab 素材重定向地址无效'));
        return;
      }
      if (!['http:', 'https:'].includes(target.protocol)) {
        finish(new Error('HolyCrab 素材重定向协议不受支持'));
        return;
      }

      const headers = {
        Accept: '*/*',
        'Accept-Encoding': 'identity',
        'User-Agent': 'JamaAI-HolyCrab-Asset-Proxy/1.0',
      };
      const range = String(req?.headers?.range || '').trim();
      if (/^bytes=\d*-\d*(?:,\d*-\d*)*$/i.test(range)) headers.Range = range;
      if (target.origin === descriptor.api_origin) {
        Object.assign(headers, holyCrabHeaders(cfg.api_key));
      }

      const transport = target.protocol === 'https:' ? https : http;
      activeRequest = transport.request(
        target,
        { method: 'GET', headers },
        (upstream) => {
          const status = Number(upstream.statusCode || 0);
          if ([301, 302, 303, 307, 308].includes(status) && upstream.headers.location) {
            upstream.resume();
            if (redirectCount >= maxRedirects) {
              finish(new Error('HolyCrab 素材下载重定向次数过多'));
              return;
            }
            relay(new URL(upstream.headers.location, target).toString(), redirectCount + 1);
            return;
          }
          if ((status < 200 || status >= 300) && status !== 416) {
            const chunks = [];
            let size = 0;
            upstream.on('data', (chunk) => {
              if (size >= 8192) return;
              const remaining = 8192 - size;
              chunks.push(chunk.subarray(0, remaining));
              size += Math.min(chunk.length, remaining);
            });
            upstream.on('end', () => {
              const detail = Buffer.concat(chunks).toString('utf8').slice(0, 500);
              finish(new Error(`HolyCrab 素材文件读取失败 (${status}): ${detail || '无响应内容'}`));
            });
            upstream.on('error', finish);
            return;
          }

          res.status(status);
          for (const header of [
            'content-type',
            'content-length',
            'content-range',
            'accept-ranges',
            'etag',
            'last-modified',
          ]) {
            if (upstream.headers[header] != null) res.setHeader(header, upstream.headers[header]);
          }
          if (!upstream.headers['content-type']) {
            res.setHeader('Content-Type', descriptor.fallback_content_type);
          }
          res.setHeader('Cache-Control', 'private, max-age=300');
          res.setHeader(
            'Content-Disposition',
            `${download ? 'attachment' : 'inline'}; ${encodeContentDispositionFilename(descriptor.filename)}`
          );
          upstream.on('error', (error) => {
            if (!res.destroyed) res.destroy(error);
            finish(error);
          });
          upstream.on('end', () => finish());
          upstream.pipe(res);
        }
      );
      activeRequest.setTimeout(Number(options.timeout_ms) || 600000, () => {
        activeRequest.destroy(new Error('HolyCrab 素材文件读取超时'));
      });
      activeRequest.on('error', finish);
      activeRequest.end();
    };

    res.once('close', () => {
      if (!settled && activeRequest) activeRequest.destroy();
      finish();
    });
    relay(descriptor.url, 0);
  });
}

function extensionFromUpload(file) {
  const fromName = path.extname(String(file?.originalname || '')).replace(/^\./, '');
  if (/^[A-Za-z0-9]{1,10}$/.test(fromName)) return fromName.toLowerCase();
  const mime = String(file?.mimetype || '').toLowerCase();
  const byMime = {
    'image/jpeg': 'jpg',
    'image/png': 'png',
    'image/gif': 'gif',
    'image/webp': 'webp',
    'image/bmp': 'bmp',
    'image/tiff': 'tiff',
    'video/mp4': 'mp4',
    'video/quicktime': 'mov',
    'video/webm': 'webm',
    'audio/mpeg': 'mp3',
    'audio/wav': 'wav',
    'audio/x-wav': 'wav',
    'audio/mp4': 'm4a',
    'audio/ogg': 'ogg',
  };
  return byMime[mime] || '';
}

function buildMultipart(fields) {
  const boundary = `----jama-holycrab-asset-${crypto.randomBytes(12).toString('hex')}`;
  const chunks = [];
  for (const [key, rawValue] of Object.entries(fields)) {
    if (rawValue === undefined || rawValue === null || rawValue === '') continue;
    chunks.push(
      Buffer.from(
        `--${boundary}\r\n` +
          `Content-Disposition: form-data; name="${key}"\r\n\r\n` +
          `${String(rawValue)}\r\n`,
        'utf8'
      )
    );
  }
  chunks.push(Buffer.from(`--${boundary}--\r\n`, 'utf8'));
  return { boundary, body: Buffer.concat(chunks) };
}

function assetTypeFromMime(mimeType) {
  if (mimeType.startsWith('image/')) return 'Image';
  if (mimeType.startsWith('video/')) return 'Video';
  if (mimeType.startsWith('audio/')) return 'Audio';
  return '';
}

async function uploadAsset(config, file, input = {}, requestImpl = holyCrabRequest) {
  requireHolyCrabConfig(config);
  if (!file?.buffer?.length) throw new Error('请选择需要上传的素材文件');
  const extension = extensionFromUpload(file);
  const contentType = String(file.mimetype || '').trim().toLowerCase();
  const assetType = assetTypeFromMime(contentType);
  if (!extension || !contentType || !assetType) {
    throw new Error('无法识别素材文件类型，请选择图片、视频或音频文件');
  }

  const duration = Number(input.duration_seconds);
  const durationSeconds =
    assetType !== 'Image' && Number.isFinite(duration) && duration > 0
      ? Math.round(duration)
      : null;
  const preSignQuery = new URLSearchParams({
    file_extension: extension,
    content_type: contentType,
  });
  if (durationSeconds) preSignQuery.set('duration_seconds', String(durationSeconds));

  const ticket = await requestAsset(
    config,
    `/api/user-assets/pre-signed-download-url?${preSignQuery.toString()}`,
    { method: 'GET' },
    'HolyCrab 获取素材上传地址失败',
    requestImpl
  );
  if (!ticket?.preSignedUrl || !ticket?.objectKey || !ticket?.uniqId) {
    throw new Error('HolyCrab 上传地址响应缺少必要字段');
  }

  const putResponse = await requestImpl(ticket.preSignedUrl, {
    method: 'PUT',
    headers: { 'Content-Type': contentType },
    body: file.buffer,
    timeoutMs: 300000,
  });
  const putStatus = Number(putResponse?.statusCode || putResponse?.status || 0);
  if (putStatus < 200 || putStatus >= 300) {
    throw new Error(
      `HolyCrab 素材文件上传失败 (${putStatus}): ${String(putResponse?.raw || '').slice(0, 300)}`
    );
  }

  const fallbackName = path.basename(String(file.originalname || 'asset'), path.extname(String(file.originalname || '')));
  const name = String(input.name || fallbackName || 'asset').trim().slice(0, 200) || 'asset';
  const multipart = buildMultipart({
    name,
    object_key: ticket.objectKey,
    content_type: contentType,
    duration_seconds: durationSeconds,
  });
  await requestAsset(
    config,
    '/api/user-assets/upload',
    {
      method: 'POST',
      headers: { 'Content-Type': `multipart/form-data; boundary=${multipart.boundary}` },
      body: multipart.body,
    },
    'HolyCrab 素材登记失败',
    requestImpl
  );

  return {
    uniqId: String(ticket.uniqId),
    name,
    assetType,
    status: 'Processing',
  };
}

module.exports = {
  HOLYCRAB_ASSET_ID_RE,
  normalizeAssetId,
  listAssets,
  getAsset,
  createAssetFromUrl,
  deleteAsset,
  contentTypeForAsset,
  safeAssetFilename,
  resolveAssetContentDescriptor,
  encodeContentDispositionFilename,
  streamAssetContent,
  extensionFromUpload,
  buildMultipart,
  uploadAsset,
};
