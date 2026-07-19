const http = require('http');
const https = require('https');

const HOLYCRAB_API_BASE = 'https://abgzfc.holycrab.ai';

function normalizeHolyCrabApiKey(apiKey) {
  let value = String(apiKey || '').trim();
  value = value
    .replace(/^(?:HOLYCRAB_API_KEY|HOLYCRAB_KEY|X-User-Token)\s*[:=]\s*/i, '')
    .trim();
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

function holyCrabHeaders(apiKey, extra = {}) {
  return {
    ...extra,
    'X-User-Token': normalizeHolyCrabApiKey(apiKey),
  };
}

function isHolyCrabConfig(config) {
  const provider = String(config?.provider || '').trim().toLowerCase();
  const protocol = String(config?.api_protocol || '').trim().toLowerCase();
  const baseUrl = String(config?.base_url || '').trim().toLowerCase();
  return (
    provider === 'holycrab' ||
    provider === 'holycrab.ai' ||
    protocol === 'holycrab' ||
    /^https:\/\/(?:abgzfc|generate)\.holycrab\.ai(?:\/|$)/i.test(baseUrl)
  );
}

function holyCrabApiBase(baseUrl) {
  const raw = String(baseUrl || '').trim();
  if (!raw) return HOLYCRAB_API_BASE;
  try {
    const url = new URL(raw);
    url.search = '';
    url.hash = '';
    const hostname = url.hostname.toLowerCase();
    if (
      hostname === 'holycrab.ai' ||
      hostname === 'www.holycrab.ai' ||
      hostname === 'generate.holycrab.ai'
    ) {
      url.protocol = 'https:';
      url.hostname = 'abgzfc.holycrab.ai';
      url.port = '';
    }
    url.pathname = url.pathname
      .replace(
        /\/api\/(?:tasks(?:\/generation)?|user-assets(?:\/create-asset-from-url)?)\/?$/i,
        ''
      )
      .replace(/\/api\/?$/i, '')
      .replace(/\/+$/, '');
    return url.toString().replace(/\/$/, '');
  } catch (_) {
    return HOLYCRAB_API_BASE;
  }
}

function joinHolyCrabUrl(baseUrl, endpoint) {
  const path = String(endpoint || '').trim().replace(/^\/+/, '');
  if (!path || path.split('/').some((part) => part === '..')) {
    throw new Error('HolyCrab endpoint 无效');
  }
  return `${holyCrabApiBase(baseUrl)}/${path}`;
}

function holyCrabRequest(url, options = {}) {
  return new Promise((resolve, reject) => {
    let parsed;
    try {
      parsed = new URL(url);
    } catch (_) {
      reject(new Error('HolyCrab 请求地址无效'));
      return;
    }
    if (!['http:', 'https:'].includes(parsed.protocol)) {
      reject(new Error(`HolyCrab 不支持的请求协议: ${parsed.protocol}`));
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
    const transport = parsed.protocol === 'https:' ? https : http;
    const request = transport.request(
      {
        hostname: parsed.hostname,
        port: parsed.port || (parsed.protocol === 'https:' ? 443 : 80),
        path: `${parsed.pathname}${parsed.search}`,
        method,
        headers,
        agent: options.agent === undefined ? false : options.agent,
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
      request.destroy(new Error(`HolyCrab 请求超时 (${timeoutMs}ms)`));
    });
    request.on('error', reject);
    if (bodyBuffer) request.write(bodyBuffer);
    request.end();
  });
}

function parseHolyCrabEnvelope(response, fallback = 'HolyCrab 请求失败') {
  const statusCode = Number(response?.statusCode || response?.status || 0);
  const raw = String(response?.raw || '');
  let parsed = null;
  try {
    parsed = JSON.parse(raw);
  } catch (_) {}

  if (statusCode < 200 || statusCode >= 300) {
    const message =
      parsed?.message ||
      parsed?.error?.message ||
      parsed?.error ||
      raw.slice(0, 500) ||
      fallback;
    throw new Error(`${fallback} (${statusCode}): ${String(message)}`);
  }
  if (!parsed || typeof parsed !== 'object') {
    throw new Error(`${fallback}: 响应不是有效 JSON`);
  }
  const code = Number(parsed.code);
  if (Number.isFinite(code) && code !== 200) {
    throw new Error(`${fallback} (${code}): ${parsed.message || '未知错误'}`);
  }
  return parsed.data;
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

function encodeHolyCrabVideoHandle(handle) {
  const uniqId = String(handle?.uniq_id || handle?.uniqId || '').trim();
  if (!uniqId) throw new Error('HolyCrab 视频任务响应缺少 uniqId');
  return `holycrab:${encodeBase64Url(JSON.stringify({ uniq_id: uniqId }))}`;
}

function decodeHolyCrabVideoHandle(taskId) {
  const raw = String(taskId || '');
  if (!raw.startsWith('holycrab:')) return null;
  try {
    const parsed = JSON.parse(decodeBase64Url(raw.slice(9)));
    if (!parsed?.uniq_id) return null;
    return { uniq_id: String(parsed.uniq_id) };
  } catch (_) {
    return null;
  }
}

module.exports = {
  HOLYCRAB_API_BASE,
  normalizeHolyCrabApiKey,
  holyCrabHeaders,
  isHolyCrabConfig,
  holyCrabApiBase,
  joinHolyCrabUrl,
  holyCrabRequest,
  parseHolyCrabEnvelope,
  encodeHolyCrabVideoHandle,
  decodeHolyCrabVideoHandle,
};
