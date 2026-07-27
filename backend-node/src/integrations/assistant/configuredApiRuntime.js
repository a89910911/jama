const { randomUUID } = require('crypto');
const path = require('path');
const aiClient = require('../../services/aiClient');
const imageClient = require('../../services/imageClient');
const userAiConfigService = require('../../services/userAiConfigService');
const { safeParseAIJSON } = require('../../utils/safeJson');
const { configModel } = require('../../services/assistantSettingsService');
const {
  isRegisteredBusinessScene,
} = require('../../services/businessSceneRegistry');

const DEFAULT_TEXT_TIMEOUT_MS = 2 * 60_000;

function resolveSceneKey(value) {
  const sceneKey = String(value || '');
  return isRegisteredBusinessScene(sceneKey) ? sceneKey : 'story_generation';
}

function schemaErrors(value, schema, path = '$') {
  if (!schema) return [];
  const errors = [];
  if (schema.const !== undefined && value !== schema.const) {
    errors.push(`${path} 必须等于 ${JSON.stringify(schema.const)}`);
  }
  if (schema.type === 'object') {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      return [`${path} 必须是对象`];
    }
    for (const key of schema.required || []) {
      if (value[key] === undefined) errors.push(`${path}.${key} 缺失`);
    }
    for (const [key, childSchema] of Object.entries(schema.properties || {})) {
      if (value[key] !== undefined) {
        errors.push(...schemaErrors(value[key], childSchema, `${path}.${key}`));
      }
    }
    if (schema.additionalProperties === false) {
      const allowed = new Set(Object.keys(schema.properties || {}));
      for (const key of Object.keys(value)) {
        if (!allowed.has(key)) errors.push(`${path}.${key} 不允许出现`);
      }
    }
    return errors;
  }
  if (schema.type === 'array') {
    if (!Array.isArray(value)) return [`${path} 必须是数组`];
    if (schema.minItems != null && value.length < schema.minItems) {
      errors.push(`${path} 至少需要 ${schema.minItems} 项`);
    }
    if (schema.maxItems != null && value.length > schema.maxItems) {
      errors.push(`${path} 最多允许 ${schema.maxItems} 项`);
    }
    value.forEach((item, index) => {
      errors.push(...schemaErrors(item, schema.items, `${path}[${index}]`));
    });
    return errors;
  }
  if (schema.type === 'string' && typeof value !== 'string') {
    errors.push(`${path} 必须是字符串`);
  } else if (schema.type === 'string') {
    if (schema.minLength != null && value.length < schema.minLength) {
      errors.push(`${path} 长度不能少于 ${schema.minLength}`);
    }
    if (schema.maxLength != null && value.length > schema.maxLength) {
      errors.push(`${path} 长度不能超过 ${schema.maxLength}`);
    }
  } else if (schema.type === 'integer' && !Number.isInteger(value)) {
    errors.push(`${path} 必须是整数`);
  } else if (schema.type === 'number' && typeof value !== 'number') {
    errors.push(`${path} 必须是数字`);
  } else if (schema.type === 'boolean' && typeof value !== 'boolean') {
    errors.push(`${path} 必须是布尔值`);
  }
  if (schema.enum && !schema.enum.includes(value)) {
    errors.push(`${path} 必须是 ${schema.enum.join(' / ')} 之一`);
  }
  if (typeof value === 'number') {
    if (schema.minimum != null && value < schema.minimum) {
      errors.push(`${path} 不能小于 ${schema.minimum}`);
    }
    if (schema.maximum != null && value > schema.maximum) {
      errors.push(`${path} 不能大于 ${schema.maximum}`);
    }
  }
  return errors;
}

function parseStructuredText(text, schema) {
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch (_) {
    parsed = safeParseAIJSON(text, {}, null);
  }
  const errors = schemaErrors(parsed, schema);
  if (errors.length) {
    const error = new Error(`结构化输出校验失败：${errors.slice(0, 8).join('；')}`);
    error.code = 'ASSISTANT_SCHEMA_INVALID';
    error.validationErrors = errors;
    throw error;
  }
  return parsed;
}

function activeDefaultConfig(db, serviceType, userId) {
  const configs = userAiConfigService.listRuntimeConfigs(db, userId, serviceType);
  const active = configs
    .filter((item) => item.is_active);
  return active.find((item) => item.is_default) || active[0] || null;
}

function schemaInstruction(schema) {
  return [
    '只输出一个 JSON 值，不要输出 Markdown 代码块或额外解释。',
    '输出必须严格满足下面的 JSON Schema：',
    JSON.stringify(schema),
  ].join('\n');
}

class ConfiguredApiRuntime {
  constructor(options = {}) {
    this.db = options.db;
    this.log = options.log || console;
    this.userId = userAiConfigService.requireUserId(options.userId);
    this.activeTasks = new Set();
    this.cancelledTasks = new Set();
    this.lastError = null;
  }

  async ensureReady() {
    const config = activeDefaultConfig(this.db, 'text', this.userId);
    if (!config) {
      const error = new Error('未配置已启用的文本/对话 API');
      error.code = 'ASSISTANT_TEXT_CONFIG_MISSING';
      this.lastError = error;
      throw error;
    }
    this.lastError = null;
    return this;
  }

  async ensureThread(existingThreadId) {
    return existingThreadId || `configured-api:${randomUUID()}`;
  }

  assertActive(taskId) {
    if (this.cancelledTasks.has(String(taskId))) {
      const error = new Error('用户已取消');
      error.code = 'CODEX_TURN_INTERRUPTED';
      throw error;
    }
  }

  async runStructuredTurn(options, turnId) {
    const systemPrompt = [
      '你是 LocalMiniDrama 内置的短剧创作助手。',
      '根据用户提供的项目上下文完成任务。',
      schemaInstruction(options.outputSchema),
    ].join('\n\n');
    let requestText = String(options.text || '');
    const sceneKey = resolveSceneKey(options.sceneKey);
    let lastError = null;
    for (let attempt = 0; attempt < 2; attempt += 1) {
      this.assertActive(options.taskId);
      const requestOptions = {
        json_mode: true,
        temperature: 0.2,
        max_tokens: 12000,
        min_max_tokens: 4000,
      };
      let raw;
      try {
        raw = await aiClient.generateText(
          this.db,
          this.log,
          'text',
          requestText,
          systemPrompt,
          { ...requestOptions, scene_key: sceneKey, user_id: this.userId }
        );
      } catch (error) {
        const unsupportedJsonMode = /response.?format|json.?mode|json_object/i.test(
          String(error?.message || '')
        );
        if (!unsupportedJsonMode) throw error;
        this.log?.warn?.(
          'AI assistant provider does not support JSON response_format; retrying with prompt-only JSON'
        );
        raw = await aiClient.generateText(
          this.db,
          this.log,
          'text',
          requestText,
          systemPrompt,
          {
            ...requestOptions,
            scene_key: sceneKey,
            json_mode: false,
            user_id: this.userId,
          }
        );
      }
      try {
        const parsed = parseStructuredText(raw, options.outputSchema);
        return {
          turnId,
          text: JSON.stringify(parsed),
          images: [],
          provider: activeDefaultConfig(this.db, 'text', this.userId)?.provider || null,
          model: configModel(activeDefaultConfig(this.db, 'text', this.userId)),
        };
      } catch (error) {
        lastError = error;
        requestText = [
          String(options.text || ''),
          '上一次输出未通过校验，请修正后重新输出完整 JSON。',
          `校验错误：${error.validationErrors?.slice(0, 8).join('；') || error.message}`,
        ].join('\n\n');
      }
    }
    throw lastError || new Error('结构化输出生成失败');
  }

  async runImageTurn(options, turnId) {
    const request = options.imageRequest || {};
    const serviceType = request.imageServiceType || 'image';
    const config = activeDefaultConfig(this.db, serviceType, this.userId);
    if (!config) {
      const labels = {
        image: '文本生成图片',
        storyboard_image: '分镜图片生成',
      };
      const error = new Error(`未配置已启用的${labels[serviceType] || serviceType} API`);
      error.code = 'ASSISTANT_IMAGE_CONFIG_MISSING';
      throw error;
    }
    this.assertActive(options.taskId);
    const model = configModel(config);
    const appConfig = require('../../config').loadConfig();
    const storageLocalPath = path.isAbsolute(appConfig?.storage?.local_path || '')
      ? appConfig.storage.local_path
      : path.join(process.cwd(), appConfig?.storage?.local_path || './data/storage');
    const result = await imageClient.callImageApi(this.db, this.log, {
      prompt: request.prompt || options.text || '',
      model: model || undefined,
      size: request.size || undefined,
      quality: request.quality || undefined,
      drama_id: request.dramaId,
      preferred_provider: config.provider || undefined,
      imageServiceType: serviceType,
      reference_image_urls: request.referenceImages || undefined,
      system_prompt: request.referenceContext || undefined,
      files_base_url: appConfig?.storage?.base_url || undefined,
      storage_local_path: storageLocalPath,
      task_id: options.taskId,
      user_id: this.userId,
      ai_config_id: config.id,
      ai_config_revision_id: config.revision_id,
    });
    this.assertActive(options.taskId);
    if (result?.error) throw new Error(result.error);
    if (!result?.image_url) throw new Error('图片 API 未返回图片');
    const image = {
      id: `configured-image:${randomUUID()}`,
      status: 'completed',
      imageUrl: result.image_url,
      revisedPrompt: '',
      provider: config.provider || '',
      model,
      configId: config.id,
    };
    options.onImage?.(image);
    return {
      turnId,
      text: '',
      images: [image],
      provider: image.provider,
      model: image.model,
      configId: image.configId,
    };
  }

  async runTurn(options) {
    if (!options.imageRequest) await this.ensureReady();
    const taskId = String(options.taskId);
    const turnId = `configured-turn:${randomUUID()}`;
    this.activeTasks.add(taskId);
    options.onTurnStarted?.(turnId);
    try {
      if (options.imageRequest) {
        return await this.runImageTurn(options, turnId);
      }
      if (options.outputSchema) {
        return await this.runStructuredTurn(options, turnId);
      }
      this.assertActive(taskId);
      const systemPrompt = [
        '你是 LocalMiniDrama 内置的 AI 创作助手。',
        '只回答当前短剧创作问题，不要声称执行了未实际执行的数据库或文件操作。',
      ].join('\n');
      const sceneKey = resolveSceneKey(options.sceneKey);
      const text = await aiClient.streamGenerateText(
        this.db,
        this.log,
        'text',
        String(options.text || ''),
        systemPrompt,
        {
          scene_key: sceneKey,
          user_id: this.userId,
          temperature: 0.7,
          silence_timeout_ms: Math.min(
            Number(options.timeoutMs) || DEFAULT_TEXT_TIMEOUT_MS,
            DEFAULT_TEXT_TIMEOUT_MS
          ),
        },
        (delta) => options.onDelta?.(delta)
      );
      this.assertActive(taskId);
      const config = activeDefaultConfig(this.db, 'text', this.userId);
      return {
        turnId,
        text: String(text || '').trim(),
        images: [],
        provider: config?.provider || null,
        model: configModel(config),
        configId: config?.id || null,
      };
    } catch (error) {
      this.lastError = error;
      throw error;
    } finally {
      this.activeTasks.delete(taskId);
      this.cancelledTasks.delete(taskId);
    }
  }

  async interruptTask(taskId) {
    const key = String(taskId);
    this.cancelledTasks.add(key);
    return this.activeTasks.has(key);
  }

  status() {
    const textConfig = activeDefaultConfig(this.db, 'text', this.userId);
    return {
      available: !!textConfig,
      starting: false,
      active_turns: this.activeTasks.size,
      error: textConfig ? this.lastError?.message || null : '未配置已启用的文本/对话 API',
      runtime: {
        engine: 'configured_api',
        provider: textConfig?.provider || null,
        model: configModel(textConfig),
      },
    };
  }
}

const runtimes = new WeakMap();

function getConfiguredApiRuntime(options = {}) {
  if (!options.db) throw new Error('Configured API runtime requires db');
  const userId = options.userId
    ? userAiConfigService.requireUserId(options.userId)
    : null;
  if (!userId && tableExists(options.db, 'user_ai_configs')) {
    userAiConfigService.requireUserId(userId);
  }
  let databaseRuntimes = runtimes.get(options.db);
  if (!databaseRuntimes) {
    databaseRuntimes = new Map();
    runtimes.set(options.db, databaseRuntimes);
  }
  const runtimeKey = userId || '__legacy__';
  let runtime = databaseRuntimes.get(runtimeKey);
  if (!runtime) {
    runtime = new ConfiguredApiRuntime({ ...options, userId });
    databaseRuntimes.set(runtimeKey, runtime);
  }
  return runtime;
}

module.exports = {
  ConfiguredApiRuntime,
  getConfiguredApiRuntime,
  schemaErrors,
  parseStructuredText,
};
