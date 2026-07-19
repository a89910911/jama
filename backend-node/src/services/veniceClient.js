const http = require('http');
const https = require('https');

const VENICE_API_BASE = 'https://api.venice.ai/api/v1';
const VENICE_HTTP_AGENT = new http.Agent({
  keepAlive: true,
  keepAliveMsecs: 1000,
  maxSockets: 6,
  maxFreeSockets: 2,
});
const VENICE_HTTPS_AGENT = new https.Agent({
  keepAlive: true,
  keepAliveMsecs: 1000,
  maxSockets: 6,
  maxFreeSockets: 2,
});

function normalizeVeniceApiKey(apiKey) {
  let value = String(apiKey || '').trim();
  value = value.replace(/^VENICE_API_KEY\s*=\s*/i, '').trim();
  value = value.replace(/^(?:Bearer|Key)\s+/i, '').trim();
  if (
    value.length >= 2 &&
    ((value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'")))
  ) {
    value = value.slice(1, -1).trim();
  }
  return value;
}

function veniceHeaders(apiKey, extra = {}) {
  return {
    ...extra,
    Authorization: `Bearer ${normalizeVeniceApiKey(apiKey)}`,
  };
}

function isVeniceConfig(config) {
  const provider = String(config?.provider || '').trim().toLowerCase();
  const protocol = String(config?.api_protocol || '').trim().toLowerCase();
  const baseUrl = String(config?.base_url || '').trim().toLowerCase();
  return (
    provider === 'venice' ||
    provider === 'venice.ai' ||
    protocol === 'venice' ||
    /^https:\/\/api\.venice\.ai(?:\/|$)/i.test(baseUrl)
  );
}

function veniceApiBase(baseUrl) {
  const raw = String(baseUrl || '').trim();
  if (!raw) return VENICE_API_BASE;
  try {
    const url = new URL(raw);
    url.search = '';
    url.hash = '';
    url.pathname = url.pathname.replace(/\/+$/, '');
    if (url.hostname.toLowerCase() === 'api.venice.ai') {
      if (!/\/api\/v1$/i.test(url.pathname)) {
        const prefix = url.pathname
          .replace(/\/api(?:\/v1)?$/i, '')
          .replace(/\/+$/, '');
        url.pathname = `${prefix}/api/v1`.replace(/^\/+/, '/');
      }
    }
    return url.toString().replace(/\/$/, '');
  } catch (_) {
    return VENICE_API_BASE;
  }
}

function joinVeniceUrl(baseUrl, endpoint) {
  const path = String(endpoint || '').trim().replace(/^\/+/, '');
  if (!path || path.split('/').some((part) => part === '..')) {
    throw new Error('Venice.ai endpoint 无效');
  }
  return `${veniceApiBase(baseUrl)}/${path}`;
}

function encodeBase64Url(value) {
  return Buffer.from(value, 'utf8')
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '');
}

function decodeBase64Url(value) {
  const normalized = String(value || '').replace(/-/g, '+').replace(/_/g, '/');
  const padding = '='.repeat((4 - (normalized.length % 4 || 4)) % 4);
  return Buffer.from(normalized + padding, 'base64').toString('utf8');
}

function encodeVeniceVideoHandle(handle) {
  const payload = {
    queue_id: String(handle?.queue_id || '').trim(),
    model: String(handle?.model || '').trim(),
    download_url: String(handle?.download_url || '').trim() || undefined,
  };
  if (!payload.queue_id || !payload.model) {
    throw new Error('Venice.ai 视频队列响应缺少 queue_id 或 model');
  }
  return `venice:${encodeBase64Url(JSON.stringify(payload))}`;
}

function decodeVeniceVideoHandle(taskId) {
  const raw = String(taskId || '');
  if (!raw.startsWith('venice:')) return null;
  try {
    const payload = JSON.parse(decodeBase64Url(raw.slice(7)));
    if (!payload?.queue_id || !payload?.model) return null;
    return {
      queue_id: String(payload.queue_id),
      model: String(payload.model),
      download_url: payload.download_url ? String(payload.download_url) : '',
    };
  } catch (_) {
    return null;
  }
}

function getVeniceErrorMessage(data, fallback = 'Venice.ai 请求失败') {
  if (!data) return fallback;
  const candidates = [
    data.error?.message,
    data.error?.code,
    typeof data.error === 'string' ? data.error : '',
    data.message,
    data.detail,
    data.details,
  ];
  const value = candidates.find((item) => item != null && String(item).trim());
  return typeof value === 'object'
    ? JSON.stringify(value).slice(0, 500)
    : String(value || fallback);
}

function isRetryableVeniceConnectError(error) {
  const message = String(error?.message || '');
  const code = String(error?.code || '');
  return (
    /before secure TLS connection was established/i.test(message) ||
    ['EAI_AGAIN', 'ENETUNREACH', 'EHOSTUNREACH'].includes(code)
  );
}

function veniceRequestOnce(url, options = {}) {
  return new Promise((resolve, reject) => {
    let parsed;
    try {
      parsed = new URL(url);
    } catch (_) {
      reject(new Error('Venice.ai 请求地址无效'));
      return;
    }
    if (!['http:', 'https:'].includes(parsed.protocol)) {
      reject(new Error(`Venice.ai 不支持的请求协议: ${parsed.protocol}`));
      return;
    }

    const method = String(options.method || 'GET').toUpperCase();
    const hasBody = options.body != null;
    const bodyBuffer = !hasBody
      ? null
      : Buffer.isBuffer(options.body)
        ? options.body
        : Buffer.from(
            typeof options.body === 'string'
              ? options.body
              : JSON.stringify(options.body),
            'utf8'
          );
    const headers = {
      ...(options.headers || {}),
      ...(bodyBuffer ? { 'Content-Length': bodyBuffer.length } : {}),
    };
    const isHttps = parsed.protocol === 'https:';
    const transport = isHttps ? https : http;
    const request = transport.request(
      {
        hostname: parsed.hostname,
        port: parsed.port || (parsed.protocol === 'https:' ? 443 : 80),
        path: `${parsed.pathname}${parsed.search}`,
        method,
        headers,
        agent: options.agent === undefined
          ? (isHttps ? VENICE_HTTPS_AGENT : VENICE_HTTP_AGENT)
          : options.agent,
      },
      (response) => {
        const chunks = [];
        response.on('data', (chunk) => chunks.push(chunk));
        response.on('end', () => {
          const rawBuffer = Buffer.concat(chunks);
          resolve({
            statusCode: response.statusCode || 0,
            headers: response.headers || {},
            rawBuffer,
            raw: rawBuffer.toString('utf8'),
          });
        });
        response.on('error', reject);
      }
    );
    const timeoutMs = Number(options.timeoutMs) || 120000;
    request.setTimeout(timeoutMs, () => {
      request.destroy(new Error(`Venice.ai 请求超时 (${timeoutMs}ms)`));
    });
    request.on('error', reject);
    if (bodyBuffer) request.write(bodyBuffer);
    request.end();
  });
}

/**
 * Venice 专用 Node http(s) 请求。并发生成时复用少量 keep-alive 连接，减少
 * TLS 握手风暴；只在 TLS 尚未建立、请求确定没有发出时进行安全重连。
 */
async function veniceRequest(url, options = {}) {
  const connectRetries = Math.max(0, Math.min(3, Number(options.connectRetries ?? 2) || 0));
  let lastError;
  for (let attempt = 0; attempt <= connectRetries; attempt++) {
    try {
      return await veniceRequestOnce(url, options);
    } catch (error) {
      lastError = error;
      if (attempt >= connectRetries || !isRetryableVeniceConnectError(error)) throw error;
      await new Promise((resolve) => setTimeout(resolve, 250 * (attempt + 1)));
    }
  }
  throw lastError;
}

module.exports = {
  VENICE_API_BASE,
  normalizeVeniceApiKey,
  veniceHeaders,
  isVeniceConfig,
  veniceApiBase,
  joinVeniceUrl,
  encodeVeniceVideoHandle,
  decodeVeniceVideoHandle,
  getVeniceErrorMessage,
  isRetryableVeniceConnectError,
  veniceRequest,
};
