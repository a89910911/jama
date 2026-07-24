'use strict';

const VIDEO_AUDIO_REQUIRED = true;

function parseSettingsObject(settings) {
  if (!settings) return {};
  if (typeof settings === 'object' && !Array.isArray(settings)) return { ...settings };
  try {
    const parsed = JSON.parse(settings);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch (_) {
    return {};
  }
}

/**
 * 视频音频是产品级硬约束：配置只能保存为开启状态。
 * 统一写入 generate_audio，具体厂商字段由 videoClient 适配。
 */
function forceVideoAudioSettings(serviceType, settings) {
  if (String(serviceType || '').trim().toLowerCase() !== 'video') {
    return settings ?? null;
  }
  const normalized = parseSettingsObject(settings);
  normalized.generate_audio = VIDEO_AUDIO_REQUIRED;
  return JSON.stringify(normalized);
}

/** 将各厂商的原生音频参数强制设为开启，调用方传入的 false 不会生效。 */
function applyRequiredVideoAudioOption(body, protocol) {
  const target = body && typeof body === 'object' ? body : {};
  switch (String(protocol || '').trim().toLowerCase()) {
    case 'fal':
    case 'holycrab':
    case 'volcengine':
    case 'volcengine_omni':
      target.generate_audio = VIDEO_AUDIO_REQUIRED;
      break;
    case 'venice':
    case 'vidu':
      target.audio = VIDEO_AUDIO_REQUIRED;
      break;
    case 'kling_omni':
      target.sound = 'on';
      break;
    default:
      // Veo、Wan 等协议没有可关闭的音频开关，按厂商默认有声能力生成。
      break;
  }
  return target;
}

module.exports = {
  VIDEO_AUDIO_REQUIRED,
  forceVideoAudioSettings,
  applyRequiredVideoAudioOption,
};
