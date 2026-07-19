/**
 * TTS 语音合成服务
 * 支持多种 TTS 接口：minimax、edge-tts（本地）、通用 HTTP
 */
const https = require('https');
const http = require('http');
const fs = require('fs');
const path = require('path');
const { randomUUID } = require('crypto');
const aiRequestLogService = require('./aiRequestLogService');
const {
  isFalConfig,
  falDirectBase,
  falHeaders,
  joinFalUrl,
  normalizeFalEndpoint,
  getFalErrorMessage,
} = require('./falClient');

/**
 * 使用 MiniMax T2A v2 合成语音
 */
async function synthesizeWithMinimax(text, voiceId, apiKey, groupId, model) {
  const body = JSON.stringify({
    model: model || 'speech-02-hd',
    text,
    stream: false,
    voice_setting: {
      voice_id: voiceId || 'female-shaonv',
      speed: 1.0,
      vol: 1.0,
      pitch: 0,
    },
    audio_setting: {
      sample_rate: 32000,
      bitrate: 128000,
      format: 'mp3',
      channel: 1,
    },
  });
  const url = `https://api.minimax.chat/v1/t2a_v2?GroupId=${groupId}`;
  return new Promise((resolve, reject) => {
    const reqOpts = {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
        'Content-Length': Buffer.byteLength(body),
      },
    };
    const urlObj = new URL(url);
    const client = urlObj.protocol === 'https:' ? https : http;
    const req = client.request(urlObj, reqOpts, (res) => {
      const chunks = [];
      res.on('data', (chunk) => chunks.push(chunk));
      res.on('end', () => {
        if (res.statusCode !== 200) {
          reject(new Error(`MiniMax TTS HTTP ${res.statusCode}: ${Buffer.concat(chunks).toString()}`));
          return;
        }
        const data = JSON.parse(Buffer.concat(chunks).toString());
        if (data.base_resp?.status_code !== 0) {
          reject(new Error(`MiniMax TTS error: ${data.base_resp?.status_msg || 'unknown'}`));
          return;
        }
        const audioHex = data.data?.audio;
        if (!audioHex) { reject(new Error('MiniMax TTS 未返回音频')); return; }
        resolve(Buffer.from(audioHex, 'hex'));
      });
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

/**
 * 使用 OpenAI TTS API 合成语音（兼容所有 OpenAI 格式的代理）
 * POST {base_url}/audio/speech  body: { model, input, voice, response_format, speed }
 */
async function synthesizeWithOpenai(text, voice, apiKey, baseUrl, model, speed) {
  const url = (baseUrl || 'https://api.openai.com/v1').replace(/\/+$/, '') + '/audio/speech';
  const body = JSON.stringify({
    model: model || 'tts-1',
    input: text,
    voice: voice || 'alloy',
    response_format: 'mp3',
    speed: speed || 1.0,
  });
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const mod = parsed.protocol === 'https:' ? https : http;
    const reqOpts = {
      hostname: parsed.hostname,
      port: parsed.port || (parsed.protocol === 'https:' ? 443 : 80),
      path: parsed.pathname + parsed.search,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body),
        ...(apiKey ? { 'Authorization': `Bearer ${apiKey}` } : {}),
      },
    };
    const req = mod.request(reqOpts, (res) => {
      const chunks = [];
      res.on('data', (chunk) => chunks.push(chunk));
      res.on('end', () => {
        const buf = Buffer.concat(chunks);
        if (res.statusCode < 200 || res.statusCode >= 300) {
          reject(new Error(`OpenAI TTS HTTP ${res.statusCode}: ${buf.toString('utf-8').slice(0, 500)}`));
          return;
        }
        resolve(buf);
      });
    });
    const timer = setTimeout(() => { req.destroy(); reject(new Error('OpenAI TTS 请求超时')); }, 120000);
    req.on('error', (e) => { clearTimeout(timer); reject(e); });
    req.on('close', () => clearTimeout(timer));
    req.write(body);
    req.end();
  });
}

function resolveFalTtsEndpoint(config, model) {
  const endpoint = config?.endpoint || model || 'fal-ai/qwen-3-tts/text-to-speech/1.7b';
  return normalizeFalEndpoint(endpoint);
}

function buildFalTtsInput(text, voiceId, model, settings = {}) {
  const modelLower = String(model || '').toLowerCase();
  if (modelLower.includes('gemini') && modelLower.includes('tts')) {
    return {
      prompt: text,
      voice: voiceId || settings.voice_id || 'Kore',
      language_code: settings.language_code || 'Chinese Mandarin (China)',
      output_format: 'mp3',
      ...(settings.style_instructions ? { style_instructions: settings.style_instructions } : {}),
      ...(Number.isFinite(Number(settings.temperature))
        ? { temperature: Number(settings.temperature) }
        : {}),
    };
  }
  if (modelLower.includes('qwen-3-tts')) {
    return {
      text,
      voice: voiceId || settings.voice_id || 'Vivian',
      language: settings.language || 'Chinese',
      ...(settings.prompt ? { prompt: settings.prompt } : {}),
    };
  }
  return {
    text,
    ...(voiceId || settings.voice_id ? { voice: voiceId || settings.voice_id } : {}),
  };
}

async function fetchWithTimeout(url, options, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } catch (error) {
    if (error?.name === 'AbortError') throw new Error('fal.ai TTS 请求超时');
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

async function synthesizeWithFal(text, voiceId, config, model, settings) {
  const endpoint = resolveFalTtsEndpoint(config, model);
  const url = joinFalUrl(falDirectBase(config.base_url), endpoint);
  const input = buildFalTtsInput(text, voiceId, endpoint, settings);
  const res = await fetchWithTimeout(
    url,
    {
      method: 'POST',
      headers: falHeaders(config.api_key, { 'Content-Type': 'application/json' }),
      body: JSON.stringify(input),
    },
    300000
  );
  const contentType = String(res.headers.get('content-type') || '').toLowerCase();
  if (res.ok && contentType.startsWith('audio/')) {
    return Buffer.from(await res.arrayBuffer());
  }

  const raw = await res.text();
  let data = null;
  try {
    data = JSON.parse(raw);
  } catch (_) {}
  if (!res.ok) {
    throw new Error(
      `fal.ai TTS HTTP ${res.status}: ${getFalErrorMessage(data, raw.slice(0, 500))}`
    );
  }
  const audioUrl =
    data?.audio?.url ||
    data?.data?.audio?.url ||
    data?.audio_url ||
    data?.url;
  if (!audioUrl) {
    throw new Error(`fal.ai TTS 未返回音频地址: ${raw.slice(0, 500)}`);
  }
  const audioRes = await fetchWithTimeout(audioUrl, { method: 'GET' }, 120000);
  if (!audioRes.ok) {
    throw new Error(`fal.ai TTS 音频下载失败: HTTP ${audioRes.status}`);
  }
  return Buffer.from(await audioRes.arrayBuffer());
}

/**
 * 合成 TTS 并保存到本地文件
 * @returns {{ local_path: string, audio_url: string }}
 */
async function synthesizeInternal(db, log, { text, storyboard_id, config, storage_base, voice_id, speed }) {
  if (!text || !text.trim()) throw new Error('text 不能为空');
  const aiConfigService = require('./aiConfigService');
  const ttsConfig = config || (() => {
    const configs = aiConfigService.listConfigs(db, 'tts');
    const active = configs.filter((c) => c.is_active);
    return active.find((c) => c.is_default) || active[0];
  })();
  if (!ttsConfig) throw new Error('未配置 TTS 模型，请在「AI 配置」中添加 service_type=tts 的配置');

  const provider = (ttsConfig.provider || '').toLowerCase();
  let ttsSettings = {};
  try { ttsSettings = JSON.parse(ttsConfig.settings || '{}'); } catch (_) {}
  // 外部传入的 voice_id / speed 优先（海外化场景），否则取配置值
  const voiceId = voice_id || ttsConfig.voice_id || ttsSettings.voice_id || '';
  const groupId = ttsConfig.group_id || ttsSettings.group_id || '';
  const ttsModel = ttsConfig.default_model || (Array.isArray(ttsConfig.model) ? ttsConfig.model[0] : ttsConfig.model) || '';
  const finalSpeed = speed || ttsSettings.speed || 1.0;
  let audioBuffer;

  if (provider === 'fal' || provider === 'fal.ai' || isFalConfig(ttsConfig)) {
    audioBuffer = await synthesizeWithFal(
      text,
      voiceId,
      ttsConfig,
      ttsModel || 'fal-ai/qwen-3-tts/text-to-speech/1.7b',
      ttsSettings
    );
  } else if (provider === 'minimax') {
    audioBuffer = await synthesizeWithMinimax(
      text,
      voiceId || 'female-shaonv',
      ttsConfig.api_key,
      groupId,
      ttsModel || 'speech-02-hd'
    );
  } else if (provider === 'openai' || ttsConfig.base_url) {
    console.log('==c sxy synthesizeWithOpenai', text, voiceId, ttsConfig.api_key, ttsConfig.base_url, ttsModel, finalSpeed);
    audioBuffer = await synthesizeWithOpenai(
      text,
      voiceId || 'alloy',
      ttsConfig.api_key,
      ttsConfig.base_url,
      ttsModel || 'tts-1',
      finalSpeed
    );
  } else {
    throw new Error(`不支持的 TTS provider: ${provider}，目前支持 openai、minimax`);
  }

  // 保存到本地
  const audioDir = path.join(storage_base, 'audio');
  if (!fs.existsSync(audioDir)) fs.mkdirSync(audioDir, { recursive: true });
  const filename = `tts_sb${storyboard_id || 'x'}_${randomUUID().slice(0, 8)}.mp3`;
  const filePath = path.join(audioDir, filename);
  fs.writeFileSync(filePath, audioBuffer);
  const localPath = `audio/${filename}`;
  log.info('[TTS] 合成完成', { storyboard_id, local_path: localPath, provider });
  try { const cs = require('./cloudService'); cs.reportUsage('tts', ttsModel || '', '', 0); } catch (_) {}
  return { local_path: localPath };
}

function resolveTtsLogMeta(db, options = {}) {
  try {
    const aiConfigService = require('./aiConfigService');
    const config = options.config || (() => {
      const active = aiConfigService.listConfigs(db, 'tts').filter((item) => item.is_active);
      return active.find((item) => item.is_default) || active[0];
    })();
    return {
      config_id: config?.id || null,
      provider: config?.provider || null,
      model: config?.default_model
        || (Array.isArray(config?.model) ? config.model[0] : config?.model)
        || null,
    };
  } catch (_) {
    return { config_id: null, provider: null, model: null };
  }
}

async function synthesize(db, log, options) {
  const meta = resolveTtsLogMeta(db, options);
  const record = aiRequestLogService.start(db, {
    service_type: 'tts',
    operation: 'speech_synthesis',
    ...meta,
    options,
    related_type: options.storyboard_id ? 'storyboard' : undefined,
    related_id: options.storyboard_id,
    request: {
      text: options.text || '',
      storyboard_id: options.storyboard_id || null,
      voice_id: options.voice_id || null,
      speed: options.speed || null,
    },
  });
  try {
    const result = await synthesizeInternal(db, log, options);
    aiRequestLogService.succeed(db, record, result, meta);
    return result;
  } catch (error) {
    aiRequestLogService.fail(db, record, error, null, meta);
    throw error;
  }
}

module.exports = {
  synthesize,
  resolveFalTtsEndpoint,
  buildFalTtsInput,
  synthesizeWithFal,
};
