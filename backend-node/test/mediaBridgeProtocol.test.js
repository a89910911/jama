const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const {
  MEDIABRIDGE_API_BASE,
  LEGACY_PROVIDER_ID,
  normalizeMediaBridgeApiKey,
  mediaBridgeHeaders,
  isMediaBridgeConfig,
  mediaBridgeApiBase,
  joinMediaBridgeUrl,
  encodeMediaBridgeVideoHandle,
  decodeMediaBridgeVideoHandle,
} = require('../src/services/mediaBridgeClient');
const {
  resolveMediaBridgeSeedanceModel,
  normalizeMediaBridgeDuration,
  normalizeMediaBridgeAspectRatio,
  normalizeMediaBridgeResolution,
  resolveMediaBridgeLocalImageSource,
  callMediaBridgeVideoApi,
  pollMediaBridgeVideoOnce,
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

describe('MediaBridge authentication and URL helpers', () => {
  it('normalizes pasted keys and uses X-User-Token', () => {
    assert.equal(normalizeMediaBridgeApiKey('X-User-Token: crab-secret'), 'crab-secret');
    assert.equal(normalizeMediaBridgeApiKey('MEDIABRIDGE_API_KEY="crab-secret"'), 'crab-secret');
    assert.deepEqual(mediaBridgeHeaders('Bearer crab-secret'), {
      'X-User-Token': 'crab-secret',
    });
  });

  it('detects MediaBridge configs and redirects the marketing host to the API host', () => {
    assert.equal(isMediaBridgeConfig({ provider: 'mediabridge' }), true);
    assert.equal(isMediaBridgeConfig({ api_protocol: 'mediabridge' }), true);
    assert.equal(isMediaBridgeConfig({ provider: LEGACY_PROVIDER_ID }), true);
    assert.equal(
      mediaBridgeApiBase(`https://generate.${LEGACY_PROVIDER_ID}.ai/api/tasks/generation`),
      MEDIABRIDGE_API_BASE
    );
    assert.equal(
      joinMediaBridgeUrl(`${MEDIABRIDGE_API_BASE}/`, '/api/tasks/generation'),
      `${MEDIABRIDGE_API_BASE}/api/tasks/generation`
    );
  });

  it('round-trips portable video task handles', () => {
    const encoded = encodeMediaBridgeVideoHandle({ uniq_id: 'task-123' });
    assert.deepEqual(decodeMediaBridgeVideoHandle(encoded), { uniq_id: 'task-123' });
  });
});

describe('MediaBridge Global Ark Seedance adapter', () => {
  it('normalizes supported models and parameters', () => {
    assert.equal(resolveMediaBridgeSeedanceModel('seedance-2.0-fast'), 'seedance-2-0-fast');
    assert.equal(resolveMediaBridgeSeedanceModel('unknown'), 'seedance-2-0');
    assert.equal(normalizeMediaBridgeDuration(2), 4);
    assert.equal(normalizeMediaBridgeDuration(20), 15);
    assert.equal(normalizeMediaBridgeAspectRatio('9:16'), '9:16');
    assert.equal(normalizeMediaBridgeAspectRatio('auto'), '16:9');
    assert.equal(normalizeMediaBridgeResolution('4K', 'seedance-2-0'), '4k');
    assert.equal(normalizeMediaBridgeResolution('1080p', 'seedance-2-0-fast'), '720p');
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

    const result = await callMediaBridgeVideoApi(
      null,
      {
        provider: 'mediabridge',
        api_protocol: 'mediabridge',
        base_url: MEDIABRIDGE_API_BASE,
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
      calls[1].options.headers['Content-Type'],
      /^multipart\/form-data; boundary=/
    );
    assert.match(
      calls[1].options.body.toString('utf8'),
      /name="url"\r\n\r\nhttps:\/\/cdn\.example\.com\/character\.png/
    );
    assert.match(
      calls[1].options.body.toString('utf8'),
      /name="name"\r\n\r\njama-/
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
    assert.deepEqual(decodeMediaBridgeVideoHandle(result.task_id), {
      uniq_id: 'task-1',
    });
  });

  it('uploads local images through the MediaBridge pre-signed flow instead of a public proxy', async () => {
    const onePixelPng =
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl2nWQAAAAASUVORK5CYII=';
    const source = resolveMediaBridgeLocalImageSource(
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

    const result = await callMediaBridgeVideoApi(
      null,
      {
        provider: 'mediabridge',
        api_protocol: 'mediabridge',
        base_url: MEDIABRIDGE_API_BASE,
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
    assert.equal(decodeMediaBridgeVideoHandle(result.task_id).uniq_id, 'task-local');
  });

  it('resolves /static paths inside storage on Windows instead of the drive root', () => {
    const storageRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'jama-mediabridge-'));
    const relativePath = path.join('projects', 'demo', 'images', 'frame.png');
    const absolutePath = path.join(storageRoot, relativePath);
    fs.mkdirSync(path.dirname(absolutePath), { recursive: true });
    fs.writeFileSync(absolutePath, Buffer.from('image-bytes'));

    try {
      const source = resolveMediaBridgeLocalImageSource(
        '/static/projects/demo/images/frame.png',
        storageRoot
      );
      assert.ok(source);
      assert.equal(source.localPath, absolutePath);
      assert.equal(source.mimeType, 'image/png');
      assert.equal(source.buffer.toString('utf8'), 'image-bytes');
    } finally {
      fs.rmSync(storageRoot, { recursive: true, force: true });
    }
  });

  it('polls the task endpoint and returns the completed video URL', async () => {
    const result = await pollMediaBridgeVideoOnce(
      {
        base_url: MEDIABRIDGE_API_BASE,
        api_key: 'crab-secret',
      },
      { uniq_id: 'task-1' },
      async (url, options) => {
        assert.equal(String(url), `${MEDIABRIDGE_API_BASE}/api/tasks/task-1`);
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

describe('MediaBridge connection test', () => {
  it('validates the key with a read-only task list request', async () => {
    let captured = null;
    await aiConfigService.testConnection({
      base_url: `https://generate.${LEGACY_PROVIDER_ID}.ai`,
      api_key: 'crab-secret',
      provider: 'mediabridge',
      api_protocol: 'mediabridge',
      service_type: 'video',
      model: 'seedance-2-0',
      request_impl: async (url, options) => {
        captured = { url: String(url), options };
        return response({ records: [] });
      },
    });
    assert.equal(
      captured.url,
      `${MEDIABRIDGE_API_BASE}/api/tasks?page=1&pageSize=1`
    );
    assert.equal(captured.options.headers['X-User-Token'], 'crab-secret');
    assert.equal(captured.options.method, 'GET');
  });
});
