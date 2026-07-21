const express = require('express');
const response = require('../response');
const dramaRoutes = require('./drama');
const taskRoutes = require('./task');
const settingsRoutes = require('./settings');
const aiConfigRoutes = require('./aiConfig');
const propRoutes = require('./prop');
const stubRoutes = require('./stub');
const characterLibraryRoutes = require('./characterLibrary');
const sceneLibraryRoutes = require('./sceneLibrary');
const propLibraryRoutes = require('./propLibrary');
const characterRoutes = require('./characters');
const uploadModule = require('./upload');
const sceneRoutes = require('./scenes');
const storyboardRoutes = require('./storyboards');
const tailFrameLinkRoutes = require('./storyboards_tail_link');
const imageRoutes = require('./images');
const videoRoutes = require('./videos');
const episodeMediaRoutes = require('./episodeMedia');
const videoMergeRoutes = require('./videoMerges');
const assetRoutes = require('./assets');
const audioRoutes = require('./audio');
const promptRoutes = require('./prompts');
const sceneModelMapRoutes = require('./sceneModelMap');
const authRoutes = require('./auth');
const authService = require('../services/authService');
const aiRequestRoutes = require('./aiRequests');
const aiRequestLogService = require('../services/aiRequestLogService');
const codexChatRoutes = require('./codexChat');

function setupRouter(cfg, db, log) {
  const r = express.Router();
  const auth = authRoutes(db, log);
  const drama = dramaRoutes(db, cfg, log);
  const task = taskRoutes(db, log);
  const settings = settingsRoutes(db, cfg, log);
  const aiConfig = aiConfigRoutes(db, log, cfg);
  const prop = propRoutes(db, log, cfg);
  const stub = stubRoutes(db, cfg, log);
  const sceneModelMap = sceneModelMapRoutes(db, log);
  
  const uploadService = require('../services/uploadService');
  const charLibrary = characterLibraryRoutes(db, cfg, log);
  const sceneLibrary = sceneLibraryRoutes(db, cfg, log);
  const propLibrary = propLibraryRoutes(db, cfg, log);
  const characters = characterRoutes(db, cfg, log, uploadService);
  const uploadHandlers = uploadModule.routes(cfg, log, db);
  const scenes = sceneRoutes(db, log, cfg);
  const storyboards = storyboardRoutes(db, log);
  const tailFrameLink = tailFrameLinkRoutes(db, cfg, log);
  const images = imageRoutes(db, cfg, log);
  const videos = videoRoutes(db, log);
  const episodeMedia = episodeMediaRoutes(db, log);
  const videoMerges = videoMergeRoutes(db, log);
  const assets = assetRoutes(db, log);
  const audio = audioRoutes(db, log, cfg);
  const prompts = promptRoutes.routes(db, log);
  const aiRequests = aiRequestRoutes(db, log);
  const codexChat = codexChatRoutes(db, cfg, log);

  // ---------- authentication ----------
  // 登录是唯一公开 API；其余业务接口都必须具有有效登录会话。
  r.post('/auth/login', auth.login);
  r.use(authService.authenticate(db));
  r.use(aiRequestLogService.requestContextMiddleware);
  r.post('/auth/logout', auth.logout);
  r.get('/auth/me', auth.me);
  r.put('/auth/password', auth.changePassword);

  // ---------- account management (zhangzexing only) ----------
  r.get('/accounts', authService.requireSuperAdmin, auth.listAccounts);
  r.post('/accounts', authService.requireSuperAdmin, auth.createAccount);
  r.put('/accounts/:id', authService.requireSuperAdmin, auth.updateAccount);
  r.put('/accounts/:id/password', authService.requireSuperAdmin, auth.resetPassword);
  r.delete('/accounts/:id', authService.requireSuperAdmin, auth.deleteAccount);

  // ---------- dramas ----------
  r.get('/dramas', drama.listDramas);
  r.post('/dramas', drama.createDrama);
  r.get('/dramas/stats', drama.getDramaStats);
  // 导出/导入（放在 :id 路由前，避免被 :id 捕获）
  r.get('/dramas/:id/export', drama.exportDrama);
  r.get('/dramas/:id/assets/export', drama.exportAssets);
  const multer = require('multer');
  const importUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 500 * 1024 * 1024 } });
  const holyCrabAssetUpload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 200 * 1024 * 1024 },
  });
  const holyCrabAssetSingle = holyCrabAssetUpload.single('file');
  r.post('/dramas/import', importUpload.single('file'), drama.importDrama);
  r.post('/dramas/import-novel', importUpload.single('file'), async (req, res) => {
    try {
      const novelImportService = require('../services/novelImportService');
      let text = '';
      if (req.file && req.file.buffer) {
        text = req.file.buffer.toString('utf8');
      } else if (req.body && req.body.text) {
        text = req.body.text;
      }
      if (!text.trim()) return response.badRequest(res, '请上传小说文本文件或提供 text 参数');
      const title = req.body?.title || '';
      const maxChapters = Number(req.body?.max_chapters) || 20;
      const aiSummarize = req.body?.ai_summarize === 'true' || req.body?.ai_summarize === true;
      const result = await novelImportService.importNovel(db, log, { text, title, maxChapters, aiSummarize });
      response.success(res, result);
    } catch (err) {
      log.error('dramas import-novel', { error: err.message });
      response.internalError(res, err.message);
    }
  });
  r.get('/dramas/examples', drama.listExamples);
  r.post('/dramas/import-example', drama.importExample);
  r.put('/dramas/:id/outline', drama.saveOutline);
  r.get('/dramas/:id/characters', drama.getCharacters);
  r.put('/dramas/:id/characters', drama.saveCharacters);
  r.put('/dramas/:id/episodes', drama.saveEpisodes);
  r.put('/dramas/:id/progress', drama.saveProgress);
  r.put('/dramas/:id/canvas-layout', drama.saveCanvasLayout);
  r.get('/dramas/:id/props', drama.listProps);
  r.get('/dramas/:id/scenes', scenes.listByDrama);
  r.get('/dramas/:drama_id/prompts', prompts.listProject);
  r.get('/dramas/:drama_id/prompts/:key', prompts.getProject);
  r.put('/dramas/:drama_id/prompts/:key', prompts.updateProject);
  r.delete('/dramas/:drama_id/prompts/:key', prompts.deleteProject);
  r.post('/dramas/:drama_id/prompts/:key/preview', prompts.previewProject);
  r.get('/dramas/:drama_id/ai-requests/stats', aiRequests.stats);
  r.get('/dramas/:drama_id/ai-requests', aiRequests.list);
  r.delete('/dramas/:drama_id/ai-requests', aiRequests.clear);
  r.get('/dramas/:drama_id/ai-requests/:request_id', aiRequests.get);
  r.delete('/dramas/:drama_id/ai-requests/:request_id', aiRequests.remove);
  r.get('/dramas/:drama_id/ai-chat/sessions', codexChat.listSessions);
  r.post('/dramas/:drama_id/ai-chat/sessions', codexChat.createSession);
  r.get('/dramas/:id', drama.getDrama);
  r.put('/dramas/:id', drama.updateDrama);
  r.delete('/dramas/:id', drama.deleteDrama);

  // ---------- ai-configs ----------
  // 普通账号仅可读取运行时所需的非敏感模型能力，不能查看 AI 配置本身。
  r.get('/ai-requests/stats', authService.requireSuperAdmin, aiRequests.systemStats);
  r.get('/ai-requests', authService.requireSuperAdmin, aiRequests.systemList);
  r.delete('/ai-requests', authService.requireSuperAdmin, aiRequests.systemClear);
  r.get('/ai-requests/:request_id', authService.requireSuperAdmin, aiRequests.systemGet);
  r.delete('/ai-requests/:request_id', authService.requireSuperAdmin, aiRequests.systemRemove);
  r.get('/ai-configs/vendor-lock', aiConfig.vendorLock);  // 必须在 /:id 之前
  r.get('/runtime/ai-configs', (req, res) => {
    const serviceType = String(req.query.service_type || '').trim();
    const allowedTypes = new Set(['text', 'image', 'storyboard_image', 'video', 'tts']);
    if (!allowedTypes.has(serviceType)) {
      return response.badRequest(res, 'service_type 不支持');
    }
    const aiConfigService = require('../services/aiConfigService');
    const items = aiConfigService.listConfigs(db, serviceType).map((item) => ({
      id: item.id,
      service_type: item.service_type,
      provider: item.provider,
      name: item.name,
      api_protocol: item.api_protocol,
      model: item.model,
      default_model: item.default_model,
      priority: item.priority,
      is_default: item.is_default,
      is_active: item.is_active,
    }));
    return response.success(res, items);
  });
  r.get('/ai-configs', authService.requireSuperAdmin, aiConfig.list);
  r.post('/ai-configs', authService.requireSuperAdmin, aiConfig.create);
  r.post('/ai-configs/test', authService.requireSuperAdmin, aiConfig.testConnection);
  r.post('/ai-configs/jimeng2-list-assets', authService.requireSuperAdmin, aiConfig.listJimeng2MaterialAssets);
  r.post('/ai-configs/model-ark-asset', authService.requireSuperAdmin, aiConfig.modelArkAsset);
  r.post('/ai-configs/holycrab-assets', authService.requireSuperAdmin, aiConfig.holyCrabAssets);
  r.get('/ai-configs/holycrab-assets/:configId/:uniqId/content', authService.requireSuperAdmin, aiConfig.holyCrabAssetContent);
  r.post('/ai-configs/holycrab-assets/upload', authService.requireSuperAdmin, (req, res, next) => {
    holyCrabAssetSingle(req, res, (err) => {
      if (err?.code === 'LIMIT_FILE_SIZE') {
        return response.error(res, 413, 'FILE_TOO_LARGE', 'HolyCrab 单个素材不能超过 200MB');
      }
      if (err) return next(err);
      return aiConfig.holyCrabAssets(req, res);
    });
  });
  r.put('/ai-configs/bulk-update-key', authService.requireSuperAdmin, aiConfig.bulkUpdateKey);  // 必须在 /:id 之前
  r.get('/ai-configs/:id', authService.requireSuperAdmin, aiConfig.get);
  r.put('/ai-configs/:id', authService.requireSuperAdmin, aiConfig.update);
  r.delete('/ai-configs/:id', authService.requireSuperAdmin, aiConfig.delete);

  // ---------- generation (角色生成：AI + 入库 + 任务结果) ----------
  r.post('/generation/characters', (req, res) => {
    const characterGenerationService = require('../services/characterGenerationService');
    try {
      const body = req.body || {};
      if (!body.drama_id) {
        return response.badRequest(res, 'drama_id 必填');
      }
      const taskId = characterGenerationService.generateCharacters(db, cfg, log, body);
      response.success(res, { task_id: taskId, status: 'pending' });
    } catch (err) {
      log.error('generation/characters', { error: err.message });
      response.internalError(res, err.message || '创建任务失败');
    }
  });

  // 故事生成：带 drama_id 时异步生成并入库；否则同步返回 episodes（兼容旧调用）
  r.post('/generation/story', async (req, res) => {
    const storyGenerationService = require('../services/storyGenerationService');
    try {
      const body = req.body || {};
      if (body.drama_id) {
        const taskId = storyGenerationService.startStoryGeneration(db, log, body);
        return response.success(res, { task_id: taskId, status: 'pending' });
      }
      const result = await storyGenerationService.generateStory(db, log, body);
      response.success(res, result);
    } catch (err) {
      log.error('generation/story', { error: err.message });
      if (err.message && (err.message.includes('未配置') || err.message.includes('必填') || err.message.includes('不存在'))) {
        return response.badRequest(res, err.message);
      }
      response.internalError(res, err.message || '故事生成失败');
    }
  });

  // ---------- character-library ----------
  r.get('/character-library', charLibrary.list);
  r.post('/character-library', charLibrary.create);
  r.get('/character-library/:id', charLibrary.get);
  r.put('/character-library/:id', charLibrary.update);
  r.delete('/character-library/:id', charLibrary.delete);

  // ---------- scene-library ----------
  r.get('/scene-library', sceneLibrary.list);
  r.post('/scene-library', sceneLibrary.create);
  r.get('/scene-library/:id', sceneLibrary.get);
  r.put('/scene-library/:id', sceneLibrary.update);
  r.delete('/scene-library/:id', sceneLibrary.delete);

  // ---------- prop-library ----------
  r.get('/prop-library', propLibrary.list);
  r.post('/prop-library', propLibrary.create);
  r.get('/prop-library/:id', propLibrary.get);
  r.put('/prop-library/:id', propLibrary.update);
  r.delete('/prop-library/:id', propLibrary.delete);

  // ---------- characters ----------
  r.get('/characters/:id', characters.getOne);
  r.put('/characters/:id', characters.update);
  r.delete('/characters/:id', characters.delete);
  r.post('/characters/batch-generate-images', characters.batchGenerateImages);
  r.post('/characters/:id/generate-image', characters.generateImage);
  r.post('/characters/:id/generate-four-view-image', characters.generateFourViewImage);
  r.post('/characters/:id/generate-prompt', characters.generatePrompt);
  r.post('/characters/:id/upload-image', uploadModule.multerSingle, characters.uploadImage);
  r.put('/characters/:id/image', characters.putImage);
  r.put('/characters/:id/image-from-library', characters.imageFromLibrary);
  r.post('/characters/:id/add-to-library', characters.addToLibrary);
  r.post('/characters/:id/add-to-material-library', characters.addToMaterialLibrary);
  r.post('/characters/:id/sd2-certify', characters.sd2Certify);
  r.post('/characters/:id/sd2-certify/refresh', characters.sd2CertifyRefresh);
  r.post('/characters/:id/sd2-voice-upload', uploadModule.multerAudioSingle, characters.sd2VoiceUpload);
  r.post('/characters/:id/sd2-voice-refresh', characters.sd2VoiceRefresh);
  r.post('/characters/:id/extract-from-image', characters.extractFromImage);
  r.post('/characters/:id/extract-anchors', characters.extractAnchors);

  // ---------- props ----------
  r.get('/props/:id', prop.getPropById);
  r.post('/props', prop.createProp);
  r.put('/props/:id', prop.updateProp);
  r.delete('/props/:id', prop.deleteProp);
  r.post('/props/:id/generate', prop.generateImage);
  r.post('/props/:id/generate-prompt', prop.generatePropPrompt);
  r.post('/props/:id/add-to-library', prop.addToLibrary);
  r.post('/props/:id/add-to-material-library', prop.addToMaterialLibrary);
  r.post('/props/:id/extract-from-image', prop.extractPropFromImage);

  // ---------- vision: 从图片提取描述（不依赖已有实体 ID）----------
  r.post('/extract-description-from-image', async (req, res) => {
    const { image_url, entity_type, entity_name } = req.body || {};
    if (!image_url) return response.badRequest(res, '缺少 image_url');
    if (!['character', 'scene', 'prop'].includes(entity_type)) return response.badRequest(res, 'entity_type 需为 character/scene/prop');
    try {
      const { extractDescriptionFromImage } = require('../services/aiClient');
      const out = await extractDescriptionFromImage(db, log, entity_type, image_url, entity_name);
      if (!out.ok) return response.badRequest(res, out.error);
      response.success(res, { description: out.description });
    } catch (err) {
      log.error('extract-description-from-image', { error: err.message });
      response.internalError(res, err.message);
    }
  });

  // ---------- upload ----------
  r.post('/upload/image', uploadModule.multerSingle, uploadHandlers.uploadImage);

  // ---------- episodes ----------
  // 注意：drama.generateStoryboard 已处理所有逻辑（包括参数解析），这里统一使用 drama 模块的实现
  // 之前可能有部分路由指向了 storyboards.episodeStoryboardsGenerate，这可能导致参数解析不一致
  r.post('/episodes/:episode_id/storyboards', drama.generateStoryboard);
  r.post('/episodes/:episode_id/props/extract', prop.extractProps);
  r.post('/episodes/:episode_id/characters/extract', stub.episodeCharactersExtract);
  r.get('/episodes/:episode_id/storyboards', storyboards.episodeStoryboardsGet);
  r.get('/episodes/:episode_id/media', episodeMedia.get);
  r.post('/episodes/:episode_id/finalize', drama.finalizeEpisode);
  r.get('/episodes/:episode_id/download', drama.downloadEpisodeVideo);

  // ---------- tasks ----------
  r.get('/tasks/:task_id', task.getTaskStatus);
  r.post('/tasks/:task_id/cancel', task.cancelTaskStatus);
  r.get('/tasks', task.getResourceTasks);

  // ---------- Codex AI chat ----------
  r.get('/codex/status', codexChat.status);
  r.get('/ai-chat/sessions/:session_id/messages', codexChat.listMessages);
  r.post('/ai-chat/sessions/:session_id/messages', codexChat.sendMessage);
  r.get('/ai-chat/sessions/:session_id/events', codexChat.events);

  // ---------- scenes ----------
  r.get('/scenes/:scene_id', scenes.getOne);
  r.post('/scenes/:scene_id/generate-prompt', scenes.generatePrompt);
  r.put('/scenes/:scene_id', scenes.update);
  r.put('/scenes/:scene_id/prompt', scenes.updatePrompt);
  r.delete('/scenes/:scene_id', scenes.delete);
  r.post('/scenes/generate-image', scenes.generateImage);
  r.post('/scenes', scenes.create);
  r.post('/scenes/:scene_id/generate-four-view-image', scenes.generateFourViewImage);
  r.post('/scenes/:scene_id/add-to-library', scenes.addToLibrary);
  r.post('/scenes/:scene_id/add-to-material-library', scenes.addToMaterialLibrary);
  r.post('/scenes/:scene_id/extract-from-image', scenes.extractFromImage);

  // ---------- images ----------
  r.get('/images', images.list);
  r.post('/images', images.create);
  r.get('/images/episode/:episode_id/backgrounds', images.episodeBackgrounds);
  r.post('/images/episode/:episode_id/backgrounds/extract', images.episodeBackgroundsExtract);
  r.post('/images/episode/:episode_id/batch', images.episodeBatch);
  r.post('/images/scene/:scene_id', images.scene);
  r.post('/images/upload', images.upload);
  r.get('/images/:id', images.get);
  r.delete('/images/:id', images.delete);

  // ---------- videos ----------
  r.get('/videos', videos.list);
  r.post('/videos', videos.create);
  r.post('/videos/image/:image_gen_id', videos.fromImage);
  r.post('/videos/episode/:episode_id/batch', videos.episodeBatch);
  r.get('/videos/:id', videos.get);
  r.delete('/videos/:id', videos.delete);

  // ---------- video-merges ----------
  r.get('/video-merges', videoMerges.list);
  r.post('/video-merges', videoMerges.create);
  r.get('/video-merges/:merge_id', videoMerges.get);
  r.delete('/video-merges/:merge_id', videoMerges.delete);

  // ---------- assets ----------
  r.get('/assets', assets.list);
  r.post('/assets', assets.create);
  r.post('/assets/import/image/:image_gen_id', assets.importImage);
  r.post('/assets/import/video/:video_gen_id', assets.importVideo);
  r.get('/assets/:id', assets.get);
  r.put('/assets/:id', assets.update);
  r.delete('/assets/:id', assets.delete);

  // ---------- storyboards ----------
  r.get('/storyboards/episode/:episode_id/generate', storyboards.episodeStoryboardsGenerate);
  r.post('/storyboards', storyboards.create);
  r.post('/storyboards/:id/insert-before', storyboards.insertBefore);
  r.get('/storyboards/:id', storyboards.getOne);
  r.put('/storyboards/:id', storyboards.update);
  r.delete('/storyboards/:id', storyboards.delete);
  r.post('/storyboards/:id/props', prop.associateProps);
  r.post('/storyboards/:id/frame-prompt', storyboards.framePrompt);
  r.get('/storyboards/:id/frame-prompts', storyboards.framePromptsGet);
  r.put('/storyboards/:id/frame-prompts/:frame_type', storyboards.framePromptSave);
  r.post('/storyboards/:id/link-tail-frame', tailFrameLink.linkTailFrame);
  r.post('/storyboards/:id/polish-prompt', storyboards.polishPrompt);
  r.post('/storyboards/:id/universal-segment-polish-stream', storyboards.polishUniversalSegmentStream);
  r.post('/storyboards/:id/classic-video-prompt-polish-stream', storyboards.polishClassicVideoPromptStream);
  r.post('/storyboards/:id/universal-segment-prompt-stream', storyboards.generateUniversalSegmentStream);
  r.post('/storyboards/:id/universal-segment-prompt', storyboards.generateUniversalSegmentPrompt);
  r.post('/storyboards/batch-infer-params', storyboards.batchInferParams);
  r.post('/storyboards/:id/upscale', storyboards.upscale);
  r.post('/storyboards/:id/regenerate-layout-description', storyboards.regenerateLayoutDescription);
  r.post('/storyboards/:id/rebuild-video-prompt', storyboards.rebuildVideoPrompt);
  r.post('/storyboards/:id/split-by-audio', storyboards.splitByAudio);

  // ---------- audio ----------
  r.post('/audio/extract', audio.extract);
  r.post('/audio/extract/batch', audio.extractBatch);

  // ---------- settings ----------
  r.get('/settings/generation', settings.getGenerationSettings);
  r.put('/settings/generation', authService.requireSuperAdmin, settings.updateGenerationSettings);

  // ---------- prompt templates ----------
  r.get('/settings/prompts', authService.requireSuperAdmin, prompts.listSystem);
  r.get('/settings/prompts/:key', authService.requireSuperAdmin, prompts.getSystem);
  r.put('/settings/prompts/:key', authService.requireSuperAdmin, prompts.updateSystem);
  r.post('/settings/prompts/:key/reset-seed', authService.requireSuperAdmin, prompts.resetSystem);
  r.post('/settings/prompts/:key/preview', authService.requireSuperAdmin, prompts.previewSystem);
  // 兼容旧前端：DELETE 等价于恢复系统出厂默认
  r.delete('/settings/prompts/:key', authService.requireSuperAdmin, prompts.resetSystem);

  // ---------- scene model map ----------
  r.get('/scene-model-map', authService.requireSuperAdmin, sceneModelMap.list);
  r.get('/scene-model-map-definitions', authService.requireSuperAdmin, sceneModelMap.definitions);
  r.get('/business-scenes/overview', authService.requireSuperAdmin, sceneModelMap.overview);
  r.post('/scene-model-map', authService.requireSuperAdmin, sceneModelMap.create);
  r.get('/scene-model-map/:key', authService.requireSuperAdmin, sceneModelMap.get);
  r.put('/scene-model-map/:key', authService.requireSuperAdmin, sceneModelMap.update);
  r.delete('/scene-model-map/:key', authService.requireSuperAdmin, sceneModelMap.delete);

  return r;
}

module.exports = { setupRouter };
