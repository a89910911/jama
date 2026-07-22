const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const {
  qwenImageSize,
  dashScopeImageSizeForModel,
  callDashScopeImageApi,
} = require('../src/services/imageClient');
const {
  normalizeDashScopeWan27Duration,
  normalizeDashScopeWan27Resolution,
  normalizeDashScopeWan27Ratio,
  callDashScopeVideoApi,
} = require('../src/services/videoClient');

const silentLog = {
  info() {},
  warn() {},
  error() {},
};

const imageSuccess = JSON.stringify({
  output: {
    choices: [{ message: { content: [{ type: 'image', image: 'https://cdn.example.com/image.png' }] } }],
  },
});

describe('DashScope Qwen Image 2.0 and Wan 2.7 image adapters', () => {
  it('maps requested aspect ratios to the verified 2K size set', () => {
    assert.equal(qwenImageSize('2560x1440', 'qwen-image-2.0-pro'), '2688*1536');
    assert.equal(qwenImageSize('9:16', 'qwen-image-2.0'), '1536*2688');
    assert.equal(dashScopeImageSizeForModel('1024x1024', 'wan2.7-image-pro'), '2048*2048');
    assert.equal(qwenImageSize('2560x1440', 'qwen-image-max'), '1664*928');
  });

  it('submits Qwen Image 2.0 reference editing through the synchronous multimodal endpoint', async () => {
    let captured = null;
    const result = await callDashScopeImageApi(
      {
        provider: 'qwen_image',
        base_url: 'https://dashscope.aliyuncs.com',
        api_key: 'secret',
      },
      silentLog,
      {
        prompt: '让两个角色保持一致地站在街道上',
        model: 'qwen-image-2.0-pro',
        size: '16:9',
        image_gen_id: 1,
        reference_image_urls: ['https://cdn.example.com/a.png', 'https://cdn.example.com/b.png'],
        negative_prompt: '拼贴画面',
        request_impl: async (url, headers, body) => {
          captured = { url, headers, body };
          return { statusCode: 200, raw: imageSuccess };
        },
      }
    );

    assert.equal(result.image_url, 'https://cdn.example.com/image.png');
    assert.equal(captured.body.model, 'qwen-image-2.0-pro');
    assert.deepEqual(captured.body.input.messages[0].content.slice(0, 2), [
      { image: 'https://cdn.example.com/a.png' },
      { image: 'https://cdn.example.com/b.png' },
    ]);
    assert.deepEqual(captured.body.input.messages[0].content.at(-1), {
      text: '让两个角色保持一致地站在街道上',
    });
    assert.equal(captured.body.parameters.size, '2688*1536');
    assert.equal(captured.body.parameters.negative_prompt, '拼贴画面');
  });

  it('uses the Wan 2.7 synchronous schema without unsupported 2.6 streaming fields', async () => {
    let captured = null;
    const result = await callDashScopeImageApi(
      {
        provider: 'dashscope',
        base_url: 'https://workspace.cn-beijing.maas.aliyuncs.com/api/v1',
        api_key: 'secret',
      },
      silentLog,
      {
        prompt: '根据参考图生成统一风格分镜',
        model: 'wan2.7-image-pro',
        size: '4:3',
        image_gen_id: 2,
        reference_image_urls: ['https://cdn.example.com/ref.png'],
        request_impl: async (url, headers, body) => {
          captured = { url, headers, body };
          return { statusCode: 200, raw: imageSuccess };
        },
      }
    );

    assert.equal(result.image_url, 'https://cdn.example.com/image.png');
    assert.equal(
      captured.url,
      'https://workspace.cn-beijing.maas.aliyuncs.com/api/v1/services/aigc/multimodal-generation/generation'
    );
    assert.equal(captured.body.parameters.size, '2368*1728');
    assert.equal(Object.hasOwn(captured.body.parameters, 'prompt_extend'), false);
    assert.equal(Object.hasOwn(captured.body.parameters, 'enable_interleave'), false);
    assert.equal(Object.hasOwn(captured.body.parameters, 'stream'), false);
  });
});

describe('DashScope Wan 2.7 video adapters', () => {
  it('normalizes duration, resolution, and ratio to supported values', () => {
    assert.equal(normalizeDashScopeWan27Duration(1), 2);
    assert.equal(normalizeDashScopeWan27Duration(30), 15);
    assert.equal(normalizeDashScopeWan27Resolution('720p'), '720P');
    assert.equal(normalizeDashScopeWan27Resolution('4k'), '1080P');
    assert.equal(normalizeDashScopeWan27Ratio('9:16'), '9:16');
    assert.equal(normalizeDashScopeWan27Ratio('21:9'), '16:9');
  });

  it('builds the unified media schema for R2V and I2V', async () => {
    const requests = [];
    const requestImpl = async (url, options) => {
      requests.push({ url: String(url), body: JSON.parse(options.body) });
      return new Response(JSON.stringify({ output: { task_id: `task-${requests.length}` } }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    };
    const config = {
      provider: 'dashscope',
      base_url: 'https://workspace.cn-beijing.maas.aliyuncs.com/api/v1',
      api_key: 'secret',
    };

    const r2v = await callDashScopeVideoApi(config, silentLog, {
      prompt: '图1和图2在同一场景中互动',
      model: 'wan2.7-r2v',
      reference_urls: ['https://cdn.example.com/a.png', 'https://cdn.example.com/b.png'],
      duration: 20,
      resolution: '720p',
      aspect_ratio: '9:16',
      video_gen_id: 1,
      request_impl: requestImpl,
    });
    const i2v = await callDashScopeVideoApi(config, silentLog, {
      prompt: '从首帧自然过渡到尾帧',
      model: 'wan2.7-i2v',
      first_frame_url: 'https://cdn.example.com/first.png',
      last_frame_url: 'https://cdn.example.com/last.png',
      duration: 1,
      resolution: '1080p',
      video_gen_id: 2,
      request_impl: requestImpl,
    });

    assert.equal(r2v.task_id, 'task-1');
    assert.deepEqual(requests[0].body.input.media, [
      { type: 'reference_image', url: 'https://cdn.example.com/a.png' },
      { type: 'reference_image', url: 'https://cdn.example.com/b.png' },
    ]);
    assert.deepEqual(requests[0].body.parameters, {
      resolution: '720P',
      ratio: '9:16',
      duration: 15,
      prompt_extend: false,
      watermark: false,
    });
    assert.equal(i2v.task_id, 'task-2');
    assert.deepEqual(requests[1].body.input.media, [
      { type: 'first_frame', url: 'https://cdn.example.com/first.png' },
      { type: 'last_frame', url: 'https://cdn.example.com/last.png' },
    ]);
    assert.equal(requests[1].body.parameters.duration, 2);
    assert.equal(requests[1].body.parameters.resolution, '1080P');
    assert.ok(requests.every((item) => !item.url.includes('/api/v1/api/v1/')));
  });
});

