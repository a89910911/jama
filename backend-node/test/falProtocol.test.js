const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const {
  normalizeFalApiKey,
  falAuthorizationValue,
  falDirectBase,
  falQueueBase,
  isFalConfig,
  encodeFalQueueHandle,
  decodeFalQueueHandle,
  falQueueStatusUrl,
  falQueueResultUrl,
} = require('../src/services/falClient');
const { buildChatAuthHeaders } = require('../src/services/aiClient');
const {
  normalizeFalImageSize,
  resolveFalImageEndpoint,
} = require('../src/services/imageClient');
const {
  normalizeFalSeedanceDuration,
  normalizeFalSeedanceResolution,
  normalizeFalSeedanceAspectRatio,
  normalizeFalReferencePrompt,
  resolveFalSeedanceEndpoint,
  callFalVideoApi,
  pollVideoTask,
} = require('../src/services/videoClient');
const {
  resolveFalTtsEndpoint,
  buildFalTtsInput,
  synthesizeWithFal,
} = require('../src/services/ttsService');
const aiConfigService = require('../src/services/aiConfigService');

const silentLog = {
  info() {},
  warn() {},
  error() {},
};

describe('fal.ai authentication and URL helpers', () => {
  it('normalizes a pasted key prefix and emits fal Key authentication', () => {
    assert.equal(normalizeFalApiKey(' Bearer abc:def '), 'abc:def');
    assert.equal(normalizeFalApiKey('Key abc:def'), 'abc:def');
    assert.equal(falAuthorizationValue('abc:def'), 'Key abc:def');
  });

  it('detects fal configuration by provider, protocol, or host', () => {
    assert.equal(isFalConfig({ provider: 'fal' }), true);
    assert.equal(isFalConfig({ api_protocol: 'fal' }), true);
    assert.equal(isFalConfig({ base_url: 'https://queue.fal.run' }), true);
    assert.equal(isFalConfig({ provider: 'openai', base_url: 'https://api.openai.com/v1' }), false);
  });

  it('switches between direct and queue fal hosts', () => {
    assert.equal(falDirectBase('https://queue.fal.run'), 'https://fal.run');
    assert.equal(falQueueBase('https://fal.run'), 'https://queue.fal.run');
  });

  it('round-trips queue handles and uses returned status/result URLs', () => {
    const taskId = encodeFalQueueHandle({
      request_id: 'request-123',
      endpoint: 'bytedance/seedance-2.0/text-to-video',
      status_url: 'https://queue.fal.run/status/request-123',
      response_url: 'https://queue.fal.run/result/request-123',
    });
    const handle = decodeFalQueueHandle(taskId);
    assert.equal(handle.request_id, 'request-123');
    assert.equal(handle.endpoint, 'bytedance/seedance-2.0/text-to-video');
    assert.equal(falQueueStatusUrl('', handle), 'https://queue.fal.run/status/request-123');
    assert.equal(falQueueResultUrl('', handle), 'https://queue.fal.run/result/request-123');
  });
});

describe('fal.ai text and image adapters', () => {
  it('uses Key auth for fal text and Bearer for existing providers', () => {
    assert.deepEqual(
      buildChatAuthHeaders({ provider: 'fal', api_key: 'secret' }),
      { Authorization: 'Key secret' }
    );
    assert.deepEqual(
      buildChatAuthHeaders({ provider: 'openai', api_key: 'secret' }),
      { Authorization: 'Bearer secret' }
    );
  });

  it('maps image sizes and selects the GPT Image edit endpoint for references', () => {
    assert.equal(normalizeFalImageSize('16:9'), 'landscape_16_9');
    assert.deepEqual(normalizeFalImageSize('1280x720'), { width: 1280, height: 720 });
    assert.equal(resolveFalImageEndpoint('openai/gpt-image-2', false), 'openai/gpt-image-2');
    assert.equal(resolveFalImageEndpoint('openai/gpt-image-2', true), 'openai/gpt-image-2/edit');
  });
});

describe('fal.ai Seedance and TTS adapters', () => {
  it('normalizes Seedance parameters and endpoint mode', () => {
    assert.equal(normalizeFalSeedanceDuration(2), '4');
    assert.equal(normalizeFalSeedanceDuration(20), '15');
    assert.equal(normalizeFalSeedanceResolution('1080P'), '1080p');
    assert.equal(
      normalizeFalSeedanceResolution('1080P', 'bytedance/seedance-2.0/fast/text-to-video'),
      '720p'
    );
    assert.equal(
      normalizeFalSeedanceResolution('4K', 'bytedance/seedance-2.0/mini/reference-to-video'),
      '720p'
    );
    assert.equal(normalizeFalSeedanceAspectRatio('9:16'), '9:16');
    assert.equal(normalizeFalSeedanceAspectRatio('2:1'), 'auto');
    assert.equal(
      resolveFalSeedanceEndpoint('bytedance/seedance-2.0/text-to-video', 'image-to-video'),
      'bytedance/seedance-2.0/image-to-video'
    );
    assert.equal(normalizeFalReferencePrompt('@图片1 看向 @Image 2'), '@Image1 看向 @Image2');
  });

  it('builds Qwen and Gemini fal TTS inputs', () => {
    assert.equal(
      resolveFalTtsEndpoint({}, 'fal-ai/qwen-3-tts/text-to-speech/1.7b'),
      'fal-ai/qwen-3-tts/text-to-speech/1.7b'
    );
    assert.deepEqual(
      buildFalTtsInput('你好', '', 'fal-ai/qwen-3-tts/text-to-speech/1.7b', {}),
      { text: '你好', voice: 'Vivian', language: 'Chinese' }
    );
    assert.deepEqual(
      buildFalTtsInput('你好', 'Kore', 'fal-ai/gemini-3.1-flash-tts', {}),
      {
        prompt: '你好',
        voice: 'Kore',
        language_code: 'Chinese Mandarin (China)',
        output_format: 'mp3',
      }
    );
  });

  it('submits Seedance text-to-video to the fal queue with a portable task handle', async () => {
    const previousFetch = global.fetch;
    let captured = null;
    global.fetch = async (url, options) => {
      captured = { url: String(url), options };
      return new Response(
        JSON.stringify({
          request_id: 'seedance-request',
          status_url: 'https://queue.fal.run/status/seedance-request',
          response_url: 'https://queue.fal.run/result/seedance-request',
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      );
    };
    try {
      const result = await callFalVideoApi(
        {
          provider: 'fal',
          api_protocol: 'fal',
          base_url: 'https://queue.fal.run',
          api_key: 'fal-secret',
          settings: JSON.stringify({ generate_audio: false }),
        },
        silentLog,
        {
          prompt: '测试视频',
          model: 'bytedance/seedance-2.0',
          duration: 8,
          aspect_ratio: '16:9',
          resolution: '1080p',
          video_gen_id: 1,
        }
      );
      assert.match(captured.url, /bytedance\/seedance-2\.0\/text-to-video$/);
      assert.equal(captured.options.headers.Authorization, 'Key fal-secret');
      assert.deepEqual(JSON.parse(captured.options.body), {
        prompt: '测试视频',
        resolution: '1080p',
        duration: '8',
        aspect_ratio: '16:9',
        generate_audio: true,
        bitrate_mode: 'standard',
      });
      assert.equal(decodeFalQueueHandle(result.task_id).request_id, 'seedance-request');
    } finally {
      global.fetch = previousFetch;
    }
  });

  it('routes Mini image input through reference-to-video and omits unsupported bitrate fields', async () => {
    const previousFetch = global.fetch;
    let captured = null;
    global.fetch = async (url, options) => {
      captured = { url: String(url), options };
      return new Response(JSON.stringify({ request_id: 'mini-request' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    };
    try {
      const result = await callFalVideoApi(
        {
          provider: 'fal',
          api_protocol: 'fal',
          base_url: 'https://queue.fal.run',
          api_key: 'fal-secret',
        },
        silentLog,
        {
          prompt: '让参考角色向镜头挥手',
          model: 'bytedance/seedance-2.0/mini',
          image_url: 'data:image/png;base64,AAAA',
          duration: 8,
          resolution: '1080p',
          video_gen_id: 2,
        }
      );
      const body = JSON.parse(captured.options.body);
      assert.match(captured.url, /bytedance\/seedance-2\.0\/mini\/reference-to-video$/);
      assert.deepEqual(body.image_urls, ['data:image/png;base64,AAAA']);
      assert.equal(body.resolution, '720p');
      assert.equal(Object.hasOwn(body, 'image_url'), false);
      assert.equal(Object.hasOwn(body, 'bitrate_mode'), false);
      assert.equal(decodeFalQueueHandle(result.task_id).request_id, 'mini-request');
    } finally {
      global.fetch = previousFetch;
    }
  });

  it('polls a completed fal queue task and reads video.url', async () => {
    const previousFetch = global.fetch;
    const progressEvents = [];
    const taskId = encodeFalQueueHandle({
      request_id: 'seedance-request',
      endpoint: 'bytedance/seedance-2.0/text-to-video',
      status_url: 'https://queue.fal.run/status/seedance-request',
      response_url: 'https://queue.fal.run/result/seedance-request',
    });
    global.fetch = async (url, options) => {
      assert.equal(options.headers.Authorization, 'Key fal-secret');
      if (String(url).includes('/status/')) {
        return new Response(JSON.stringify({ status: 'COMPLETED' }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      return new Response(
        JSON.stringify({ video: { url: 'https://cdn.example.com/video.mp4' }, seed: 42 }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      );
    };
    try {
      const result = await pollVideoTask(
        null,
        silentLog,
        1,
        taskId,
        {
          provider: 'fal',
          api_protocol: 'fal',
          base_url: 'https://queue.fal.run',
          api_key: 'fal-secret',
        },
        2,
        0,
        (event) => progressEvents.push(event)
      );
      assert.equal(result.video_url, 'https://cdn.example.com/video.mp4');
      assert.ok(progressEvents.length >= 1);
      assert.ok(progressEvents[0].progress >= 20);
      assert.equal(progressEvents[0].estimated, true);
    } finally {
      global.fetch = previousFetch;
    }
  });

  it('downloads the audio URL returned by fal TTS', async () => {
    const previousFetch = global.fetch;
    const calls = [];
    global.fetch = async (url, options = {}) => {
      calls.push({ url: String(url), options });
      if (calls.length === 1) {
        return new Response(
          JSON.stringify({ audio: { url: 'https://cdn.example.com/speech.mp3' } }),
          { status: 200, headers: { 'Content-Type': 'application/json' } }
        );
      }
      return new Response(Buffer.from([1, 2, 3]), {
        status: 200,
        headers: { 'Content-Type': 'audio/mpeg' },
      });
    };
    try {
      const audio = await synthesizeWithFal(
        '你好',
        'Vivian',
        {
          provider: 'fal',
          base_url: 'https://fal.run',
          api_key: 'fal-secret',
        },
        'fal-ai/qwen-3-tts/text-to-speech/1.7b',
        { language: 'Chinese' }
      );
      assert.deepEqual(audio, Buffer.from([1, 2, 3]));
      assert.equal(calls[0].options.headers.Authorization, 'Key fal-secret');
      assert.equal(JSON.parse(calls[0].options.body).voice, 'Vivian');
    } finally {
      global.fetch = previousFetch;
    }
  });

  it('tests a fal key through the read-only model-list endpoint', async () => {
    const previousFetch = global.fetch;
    let captured = null;
    global.fetch = async (url, options) => {
      captured = { url: String(url), options };
      return new Response(JSON.stringify({ models: [] }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    };
    try {
      await aiConfigService.testConnection({
        base_url: 'https://fal.run',
        api_key: 'fal-secret',
        provider: 'fal',
        api_protocol: 'fal',
        service_type: 'image',
        model: 'openai/gpt-image-2',
      });
      assert.equal(captured.url, 'https://api.fal.ai/v1/models?limit=1');
      assert.equal(captured.options.headers.Authorization, 'Key fal-secret');
    } finally {
      global.fetch = previousFetch;
    }
  });
});
