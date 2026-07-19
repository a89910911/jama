const FAL_DIRECT_BASE = 'https://fal.run';
const FAL_QUEUE_BASE = 'https://queue.fal.run';
const FAL_PLATFORM_BASE = 'https://api.fal.ai';

function normalizeFalApiKey(apiKey) {
  return String(apiKey || '')
    .trim()
    .replace(/^(?:Key|Bearer)\s+/i, '')
    .trim();
}

function falAuthorizationValue(apiKey) {
  return `Key ${normalizeFalApiKey(apiKey)}`;
}

function falHeaders(apiKey, extra = {}) {
  return {
    ...extra,
    Authorization: falAuthorizationValue(apiKey),
  };
}

function isFalConfig(config) {
  const provider = String(config?.provider || '').trim().toLowerCase();
  const protocol = String(config?.api_protocol || '').trim().toLowerCase();
  const baseUrl = String(config?.base_url || '').trim().toLowerCase();
  return (
    provider === 'fal' ||
    provider === 'fal.ai' ||
    protocol === 'fal' ||
    /^https:\/\/(?:queue\.)?fal\.run(?:\/|$)/i.test(baseUrl) ||
    /^https:\/\/api\.fal\.ai(?:\/|$)/i.test(baseUrl)
  );
}

function normalizeFalEndpoint(endpoint) {
  let value = String(endpoint || '').trim();
  if (!value) throw new Error('fal.ai 模型 endpoint 不能为空');
  if (/^https?:\/\//i.test(value)) {
    const url = new URL(value);
    value = url.pathname;
  }
  value = value
    .replace(/^\/+/, '')
    .replace(/\/+$/, '')
    .replace(/\/{2,}/g, '/');
  if (!value || value.split('/').some((part) => part === '..')) {
    throw new Error('fal.ai 模型 endpoint 无效');
  }
  return value;
}

function normalizeFalBase(baseUrl, queue) {
  const fallback = queue ? FAL_QUEUE_BASE : FAL_DIRECT_BASE;
  const raw = String(baseUrl || '').trim();
  if (!raw) return fallback;
  try {
    const url = new URL(raw);
    if (url.hostname === 'fal.run' || url.hostname === 'queue.fal.run') {
      url.hostname = queue ? 'queue.fal.run' : 'fal.run';
    }
    url.pathname = url.pathname.replace(/\/+$/, '');
    url.search = '';
    url.hash = '';
    return url.toString().replace(/\/$/, '');
  } catch (_) {
    return fallback;
  }
}

function falDirectBase(baseUrl) {
  return normalizeFalBase(baseUrl, false);
}

function falQueueBase(baseUrl) {
  return normalizeFalBase(baseUrl, true);
}

function joinFalUrl(baseUrl, endpoint) {
  return `${String(baseUrl || '').replace(/\/+$/, '')}/${normalizeFalEndpoint(endpoint)}`;
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

function encodeFalQueueHandle(handle) {
  const payload = {
    request_id: String(handle?.request_id || '').trim(),
    endpoint: normalizeFalEndpoint(handle?.endpoint),
    status_url: String(handle?.status_url || '').trim() || undefined,
    response_url: String(handle?.response_url || '').trim() || undefined,
  };
  if (!payload.request_id) throw new Error('fal.ai 队列响应缺少 request_id');
  return `fal:${encodeBase64Url(JSON.stringify(payload))}`;
}

function decodeFalQueueHandle(taskId) {
  const raw = String(taskId || '');
  if (!raw.startsWith('fal:')) return null;
  try {
    const parsed = JSON.parse(decodeBase64Url(raw.slice(4)));
    if (!parsed?.request_id || !parsed?.endpoint) return null;
    return {
      request_id: String(parsed.request_id),
      endpoint: normalizeFalEndpoint(parsed.endpoint),
      status_url: parsed.status_url ? String(parsed.status_url) : '',
      response_url: parsed.response_url ? String(parsed.response_url) : '',
    };
  } catch (_) {
    return null;
  }
}

function falQueueRequestRoot(baseUrl, handle) {
  return joinFalUrl(
    falQueueBase(baseUrl),
    `${handle.endpoint}/requests/${encodeURIComponent(handle.request_id)}`
  );
}

function falQueueStatusUrl(baseUrl, handle) {
  if (handle.status_url) return handle.status_url;
  return `${falQueueRequestRoot(baseUrl, handle)}/status?logs=1`;
}

function falQueueResultUrl(baseUrl, handle) {
  return handle.response_url || falQueueRequestRoot(baseUrl, handle);
}

function getFalErrorMessage(data, fallback = 'fal.ai 请求失败') {
  if (!data) return fallback;
  const detail = data.detail;
  if (typeof detail === 'string' && detail.trim()) return detail.trim();
  if (Array.isArray(detail) && detail.length) {
    return detail
      .map((item) => item?.msg || item?.message || String(item || ''))
      .filter(Boolean)
      .join('; ');
  }
  const candidates = [
    data.error?.message,
    typeof data.error === 'string' ? data.error : '',
    data.message,
    data.reason,
  ];
  return String(candidates.find((item) => item != null && String(item).trim()) || fallback);
}

module.exports = {
  FAL_DIRECT_BASE,
  FAL_QUEUE_BASE,
  FAL_PLATFORM_BASE,
  normalizeFalApiKey,
  falAuthorizationValue,
  falHeaders,
  isFalConfig,
  normalizeFalEndpoint,
  falDirectBase,
  falQueueBase,
  joinFalUrl,
  encodeFalQueueHandle,
  decodeFalQueueHandle,
  falQueueRequestRoot,
  falQueueStatusUrl,
  falQueueResultUrl,
  getFalErrorMessage,
};
