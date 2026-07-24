const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');

const {
  normalizeVeniceApiKey,
  veniceHeaders,
  isVeniceConfig,
  veniceApiBase,
  joinVeniceUrl,
  encodeVeniceVideoHandle,
  decodeVeniceVideoHandle,
  isRetryableVeniceConnectError,
} = require('../src/services/veniceClient');
const { buildChatAuthHeaders } = require('../src/services/aiClient');
const {
  normalizeVeniceImageResolution,
  normalizeVeniceImageOutput,
  resolveVeniceImageModel,
  isSupportedVeniceImageBuffer,
  normalizeVeniceImageInput,
  sanitizeVeniceImageGenerateBody,
  callVeniceImageApi,
  getStoryboardReferenceLimits,
} = require('../src/services/imageClient');
const {
  normalizeVeniceSeedanceDuration,
  normalizeVeniceSeedanceResolution,
  normalizeVeniceSeedanceAspectRatio,
  resolveVeniceSeedanceModel,
  callVeniceVideoApi,
  pollVeniceVideoOnce,
  pollVideoTask,
} = require('../src/services/videoClient');
const aiConfigService = require('../src/services/aiConfigService');

const silentLog = {
  info() {},
  warn() {},
  error() {},
};

describe('Venice.ai authentication and URL helpers', () => {
  it('normalizes pasted key formats and emits Bearer authentication', () => {
    assert.equal(normalizeVeniceApiKey(' Bearer secret-key '), 'secret-key');
    assert.equal(normalizeVeniceApiKey('VENICE_API_KEY="secret-key"'), 'secret-key');
    assert.deepEqual(veniceHeaders('Key secret-key'), {
      Authorization: 'Bearer secret-key',
    });
    assert.deepEqual(
      buildChatAuthHeaders({ provider: 'venice', api_key: 'secret-key' }),
      { Authorization: 'Bearer secret-key' }
    );
  });

  it('detects Venice configs and normalizes the API base', () => {
    assert.equal(isVeniceConfig({ provider: 'venice' }), true);
    assert.equal(isVeniceConfig({ api_protocol: 'venice' }), true);
    assert.equal(isVeniceConfig({ base_url: 'https://api.venice.ai/api/v1' }), true);
    assert.equal(isVeniceConfig({ provider: 'openai' }), false);
    assert.equal(veniceApiBase('https://api.venice.ai'), 'https://api.venice.ai/api/v1');
    assert.equal(
      joinVeniceUrl('https://api.venice.ai/api/v1/', '/video/queue'),
      'https://api.venice.ai/api/v1/video/queue'
    );
  });

  it('round-trips portable Venice video handles', () => {
    const taskId = encodeVeniceVideoHandle({
      queue_id: 'queue-123',
      model: 'seedance-2-0-text-to-video',
      download_url: 'https://cdn.example.com/video.mp4',
    });
    assert.deepEqual(decodeVeniceVideoHandle(taskId), {
      queue_id: 'queue-123',
      model: 'seedance-2-0-text-to-video',
      download_url: 'https://cdn.example.com/video.mp4',
    });
  });

  it('only retries connection failures that happened before a request was sent', () => {
    assert.equal(
      isRetryableVeniceConnectError(
        new Error('Client network socket disconnected before secure TLS connection was established')
      ),
      true
    );
    assert.equal(isRetryableVeniceConnectError({ code: 'EAI_AGAIN' }), true);
    assert.equal(isRetryableVeniceConnectError({ code: 'ECONNRESET' }), false);
  });
});

describe('Venice.ai GPT Image 2 adapter', () => {
  const onePixelPng = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Wl2nWQAAAAASUVORK5CYII=';

  it('maps image sizing, model names, and storyboard reference limits', () => {
    assert.equal(normalizeVeniceImageResolution('1024x1024'), '1K');
    assert.equal(normalizeVeniceImageResolution('1440x2560'), '2K');
    assert.equal(normalizeVeniceImageResolution('4096x2160'), '4K');
    assert.equal(resolveVeniceImageModel('gpt-image-2', true), 'gpt-image-2-edit');
    assert.equal(isSupportedVeniceImageBuffer(Buffer.from(onePixelPng, 'base64')), true);
    assert.equal(
      normalizeVeniceImageInput(`data:image/png;base64,${onePixelPng}`, '', ''),
      onePixelPng
    );
    assert.equal(
      normalizeVeniceImageOutput('YWJj'),
      'data:image/png;base64,YWJj'
    );
    assert.deepEqual(
      getStoryboardReferenceLimits(
        { provider: 'venice', api_protocol: 'venice' },
        'gpt-image-2'
      ),
      { total: 3, maxCharacters: 3, maxObjects: 3 }
    );
    assert.deepEqual(
      sanitizeVeniceImageGenerateBody({
        prompt: '道具',
        variants: 1,
        return_binary: true,
      }),
      {
        prompt: '道具',
        return_binary: true,
      }
    );
  });

  it('reads /static and localhost reference paths from the storage root', () => {
    const storageRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'jama-venice-ref-'));
    const imageDir = path.join(storageRoot, 'media', 'images');
    const imagePath = path.join(imageDir, 'tailframe.png');
    fs.mkdirSync(imageDir, { recursive: true });
    fs.writeFileSync(imagePath, Buffer.from(onePixelPng, 'base64'));
    try {
      assert.equal(
        normalizeVeniceImageInput(
          '/static/media/images/tailframe.png',
          'http://localhost:5679/static',
          storageRoot
        ),
        onePixelPng
      );
      assert.equal(
        normalizeVeniceImageInput(
          'http://localhost:3013/static/media/images/tailframe.png',
          'http://localhost:5679/static',
          storageRoot
        ),
        onePixelPng
      );
    } finally {
      fs.unlinkSync(imagePath);
      fs.rmdirSync(imageDir);
      fs.rmdirSync(path.join(storageRoot, 'media'));
      fs.rmdirSync(storageRoot);
    }
  });

  it('generates an image through the native Venice endpoint', async () => {
    let captured = null;
    const requestImpl = async (url, headers, body, timeoutMs) => {
      captured = { url: String(url), headers, body, timeoutMs };
      return {
        statusCode: 200,
        raw: 'abc',
        rawBuffer: Buffer.from('abc'),
        headers: { 'content-type': 'image/png' },
      };
    };
    const result = await callVeniceImageApi(
      {
        provider: 'venice',
        base_url: 'https://api.venice.ai/api/v1',
        api_key: 'venice-secret',
      },
      silentLog,
      {
        prompt: '测试图片',
        model: 'gpt-image-2',
        size: '2560x1440',
        image_gen_id: 1,
        request_impl: requestImpl,
      }
    );
    assert.equal(captured.url, 'https://api.venice.ai/api/v1/image/generate');
    assert.equal(captured.headers.Authorization, 'Bearer venice-secret');
    assert.deepEqual(captured.body, {
      model: 'gpt-image-2',
      prompt: '测试图片',
      aspect_ratio: '16:9',
      resolution: '2K',
      quality: 'high',
      format: 'png',
      return_binary: true,
    });
    assert.equal(Object.hasOwn(captured.body, 'variants'), false);
    assert.equal(result.image_url, 'data:image/png;base64,YWJj');
  });

  it('uses GPT Image 2 multi-edit for multiple references and reads binary output', async () => {
    let captured = null;
    const requestImpl = async (url, headers, body) => {
      captured = { url: String(url), headers, body };
      return {
        statusCode: 200,
        raw: Buffer.from([1, 2, 3]).toString('utf8'),
        rawBuffer: Buffer.from([1, 2, 3]),
        headers: { 'content-type': 'image/png' },
      };
    };
    const result = await callVeniceImageApi(
      {
        provider: 'venice',
        base_url: 'https://api.venice.ai/api/v1',
        api_key: 'venice-secret',
      },
      silentLog,
      {
        prompt: '合成分镜',
        model: 'gpt-image-2',
        size: '16:9',
        reference_image_urls: [
          'https://cdn.example.com/a.png',
          'https://cdn.example.com/b.png',
        ],
        image_gen_id: 2,
        request_impl: requestImpl,
      }
    );
    assert.equal(captured.url, 'https://api.venice.ai/api/v1/image/multi-edit');
    assert.equal(captured.body.modelId, 'gpt-image-2-edit');
    assert.equal(captured.body.images.length, 2);
    assert.equal(result.image_url, 'data:image/png;base64,AQID');
  });

  it('uses multi-edit without unsupported quality for a single reference', async () => {
    let captured = null;
    const requestImpl = async (url, headers, body) => {
      captured = { url: String(url), headers, body };
      return {
        statusCode: 200,
        raw: 'png',
        rawBuffer: Buffer.from('png'),
        headers: { 'content-type': 'image/png' },
      };
    };
    const result = await callVeniceImageApi(
      {
        provider: 'venice',
        base_url: 'https://api.venice.ai/api/v1',
        api_key: 'venice-secret',
      },
      silentLog,
      {
        prompt: 'single reference storyboard',
        model: 'gpt-image-2',
        quality: 'high',
        size: '1024x1792',
        reference_image_urls: [`data:image/png;base64,${onePixelPng}`],
        image_gen_id: 3,
        request_impl: requestImpl,
      }
    );

    assert.equal(captured.url, 'https://api.venice.ai/api/v1/image/multi-edit');
    assert.equal(captured.body.modelId, 'gpt-image-2-edit');
    assert.deepEqual(captured.body.images, [onePixelPng]);
    assert.equal(Object.hasOwn(captured.body, 'image'), false);
    assert.equal(Object.hasOwn(captured.body, 'quality'), false);
    assert.equal(result.image_url, 'data:image/png;base64,cG5n');
  });
});

describe('Venice.ai Seedance 2.0 adapter', () => {
  it('normalizes model modes and video parameters', () => {
    assert.equal(normalizeVeniceSeedanceDuration(2), '4s');
    assert.equal(normalizeVeniceSeedanceDuration('20s'), '15s');
    assert.equal(normalizeVeniceSeedanceResolution('1080P'), '1080p');
    assert.equal(
      normalizeVeniceSeedanceResolution('1080P', 'seedance-2-0-fast-text-to-video'),
      '720p'
    );
    assert.equal(normalizeVeniceSeedanceAspectRatio('9:16'), '9:16');
    assert.equal(normalizeVeniceSeedanceAspectRatio('auto'), '16:9');
    assert.equal(
      resolveVeniceSeedanceModel('seedance-2-0-text-to-video', 'reference-to-video'),
      'seedance-2-0-reference-to-video'
    );
  });

  it('submits Seedance to the Venice queue with the official model id', async () => {
    let captured = null;
    const requestImpl = async (url, options) => {
      captured = { url: String(url), options };
      return {
        statusCode: 200,
        raw: JSON.stringify({
          model: 'seedance-2-0-text-to-video',
          queue_id: 'queue-123',
        }),
        headers: { 'content-type': 'application/json' },
      };
    };
    const result = await callVeniceVideoApi(
      {
        provider: 'venice',
        api_protocol: 'venice',
        base_url: 'https://api.venice.ai/api/v1',
        api_key: 'venice-secret',
        settings: JSON.stringify({ generate_audio: false, audio: false }),
      },
      silentLog,
      {
        prompt: '测试视频',
        model: 'seedance-2-0',
        duration: 8,
        aspect_ratio: '16:9',
        resolution: '1080p',
        video_gen_id: 1,
        request_impl: requestImpl,
      }
    );
    assert.equal(captured.url, 'https://api.venice.ai/api/v1/video/queue');
    assert.equal(captured.options.headers.Authorization, 'Bearer venice-secret');
    assert.deepEqual(captured.options.body, {
      model: 'seedance-2-0-text-to-video',
      prompt: '测试视频',
      duration: '8s',
      resolution: '1080p',
      aspect_ratio: '16:9',
      audio: true,
    });
    assert.equal(decodeVeniceVideoHandle(result.task_id).queue_id, 'queue-123');
  });

  it('retrieves inline MP4 output and preserves the binary result', async () => {
    const result = await pollVeniceVideoOnce(
      {
        base_url: 'https://api.venice.ai/api/v1',
        api_key: 'venice-secret',
      },
      {
        model: 'seedance-2-0-text-to-video',
        queue_id: 'queue-123',
        download_url: '',
      },
      async (url, options) => {
        assert.equal(String(url), 'https://api.venice.ai/api/v1/video/retrieve');
        assert.equal(options.method, 'POST');
        assert.equal(options.headers.Authorization, 'Bearer venice-secret');
        return {
          statusCode: 200,
          rawBuffer: Buffer.from([4, 5, 6]),
          raw: Buffer.from([4, 5, 6]).toString('utf8'),
          headers: { 'content-type': 'video/mp4' },
        };
      }
    );
    assert.deepEqual(result.video_buffer, Buffer.from([4, 5, 6]));
    assert.equal(result.status, 'COMPLETED');
  });

  it('routes a Venice task handle through the shared video poller', async () => {
    const taskId = encodeVeniceVideoHandle({
      queue_id: 'queue-123',
      model: 'seedance-2-0-text-to-video',
      download_url: 'https://cdn.example.com/video.mp4',
    });
    const result = await pollVideoTask(
      null,
      silentLog,
      1,
      taskId,
      {
        provider: 'venice',
        api_protocol: 'venice',
        base_url: 'https://api.venice.ai/api/v1',
        api_key: 'venice-secret',
        request_impl: async () => ({
          statusCode: 200,
          raw: JSON.stringify({ status: 'COMPLETED' }),
          headers: { 'content-type': 'application/json' },
        }),
      },
      1,
      0
    );
    assert.equal(result.video_url, 'https://cdn.example.com/video.mp4');
  });
});

describe('Venice.ai connection test', () => {
  it('syncs only online, compatible text models from the account catalog', async () => {
    let captured = null;
    const result = await aiConfigService.listAvailableModels({
      base_url: 'https://api.venice.ai/api/v1',
      api_key: 'venice-secret',
      provider: 'venice',
      service_type: 'text',
      request_impl: async (url, options) => {
        captured = { url: String(url), options };
        return {
          statusCode: 200,
          raw: JSON.stringify({
            data: [
              {
                id: 'deepseek-v4-pro',
                type: 'text',
                model_spec: {
                  name: 'DeepSeek V4 Pro',
                  capabilities: { supportsResponseSchema: true },
                  traits: ['reasoning'],
                },
              },
              {
                id: 'no-json-model',
                type: 'text',
                model_spec: { capabilities: { supportsResponseSchema: false } },
              },
              {
                id: 'offline-model',
                type: 'text',
                model_spec: { offline: true, capabilities: { supportsResponseSchema: true } },
              },
              {
                id: 'retired-model',
                type: 'text',
                model_spec: {
                  capabilities: { supportsResponseSchema: true },
                  deprecation: { date: '2000-01-01T00:00:00.000Z' },
                },
              },
            ],
          }),
        };
      },
    });

    assert.equal(captured.url, 'https://api.venice.ai/api/v1/models?type=text');
    assert.equal(captured.options.headers.Authorization, 'Bearer venice-secret');
    assert.deepEqual(result.models, [
      {
        id: 'deepseek-v4-pro',
        name: 'DeepSeek V4 Pro',
        type: 'text',
        traits: ['reasoning'],
        deprecation: null,
      },
    ]);
  });

  it('validates the key through the read-only models endpoint', async () => {
    let captured = null;
    const requestImpl = async (url, options) => {
      captured = { url: String(url), options };
      return {
        statusCode: 200,
        raw: JSON.stringify({ data: [] }),
        headers: { 'content-type': 'application/json' },
      };
    };
    await aiConfigService.testConnection({
      base_url: 'https://api.venice.ai/api/v1',
      api_key: 'venice-secret',
      provider: 'venice',
      api_protocol: 'venice',
      service_type: 'video',
      model: 'seedance-2-0',
      request_impl: requestImpl,
    });
    assert.equal(
      captured.url,
      'https://api.venice.ai/api/v1/models?limit=1'
    );
    assert.equal(captured.options.headers.Authorization, 'Bearer venice-secret');
  });
});
