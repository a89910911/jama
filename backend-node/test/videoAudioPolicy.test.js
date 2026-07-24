'use strict';

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const {
  forceVideoAudioSettings,
  applyRequiredVideoAudioOption,
} = require('../src/services/videoAudioPolicy');

describe('required video audio policy', () => {
  it('normalizes every video config to generate_audio=true', () => {
    assert.deepEqual(
      JSON.parse(forceVideoAudioSettings('video', '{"generate_audio":false,"quality":"high"}')),
      { generate_audio: true, quality: 'high' }
    );
    assert.equal(forceVideoAudioSettings('text', null), null);
  });

  it('overrides provider-specific attempts to disable native audio', () => {
    assert.deepEqual(
      applyRequiredVideoAudioOption({ generate_audio: false }, 'holycrab'),
      { generate_audio: true }
    );
    assert.deepEqual(
      applyRequiredVideoAudioOption({ audio: false }, 'venice'),
      { audio: true }
    );
    assert.deepEqual(
      applyRequiredVideoAudioOption({ audio: false }, 'vidu'),
      { audio: true }
    );
    assert.deepEqual(
      applyRequiredVideoAudioOption({ sound: 'off' }, 'kling_omni'),
      { sound: 'on' }
    );
    assert.deepEqual(
      applyRequiredVideoAudioOption({ generate_audio: false }, 'volcengine_omni'),
      { generate_audio: true }
    );
  });
});
