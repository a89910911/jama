const response = require('../response');
const videoService = require('../services/videoService');
const taskService = require('../services/taskService');
const { normalizeAspectRatioForApi } = require('../services/videoClient');
const { STORYBOARD_MIN_DURATION, STORYBOARD_MAX_DURATION } = require('../services/storyboardDurationPlanner');
const characterLookService = require('../services/characterLookService');
const visualContextResolver = require('../services/visualContextResolver');
const { insertRow } = require('../db/portableSql');

function routes(db, log) {
  return {
    list: (req, res) => {
      try {
        const query = { ...req.query, user_id: req.user.id };
        const { items, total, page, pageSize } = videoService.list(db, query);
        response.successWithPagination(res, items, total, page, pageSize);
      } catch (err) {
        log.error('videos list', { error: err.message });
        response.internalError(res, err.message);
      }
    },
    create: (req, res) => {
      let createdTaskId = null;
      try {
        const body = req.body || {};
        if (body.duration != null) {
          const requestedDuration = Number(body.duration);
          if (!Number.isInteger(requestedDuration)
            || requestedDuration < STORYBOARD_MIN_DURATION
            || requestedDuration > STORYBOARD_MAX_DURATION) {
            return response.badRequest(
              res,
              `视频分镜时长必须是 ${STORYBOARD_MIN_DURATION}～${STORYBOARD_MAX_DURATION} 之间的整数秒`
            );
          }
        }
        const now = new Date().toISOString();
        let dramaId = Number(body.drama_id) || 0;
        const storyboardId = body.storyboard_id != null ? Number(body.storyboard_id) : null;
        let visualContext = null;
        if (storyboardId && characterLookService.hasWardrobeTables(db)) {
          visualContext = visualContextResolver.resolveStoryboardVisualContext(
            db,
            storyboardId,
            { persist: true }
          );
          if (!visualContext) {
            return response.notFound(res, '分镜不存在');
          }
          if (dramaId && dramaId !== Number(visualContext.drama_id)) {
            return response.badRequest(res, '分镜与项目不匹配');
          }
          const blockingIssues = visualContext.warnings.filter((item) => item.level === 'error');
          if (blockingIssues.length) {
            return response.badRequest(
              res,
              blockingIssues.map((item) => item.message).join('；')
            );
          }
          dramaId = Number(visualContext.drama_id);
        }
        const provider = body.provider || 'chatfire';
        let prompt = body.prompt || '';
        const style = (body.style || '').toString().trim();
        if (style) {
          const baseLower = String(prompt || '').toLowerCase();
          const styleLower = style.toLowerCase();
          if (!baseLower.includes(styleLower)) {
            prompt = prompt ? `${prompt}. Style: ${style}` : `Style: ${style}`;
          }
        }
        const model = body.model ?? null;
        const duration = body.duration != null ? Math.round(Number(body.duration)) : null;
        // 画幅：请求体归一化（全角冒号等）后写入 DB；未传则从 drama.metadata 读取并同样归一化
        let aspectRatio = null;
        if (body.aspect_ratio != null && String(body.aspect_ratio).trim() !== '') {
          aspectRatio = normalizeAspectRatioForApi(body.aspect_ratio);
        }
        if (!aspectRatio && dramaId) {
          try {
            const dramaRow = db.prepare('SELECT metadata FROM dramas WHERE id = ? AND deleted_at IS NULL').get(dramaId);
            if (dramaRow && dramaRow.metadata) {
              const meta = typeof dramaRow.metadata === 'string' ? JSON.parse(dramaRow.metadata) : dramaRow.metadata;
              if (meta && meta.aspect_ratio) aspectRatio = normalizeAspectRatioForApi(meta.aspect_ratio);
            }
          } catch (_) {}
        }
        const resolution = body.resolution ?? null;
        const seed = body.seed != null ? Number(body.seed) : null;
        const cameraFixed = body.camera_fixed != null ? (body.camera_fixed ? 1 : 0) : null;
        const watermark = body.watermark != null ? (body.watermark ? 1 : 0) : 0;
        let imageUrl = body.image_url ?? null;
        const sourceVideoUrl = body.source_video_url ?? null;
        // 首尾帧：支持 URL 或本地路径（sxy，存到 first_frame_url / last_frame_url）
        let firstFrameUrl = body.first_frame_url ?? body.first_frame_local_path ?? null;
        let lastFrameUrl = body.last_frame_url ?? body.last_frame_local_path ?? null;
        if (storyboardId) {
          const storyboard = db.prepare(
            `SELECT first_frame_image_id, last_frame_image_id, image_url, local_path,
                    last_frame_image_url, last_frame_local_path, creation_mode
               FROM storyboards WHERE id = ? AND deleted_at IS NULL`
          ).get(storyboardId);
          if (storyboard) {
            if (storyboard.creation_mode === 'universal') {
              // 全能模式的 @图片N 只对应视觉上下文槽位；不把第一张素材误当首帧再重复注入。
              firstFrameUrl = null;
              lastFrameUrl = null;
            } else {
              firstFrameUrl = storyboard.local_path || storyboard.image_url || firstFrameUrl;
              lastFrameUrl = storyboard.last_frame_local_path
                || storyboard.last_frame_image_url
                || lastFrameUrl;
              imageUrl = firstFrameUrl || imageUrl;
            }
          }
        }
        // 多图模式：sxy，存 JSON 数组到 reference_image_urls
        let referenceUrls = Array.isArray(body.reference_image_urls)
          ? body.reference_image_urls.slice(0, 10)
          : [];
        if (visualContext) {
          const frameSlots = [];
          if (firstFrameUrl) {
            frameSlots.push({
              index: 1,
              kind: 'first_frame',
              id: storyboardId,
              name: '分镜首帧',
              url: firstFrameUrl,
            });
          }
          const appearanceSlots = visualContext.reference_slots.map((slot) => ({ ...slot }));
          const lastFrameSlots = lastFrameUrl
            ? [{
              kind: 'last_frame',
              id: storyboardId,
              name: '分镜尾帧',
              url: lastFrameUrl,
            }]
            : [];
          visualContext.reference_slots = [...frameSlots, ...appearanceSlots, ...lastFrameSlots]
            .map((slot, index) => ({ ...slot, index: index + 1 }));
          referenceUrls = visualContext.reference_slots.map((slot) => slot.url).filter(Boolean);
          if (!firstFrameUrl) imageUrl = referenceUrls[0] || imageUrl;
        }
        const refImagesJson = referenceUrls.length ? JSON.stringify(referenceUrls) : null;
        const appearanceContextJson = visualContext ? JSON.stringify(visualContext) : null;
        const appearanceContextHash = visualContext?.appearance_context_hash || null;
        const generationContextHash = visualContext
          ? visualContextResolver.generationContextHash(appearanceContextHash, {
            ...body,
            prompt,
            duration,
            aspect_ratio: aspectRatio,
            reference_urls: referenceUrls,
          })
          : null;
        const voiceCharacterId = body.voice_character_id != null
          ? Number(body.voice_character_id)
          : null;
        if (voiceCharacterId && visualContext
          && !visualContext.characters.some((item) => item.character_id === voiceCharacterId)) {
          return response.badRequest(res, '配音角色必须属于当前分镜角色名单');
        }
        const selectedConfig = require('../services/videoClient').getDefaultVideoConfig(
          db,
          model,
          'video_generation',
          req.user.id
        );
        if (!selectedConfig) {
          return response.badRequest(res, '当前账号尚未配置可用的视频 AI 服务');
        }
        const task = taskService.createTask(
          db,
          log,
          'video_generation',
          String(dramaId || ''),
          req.user.id
        );
        createdTaskId = task.id;
        const insertInfo = insertRow(db, 'video_generations', {
          drama_id: dramaId,
          storyboard_id: storyboardId,
          provider,
          prompt,
          model,
          duration,
          aspect_ratio: aspectRatio,
          resolution,
          seed,
          camera_fixed: cameraFixed,
          watermark,
          image_url: imageUrl,
          source_video_url: sourceVideoUrl,
          first_frame_url: firstFrameUrl,
          last_frame_url: lastFrameUrl,
          reference_image_urls: refImagesJson,
          status: 'processing',
          task_id: task.id,
          appearance_context_json: appearanceContextJson,
          appearance_context_hash: appearanceContextHash,
          generation_context_hash: generationContextHash,
          voice_character_id: voiceCharacterId,
          requested_by_user_id: req.user.id,
          ai_config_id: selectedConfig.id,
          ai_config_revision_id: selectedConfig.revision_id,
          created_at: now,
          updated_at: now,
        });
        const videoGenId = insertInfo.lastInsertRowid;
        if (storyboardId) {
          try {
            db.prepare(
              'UPDATE storyboards SET current_video_generation_id = ?, updated_at = ? WHERE id = ?'
            ).run(videoGenId, now, storyboardId);
          } catch (_) {}
        }
        setImmediate(() => {
          videoService.processVideoGeneration(db, log, videoGenId);
        });
        const item = videoService.getById(db, videoGenId, req.user.id);
        response.created(res, item || { id: videoGenId, task_id: task.id, status: 'processing' });
      } catch (err) {
        if (createdTaskId) {
          try {
            taskService.updateTaskError(
              db,
              createdTaskId,
              `视频生成记录创建失败：${err.message}`
            );
          } catch (taskErr) {
            log.error('Failed to close video task after create error', {
              task_id: createdTaskId,
              error: taskErr.message,
            });
          }
        }
        log.error('videos create', { error: err.message });
        response.internalError(res, err.message);
      }
    },
    get: (req, res) => {
      try {
        const item = videoService.getById(db, req.params.id, req.user.id);
        if (!item) return response.notFound(res, '记录不存在');
        response.success(res, item);
      } catch (err) {
        log.error('videos get', { error: err.message });
        response.internalError(res, err.message);
      }
    },
    delete: (req, res) => {
      try {
        const ok = videoService.deleteById(db, log, req.params.id, req.user.id);
        if (!ok) return response.notFound(res, '记录不存在');
        response.success(res, { message: '删除成功' });
      } catch (err) {
        log.error('videos delete', { error: err.message });
        response.internalError(res, err.message);
      }
    },
    fromImage: (req, res) => {
      try {
        const task = taskService.createTask(db, log, 'video_generation', req.params.image_gen_id);
        response.success(res, { task_id: task.id });
      } catch (err) {
        log.error('videos fromImage', { error: err.message });
        response.internalError(res, err.message);
      }
    },
    episodeBatch: (req, res) => {
      try {
        response.success(res, []);
      } catch (err) {
        log.error('videos episode batch', { error: err.message });
        response.internalError(res, err.message);
      }
    },
  };
}

module.exports = routes;
