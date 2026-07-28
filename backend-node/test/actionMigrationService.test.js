const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const {
  buildPrompt,
  buildNegativePrompt,
  configCapability,
} = require('../src/services/actionMigrationService');

describe('action migration prompt builder', () => {
  it('separates motion source from reference identity', () => {
    const prompt = buildPrompt('identity', 'red dress, rainy street');

    assert.match(prompt, /action migration/i);
    assert.match(prompt, /driving video only for body pose/i);
    assert.match(prompt, /reference image for identity/i);
    assert.match(prompt, /Replace the original actor/i);
    assert.match(prompt, /red dress, rainy street/);
  });

  it('includes default failure suppressors in the negative prompt', () => {
    const negative = buildNegativePrompt('low quality');

    assert.match(negative, /^low quality,/);
    assert.match(negative, /original actor face/);
    assert.match(negative, /identity drift/);
    assert.match(negative, /distorted hands/);
    assert.match(negative, /watermark/);
  });
});

describe('action migration model capability', () => {
  it('allows configured video protocols that accept source_video_url', () => {
    assert.equal(configCapability({ api_protocol: 'volcengine_omni', model: 'seedance' }).ok, true);
    assert.equal(configCapability({ provider: 'mediabridge', model: 'seedance-2-0' }).ok, true);
  });

  it('blocks video models that cannot consume a driving video', () => {
    const result = configCapability({ api_protocol: 'kling_omni', model: 'kling-v2' });

    assert.equal(result.ok, false);
    assert.equal(result.code, 'unsupported_reference_video');
    assert.match(result.message, /不支持动作迁移驱动视频/);
  });
});
