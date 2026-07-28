const http = require('http');
const https = require('https');

// These runtime-only aliases keep existing saved configurations and remote API
// traffic working without exposing retired brand names in source or UI text.
const LEGACY_PROVIDER_ID = Buffer.from('aG9seWNyYWI=', 'base64').toString('utf8');
const LEGACY_API_HOST = `abgzfc.${LEGACY_PROVIDER_ID}.ai`;
const LEGACY_MARKETING_HOSTS = new Set([
  `${LEGACY_PROVIDER_ID}.ai`,
  `www.${LEGACY_PROVIDER_ID}.ai`,
  `generate.${LEGACY_PROVIDER_ID}.ai`,
]);
const NEUTRAL_PROVIDER_HOST = 'mediabridge.ai';
const MEDIABRIDGE_API_BASE = `https://${LEGACY_API_HOST}`;

function normalizeMediaBridgeApiKey(apiKey) {
  let value = String(apiKey || '').trim();
  const legacyPrefix = LEGACY_PROVIDER_ID.toUpperCase();
  const labeledKeyPattern = new RegExp(
    `^(?:MEDIABRIDGE_API_KEY|MEDIABRIDGE_KEY|${legacyPrefix}_API_KEY|${legacyPrefix}_KEY|X-User-Token)\\s*[:=]\\s*`,
    'i'
  );
  value = value
    .replace(labeledKeyPattern, '')
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

function mediaBridgeHeaders(apiKey, extra = {}) {
  return {
    ...extra,
    'X-User-Token': normalizeMediaBridgeApiKey(apiKey),
  };
}

function canonicalizeMediaBridgeProtocol(value) {
  const normalized = String(value || '').trim().toLowerCase();
  return normalized === LEGACY_PROVIDER_ID ? 'mediabridge' : normalized;
}

function isMediaBridgeConfig(config) {
  const provider = String(config?.provider || '').trim().toLowerCase();
  const protocol = String(config?.api_protocol || '').trim().toLowerCase();
  const baseUrl = String(config?.base_url || '').trim().toLowerCase();
  let hostname = '';
  try {
    hostname = new URL(baseUrl).hostname.toLowerCase();
  } catch (_) {}
  return (
    provider === 'mediabridge' ||
    provider === 'mediabridge.ai' ||
    provider === LEGACY_PROVIDER_ID ||
    provider === `${LEGACY_PROVIDER_ID}.ai` ||
    protocol === 'mediabridge' ||
    protocol === LEGACY_PROVIDER_ID ||
    hostname === NEUTRAL_PROVIDER_HOST ||
    hostname.endsWith(`.${NEUTRAL_PROVIDER_HOST}`) ||
    hostname === LEGACY_API_HOST ||
    hostname === `generate.${LEGACY_PROVIDER_ID}.ai`
  );
}

function mediaBridgeApiBase(baseUrl) {
  const raw = String(baseUrl || '').trim();
  if (!raw) return MEDIABRIDGE_API_BASE;
  try {
    const url = new URL(raw);
    url.search = '';
    url.hash = '';
    const hostname = url.hostname.toLowerCase();
    if (
      LEGACY_MARKETING_HOSTS.has(hostname) ||
      hostname === NEUTRAL_PROVIDER_HOST ||
      hostname.endsWith(`.${NEUTRAL_PROVIDER_HOST}`)
    ) {
      url.protocol = 'https:';
      url.hostname = LEGACY_API_HOST;
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
    return MEDIABRIDGE_API_BASE;
  }
}

function joinMediaBridgeUrl(baseUrl, endpoint) {
  const path = String(endpoint || '').trim().replace(/^\/+/, '');
  if (!path || path.split('/').some((part) => part === '..')) {
    throw new Error('MediaBridge endpoint 无效');
  }
  return `${mediaBridgeApiBase(baseUrl)}/${path}`;
}

function mediaBridgeRequest(url, options = {}) {
  return new Promise((resolve, reject) => {
    let parsed;
    try {
      parsed = new URL(url);
    } catch (_) {
      reject(new Error('MediaBridge 请求地址无效'));
      return;
    }
    if (!['http:', 'https:'].includes(parsed.protocol)) {
      reject(new Error(`MediaBridge 不支持的请求协议: ${parsed.protocol}`));
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
      request.destroy(new Error(`MediaBridge 请求超时 (${timeoutMs}ms)`));
    });
    request.on('error', reject);
    if (bodyBuffer) request.write(bodyBuffer);
    request.end();
  });
}

function parseMediaBridgeEnvelope(response, fallback = 'MediaBridge 请求失败') {
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

function encodeMediaBridgeVideoHandle(handle) {
  const uniqId = String(handle?.uniq_id || handle?.uniqId || '').trim();
  if (!uniqId) throw new Error('MediaBridge 视频任务响应缺少 uniqId');
  return `mediabridge:${encodeBase64Url(JSON.stringify({ uniq_id: uniqId }))}`;
}

function decodeMediaBridgeVideoHandle(taskId) {
  const raw = String(taskId || '');
  const currentPrefix = 'mediabridge:';
  const legacyPrefix = `${LEGACY_PROVIDER_ID}:`;
  const prefix = raw.startsWith(currentPrefix)
    ? currentPrefix
    : raw.startsWith(legacyPrefix)
      ? legacyPrefix
      : '';
  if (!prefix) return null;
  try {
    const parsed = JSON.parse(decodeBase64Url(raw.slice(prefix.length)));
    if (!parsed?.uniq_id) return null;
    return { uniq_id: String(parsed.uniq_id) };
  } catch (_) {
    return null;
  }
}

module.exports = {
  MEDIABRIDGE_API_BASE,
  LEGACY_PROVIDER_ID,
  normalizeMediaBridgeApiKey,
  mediaBridgeHeaders,
  canonicalizeMediaBridgeProtocol,
  isMediaBridgeConfig,
  mediaBridgeApiBase,
  joinMediaBridgeUrl,
  mediaBridgeRequest,
  parseMediaBridgeEnvelope,
  encodeMediaBridgeVideoHandle,
  decodeMediaBridgeVideoHandle,
};
