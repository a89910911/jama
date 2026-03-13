// 根据故事梗概 + 风格/类型/集数，调用文本模型生成扩展后的故事/剧本（JSON 数组格式）
const aiClient = require('./aiClient');
const promptI18n = require('./promptI18n');
const { safeParseAIJSON } = require('../utils/safeJson');
const loadConfig = require('../config').loadConfig;

async function generateStory(db, log, body) {
  const premise = (body.premise || body.prompt || body.text || '').trim();
  if (!premise) {
    throw new Error('请提供故事梗概');
  }
  const cfg = loadConfig();
  const style = body.style || body.genre || null;
  const type = body.type || null;
  const episodeCount = Math.max(1, Math.min(20, Number(body.episode_count) || 1));

  const systemPrompt = promptI18n.getStoryExpansionSystemPrompt(cfg, episodeCount);
  const userPrompt = promptI18n.buildStoryExpansionUserPrompt(cfg, premise, style, type, episodeCount);

  // 每集约 800 字（中文）≈ 1600 token，多留余量作为最低需求；
  // 不使用 max_tokens 硬上限，而是用 min_max_tokens 确保即使用户 AI 配置了小上限也能保证基本输出量。
  const minTokensNeeded = Math.max(2000, episodeCount * 2200);

  const rawText = await aiClient.generateText(db, log, 'text', userPrompt, systemPrompt, {
    model: body.model || undefined,
    temperature: 0.8,
    min_max_tokens: minTokensNeeded,
    json_mode: true,
  });

  // 解析 JSON 数组
  let episodes = null;
  try {
    episodes = safeParseAIJSON(rawText, log);
  } catch (e) {
    log && log.warn && log.warn('Story JSON parse failed, falling back to plain text', { error: e.message });
  }

  if (Array.isArray(episodes) && episodes.length > 0) {
    // 确保每集都有 episode 序号和 content
    const result = episodes.map((ep, i) => ({
      episode: ep.episode ?? i + 1,
      title: (ep.title || `第${(ep.episode ?? i + 1)}集`).trim(),
      content: (ep.content || ep.script || ep.text || '').trim(),
    })).filter(ep => ep.content.length > 0);

    if (result.length > 0) {
      return { episodes: result };
    }
  }

  // 兜底：如果 JSON 解析失败，把整个文本当作第 1 集返回
  const fallbackContent = (rawText || '').trim();
  return {
    episodes: [{
      episode: 1,
      title: '第1集',
      content: fallbackContent,
    }],
  };
}

module.exports = {
  generateStory,
};
