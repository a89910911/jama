const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const {
  normalizeHolyCrabApiKey,
  holyCrabHeaders,
  isHolyCrabConfig,
  holyCrabApiBase,
  joinHolyCrabUrl,
  encodeHolyCrabVideoHandle,
  decodeHolyCrabVideoHandle,
} = require('../src/services/holyCrabClient');
const {
  resolveHolyCrabSeedanceModel,
  normalizeHolyCrabDuration,
  normalizeHolyCrabAspectRatio,
  normalizeHolyCrabResolution,
  resolveHolyCrabLocalImageSource,
  callHolyCrabVideoApi,
  pollHolyCrabVideoOnce,
} = require('../src/services/videoClient');
const aiConfigService = require('../src/services/aiConfigService');

const silentLog = {
  info() {},
  warn() {},
  error() {},
};

function response(data, code = 200, message = 'success') {
  return {
    statusCode: 200,
    raw: JSON.stringify({ code, data, message }),
    headers: { 'content-type': 'application/json' },
  };
}

describe('HolyCrab authentication and URL helpers', () => {
  it('normalizes pasted keys and uses X-User-Token', () => {
    assert.equal(normalizeHolyCrabApiKey('X-User-Token: crab-secret'), 'crab-secret');
    assert.equal(normalizeHolyCrabApiKey('HOLYCRAB_API_KEY="crab-secret"'), 'crab-secret');
    assert.deepEqual(holyCrabHeaders('Bearer crab-secret'), {
      'X-User-Token': 'crab-secret',
    });
  });

  it('detects HolyCrab configs and redirects the marketing host to the API host', () => {
    assert.equal(isHolyCrabConfig({ provider: 'holycrab' }), true);
    assert.equal(isHolyCrabConfig({ api_protocol: 'holycrab' }), true);
    assert.equal(
      holyCrabApiBase('https://generate.holycrab.ai/api/tasks/generation'),
      'https://abgzfc.holycrab.ai'
    );
    assert.equal(
      joinHolyCrabUrl('https://abgzfc.holycrab.ai/', '/api/tasks/generation'),
      'https://abgzfc.holycrab.ai/api/tasks/generation'
    );
  });

  it('round-trips portable video task handles', () => {
    const encoded = encodeHolyCrabVideoHandle({ uniq_id: 'task-123' });
    assert.deepEqual(decodeHolyCrabVideoHandle(encoded), { uniq_id: 'task-123' });
  });
});

describe('HolyCrab BytePlus Seedance adapter', () => {
  it('normalizes supported models and parameters', () => {
    assert.equal(resolveHolyCrabSeedanceModel('seedance-2.0-fast'), 'seedance-2-0-fast');
    assert.equal(resolveHolyCrabSeedanceModel('unknown'), 'seedance-2-0');
    assert.equal(normalizeHolyCrabDuration(2), 4);
    assert.equal(normalizeHolyCrabDuration(20), 15);
    assert.equal(normalizeHolyCrabAspectRatio('9:16'), '9:16');
    assert.equal(normalizeHolyCrabAspectRatio('auto'), '16:9');
    assert.equal(normalizeHolyCrabResolution('4K', 'seedance-2-0'), '4k');
    assert.equal(normalizeHolyCrabResolution('1080p', 'seedance-2-0-fast'), '720p');
  });

  it('registers public reference images before submitting a generation task', async () => {
    const calls = [];
    const requestImpl = async (url, options) => {
      calls.push({ url: String(url), options });
      if (String(url).includes('/api/user-assets?')) {
        return response({ records: [] });
      }
      if (String(url).endsWith('/api/user-assets/create-asset-from-url')) {
        return response({ uniqId: 'asset-1', status: 'Success' });
      }
      if (String(url).endsWith('/api/tasks/generation')) {
        return response({ uniqId: 'task-1', step: 0 });
      }
      throw new Error(`unexpected URL: ${url}`);
    };

    const result = await callHolyCrabVideoApi(
      null,
      {
        provider: 'holycrab',
        api_protocol: 'holycrab',
        base_url: 'https://abgzfc.holycrab.ai',
        api_key: 'crab-secret',
        settings: JSON.stringify({ generate_audio: false }),
      },
      silentLog,
      {
        prompt: '@图片1 奔跑',
        model: 'seedance-2-0-fast',
        duration: 8,
        aspect_ratio: '9:16',
        resolution: '1080p',
        reference_urls: ['https://cdn.example.com/character.png'],
        video_gen_id: 1,
        request_impl: requestImpl,
        asset_poll_interval_ms: 0,
      }
    );

    assert.equal(calls.length, 3);
    assert.equal(calls[0].options.headers['X-User-Token'], 'crab-secret');
    assert.match(
      calls[1].options.body,
      /^url=https%3A%2F%2Fcdn\.example\.com%2Fcharacter\.png&name=jama-/
    );
    assert.deepEqual(calls[2].options.body, {
      prompt: '@Image1 奔跑',
      duration: 8,
      ratio: '9:16',
      resolution: '720p',
      model: 'seedance-2-0-fast',
      generate_audio: true,
      imageAssetIds: ['asset-1'],
    });
    assert.deepEqual(decodeHolyCrabVideoHandle(result.task_id), {
      uniq_id: 'task-1',
    });
  });

  it('uploads local images through the HolyCrab pre-signed flow instead of a public proxy', async () => {
    const onePixelPng =
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl2nWQAAAAASUVORK5CYII=';
    const source = resolveHolyCrabLocalImageSource(
      `data:image/png;base64,${onePixelPng}`,
      ''
    );
    assert.equal(source.mimeType, 'image/png');
    assert.equal(source.extension, 'png');

    const calls = [];
    const requestImpl = async (url, options) => {
      calls.push({ url: String(url), options });
      if (String(url).includes('/api/user-assets?')) {
        return response({ records: [] });
      }
      if (String(url).includes('/api/user-assets/pre-signed-download-url?')) {
        return response({
          preSignedUrl: 'https://object.example.com/upload-ticket',
          objectKey: '1/asset-local.png',
          uniqId: 'assetlocal123',
        });
      }
      if (String(url) === 'https://object.example.com/upload-ticket') {
        return { statusCode: 200, raw: '', headers: {} };
      }
      if (String(url).endsWith('/api/user-assets/upload')) {
        return response(null);
      }
      if (String(url).endsWith('/api/user-assets/assetlocal123')) {
        return response({ uniqId: 'assetlocal123', status: 'Success' });
      }
      if (String(url).endsWith('/api/tasks/generation')) {
        return response({ uniqId: 'task-local', step: 0 });
      }
      throw new Error(`unexpected URL: ${url}`);
    };

    const result = await callHolyCrabVideoApi(
      null,
      {
        provider: 'holycrab',
        api_protocol: 'holycrab',
        base_url: 'https://abgzfc.holycrab.ai',
        api_key: 'crab-secret',
      },
      silentLog,
      {
        prompt: '@Image1 微笑',
        model: 'seedance-2-0',
        duration: 5,
        aspect_ratio: '16:9',
        resolution: '480p',
        reference_urls: [`data:image/png;base64,${onePixelPng}`],
        video_gen_id: 2,
        request_impl: requestImpl,
        asset_poll_interval_ms: 0,
      }
    );

    const putCall = calls.find((item) => item.options.method === 'PUT');
    assert.ok(Buffer.isBuffer(putCall.options.body));
    assert.equal(putCall.options.headers['Content-Type'], 'image/png');
    const recordCall = calls.find((item) =>
      item.url.endsWith('/api/user-assets/upload')
    );
    assert.match(recordCall.options.headers['Content-Type'], /^multipart\/form-data; boundary=/);
    assert.match(recordCall.options.body.toString('utf8'), /name="object_key"\r\n\r\n1\/asset-local\.png/);
    assert.equal(
      calls.some((item) => item.url.endsWith('/create-asset-from-url')),
      false
    );
    const generationCall = calls.find((item) =>
      item.url.endsWith('/api/tasks/generation')
    );
    assert.deepEqual(generationCall.options.body.imageAssetIds, ['assetlocal123']);
    assert.equal(generationCall.options.body.generate_audio, true);
    assert.equal(decodeHolyCrabVideoHandle(result.task_id).uniq_id, 'task-local');
  });

  it('polls the task endpoint and returns the completed video URL', async () => {
    const result = await pollHolyCrabVideoOnce(
      {
        base_url: 'https://abgzfc.holycrab.ai',
        api_key: 'crab-secret',
      },
      { uniq_id: 'task-1' },
      async (url, options) => {
        assert.equal(String(url), 'https://abgzfc.holycrab.ai/api/tasks/task-1');
        assert.equal(options.headers['X-User-Token'], 'crab-secret');
        return response({
          uniqId: 'task-1',
          step: 2,
          videoUrl: 'https://cdn.example.com/result.mp4',
        });
      }
    );
    assert.equal(result.video_url, 'https://cdn.example.com/result.mp4');
    assert.equal(result.status, 'COMPLETED');
  });
});

describe('HolyCrab connection test', () => {
  it('validates the key with a read-only task list request', async () => {
    let captured = null;
    await aiConfigService.testConnection({
      base_url: 'https://generate.holycrab.ai',
      api_key: 'crab-secret',
      provider: 'holycrab',
      api_protocol: 'holycrab',
      service_type: 'video',
      model: 'seedance-2-0',
      request_impl: async (url, options) => {
        captured = { url: String(url), options };
        return response({ records: [] });
      },
    });
    assert.equal(
      captured.url,
      'https://abgzfc.holycrab.ai/api/tasks?page=1&pageSize=1'
    );
    assert.equal(captured.options.headers['X-User-Token'], 'crab-secret');
    assert.equal(captured.options.method, 'GET');
  });
});
