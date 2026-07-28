'use strict';

const crypto = require('node:crypto');

const UNSIGNABLE_HEADERS = new Set([
  'authorization',
  'content-type',
  'content-length',
  'user-agent',
  'presigned-expires',
  'expect',
]);

const ALGORITHM = 'HMAC-SHA256';
const V4_IDENTIFIER = 'request';
const DATE_HEADER = 'X-Date';
const TOKEN_HEADER = 'X-Security-Token';
const CONTENT_SHA256_HEADER = 'X-Content-Sha256';

function uriEscape(value) {
  return encodeURIComponent(String(value))
    .replace(/[^A-Za-z0-9_.~\-%]+/g, escape)
    .replace(/[*]/g, (character) =>
      `%${character.charCodeAt(0).toString(16).toUpperCase()}`
    );
}

function queryParamsToString(params = {}) {
  return Object.keys(params)
    .sort()
    .map((key) => {
      const value = params[key];
      if (value === undefined || value === null) return null;
      const escapedKey = uriEscape(key);
      if (Array.isArray(value)) {
        return `${escapedKey}=${value.map(uriEscape).sort().join(`&${escapedKey}=`)}`;
      }
      return `${escapedKey}=${uriEscape(value)}`;
    })
    .filter(Boolean)
    .join('&');
}

function sha256(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function hmac(key, value, encoding) {
  return crypto.createHmac('sha256', key).update(value).digest(encoding);
}

/**
 * Minimal Volcengine Signature V4 implementation for the ModelArk asset API.
 *
 * The application previously imported the complete @volcengine/openapi SDK only
 * for this signer. Keeping the small, native-crypto implementation here removes
 * the SDK's vulnerable axios/protobufjs dependency tree and makes the exact
 * signing surface auditable.
 */
class VolcSigner {
  constructor(request, serviceName) {
    this.request = request;
    this.request.headers = request.headers || {};
    this.request.params = Object.fromEntries(
      Object.entries(request.params || {})
        .filter(([, value]) => value !== undefined && value !== null)
        .sort(([left], [right]) => left.localeCompare(right))
    );
    this.serviceName = serviceName;
  }

  addAuthorization(credentials, date) {
    const datetime = this.getDateTime(date);
    this.request.headers[DATE_HEADER] = datetime;
    if (credentials.sessionToken) {
      this.request.headers[TOKEN_HEADER] = credentials.sessionToken;
    }
    if (this.request.body) {
      const body = typeof this.request.body === 'string'
        ? this.request.body
        : JSON.stringify(this.request.body);
      this.request.headers[CONTENT_SHA256_HEADER] = sha256(body);
    }

    const scope = this.credentialString(datetime);
    this.request.headers.Authorization = [
      `${ALGORITHM} Credential=${credentials.accessKeyId}/${scope}`,
      `SignedHeaders=${this.signedHeaders()}`,
      `Signature=${this.signature(credentials, datetime)}`,
    ].join(', ');
  }

  getDateTime(date) {
    const value = date === undefined ? new Date() : date;
    return value.toISOString().replace(/[:\-]|\.\d{3}/g, '');
  }

  credentialString(datetime) {
    return [
      datetime.slice(0, 8),
      this.request.region,
      this.serviceName,
      V4_IDENTIFIER,
    ].join('/');
  }

  isSignableHeader(name) {
    return !UNSIGNABLE_HEADERS.has(name.toLowerCase());
  }

  canonicalHeaders() {
    return Object.entries(this.request.headers)
      .map(([name, value]) => [name.toLowerCase(), value])
      .filter(([name]) => this.isSignableHeader(name))
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([name, value]) => {
        if (value === undefined || value === null || typeof value.toString !== 'function') {
          throw new Error(`Header ${name} contains invalid value`);
        }
        return `${name}:${value.toString().replace(/\s+/g, ' ').trim()}`;
      })
      .join('\n');
  }

  signedHeaders() {
    return Object.keys(this.request.headers)
      .map((name) => name.toLowerCase())
      .filter((name) => this.isSignableHeader(name))
      .sort()
      .join(';');
  }

  canonicalString() {
    const bodyHash = this.request.headers[CONTENT_SHA256_HEADER]
      || sha256(this.request.body ? queryParamsToString(this.request.body) : '');
    return [
      String(this.request.method || 'GET').toUpperCase(),
      this.request.pathname || '/',
      queryParamsToString(this.request.params),
      `${this.canonicalHeaders()}\n`,
      this.signedHeaders(),
      bodyHash,
    ].join('\n');
  }

  signingKey(credentials, date) {
    const dateKey = hmac(credentials.secretKey, date);
    const regionKey = hmac(dateKey, this.request.region);
    const serviceKey = hmac(regionKey, this.serviceName);
    return hmac(serviceKey, V4_IDENTIFIER);
  }

  signature(credentials, datetime) {
    const scope = this.credentialString(datetime);
    const stringToSign = [
      ALGORITHM,
      datetime,
      scope,
      sha256(this.canonicalString()),
    ].join('\n');
    return hmac(
      this.signingKey(credentials, datetime.slice(0, 8)),
      stringToSign,
      'hex'
    );
  }
}

module.exports = {
  VolcSigner,
  queryParamsToString,
};
