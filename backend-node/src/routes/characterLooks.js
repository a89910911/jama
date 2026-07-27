const response = require('../response');
const characterLookService = require('../services/characterLookService');
const bindingService = require('../services/characterLookBindingService');
const visualContextResolver = require('../services/visualContextResolver');
const characterLibraryService = require('../services/characterLibraryService');
const uploadService = require('../services/uploadService');
const storageLayout = require('../services/storageLayout');
const path = require('path');

function sendServiceError(res, out) {
  if (out?.conflict) {
    return response.error(
      res,
      409,
      out.error === 'look revision conflict' ? 'LOOK_REVISION_CONFLICT' : 'LOOK_DEPENDENCY_CONFLICT',
      out.error,
      out.current || out.dependencies || null
    );
  }
  if (['character not found', 'look not found', 'scope not found', 'binding not found'].includes(out?.error)) {
    return response.notFound(res, out.error);
  }
  return response.badRequest(res, out?.error || '衣橱操作失败');
}

function compactLook(look) {
  if (!look) return null;
  return {
    id: look.id,
    drama_id: look.drama_id,
    character_id: look.character_id,
    name: look.name,
    category: look.category,
    image_url: look.image_url,
    local_path: look.local_path,
    visual_revision: look.visual_revision,
    status: look.status,
    is_default: look.is_default,
  };
}

function compactVisualContext(context) {
  return {
    schema_version: context.schema_version,
    drama_id: context.drama_id,
    episode_id: context.episode_id,
    storyboard_id: context.storyboard_id,
    scene_block_id: context.scene_block_id,
    characters: (context.characters || []).map((item) => ({
      character_id: item.character_id,
      character_name: item.character_name,
      look: compactLook(item.look),
      binding: item.binding,
      binding_source: item.binding_source,
      reference_url: item.reference_url,
      warnings: item.warnings || [],
    })),
    warnings: context.warnings || [],
    appearance_context_hash: context.appearance_context_hash,
    stale: context.stale,
  };
}

function routes(db, cfg, log) {
  return {
    list: (req, res) => {
      try {
        const characterId = Number(req.params.character_id);
        const listOptions = {
          includeArchived: req.query.include_archived === '1',
        };
        const currentLooks = characterLookService.listLooks(
          db,
          characterId,
          listOptions
        );
        if (currentLooks.length) {
          return response.success(res, { items: currentLooks });
        }
        const character = db.prepare(
          'SELECT id, default_look_id FROM characters WHERE id = ? AND deleted_at IS NULL'
        ).get(characterId);
        if (!character) return response.notFound(res, '角色不存在');
        if (!character.default_look_id) {
          characterLookService.ensureDefaultLook(db, character.id);
        }
        response.success(res, {
          items: characterLookService.listLooks(db, character.id, listOptions),
        });
      } catch (error) {
        log.error('character looks list', { error: error.message });
        response.internalError(res, error.message);
      }
    },
    create: (req, res) => {
      try {
        const out = characterLookService.createLook(
          db,
          req.params.character_id,
          req.body || {}
        );
        if (!out.ok) return sendServiceError(res, out);
        response.created(res, out);
      } catch (error) {
        log.error('character looks create', { error: error.message });
        response.internalError(res, error.message);
      }
    },
    get: (req, res) => {
      try {
        const row = characterLookService.getLookSummaryRow(db, req.params.look_id, true);
        if (!row || row.deleted_at) return response.notFound(res, '造型不存在');
        const character = db.prepare(
          'SELECT default_look_id FROM characters WHERE id = ? AND deleted_at IS NULL'
        ).get(row.character_id);
        response.success(res, {
          look: characterLookService.serializeLook(row, character?.default_look_id),
        });
      } catch (error) {
        log.error('character looks get', { error: error.message });
        response.internalError(res, error.message);
      }
    },
    update: (req, res) => {
      try {
        const out = characterLookService.updateLook(db, req.params.look_id, req.body || {});
        if (!out.ok) return sendServiceError(res, out);
        response.success(res, out);
      } catch (error) {
        log.error('character looks update', { error: error.message });
        response.internalError(res, error.message);
      }
    },
    setDefault: (req, res) => {
      try {
        const row = characterLookService.getLookRow(db, req.params.look_id);
        if (!row) return response.notFound(res, '造型不存在');
        const out = characterLookService.setDefaultLook(db, row.character_id, row.id);
        if (!out.ok) return sendServiceError(res, out);
        response.success(res, out);
      } catch (error) {
        log.error('character looks set default', { error: error.message });
        response.internalError(res, error.message);
      }
    },
    generateImage: (req, res) => {
      try {
        const out = characterLibraryService.generateCharacterLookImage(
          db,
          log,
          cfg,
          req.params.look_id,
          req.body?.model,
          req.body?.style
        );
        if (!out.ok) return sendServiceError(res, out);
        response.success(res, out);
      } catch (error) {
        log.error('character looks generate image', { error: error.message });
        response.internalError(res, error.message);
      }
    },
    uploadImage: (req, res) => {
      if (!req.file?.buffer) return response.badRequest(res, '请选择图片文件');
      try {
        const look = characterLookService.getLookRow(db, req.params.look_id);
        if (!look) return response.notFound(res, '造型不存在');
        const rawStorage = cfg?.storage?.local_path || './data/storage';
        const storagePath = path.isAbsolute(rawStorage)
          ? rawStorage
          : path.join(process.cwd(), rawStorage);
        const projectSubdir = storageLayout.getProjectStorageSubdir(db, look.drama_id);
        const uploaded = uploadService.uploadFile(
          storagePath,
          cfg?.storage?.base_url || '',
          log,
          req.file.buffer,
          req.file.originalname || 'look.png',
          req.file.mimetype,
          'character_looks',
          projectSubdir
        );
        const out = characterLookService.updateLook(db, look.id, {
          image_url: uploaded.url,
          local_path: uploaded.local_path,
          expected_revision: look.visual_revision,
        });
        if (!out.ok) return sendServiceError(res, out);
        response.success(res, { ...out, url: uploaded.url, local_path: uploaded.local_path });
      } catch (error) {
        log.error('character looks upload image', { error: error.message });
        response.internalError(res, error.message);
      }
    },
    remove: (req, res) => {
      try {
        const replacement = req.body?.replacement_look_id ?? req.query.replacement_look_id;
        const out = characterLookService.archiveLook(
          db,
          req.params.look_id,
          replacement == null || replacement === '' ? null : replacement
        );
        if (!out.ok) return sendServiceError(res, out);
        response.success(res, out);
      } catch (error) {
        log.error('character looks delete', { error: error.message });
        response.internalError(res, error.message);
      }
    },
    upsertBinding: (req, res) => {
      try {
        const out = bindingService.upsertBinding(db, req.body || {});
        if (!out.ok) return sendServiceError(res, out);
        response.success(res, out);
      } catch (error) {
        log.error('look bindings upsert', { error: error.message });
        response.internalError(res, error.message);
      }
    },
    removeBinding: (req, res) => {
      try {
        const out = bindingService.removeBinding(
          db,
          req.params.scope_type,
          req.params.scope_id,
          req.params.character_id
        );
        if (!out.ok) return sendServiceError(res, out);
        response.success(res, out);
      } catch (error) {
        log.error('look bindings delete', { error: error.message });
        response.internalError(res, error.message);
      }
    },
    episodeContext: (req, res) => {
      try {
        const episodeId = Number(req.params.episode_id);
        const episode = visualContextResolver.getEpisodeLookContext(db, episodeId);
        if (!episode) return response.notFound(res, '分集不存在');
        const sceneBlocks = episode.scene_blocks;
        const bindings = episode.bindings;
        const preflight = episode.preflight;
        response.success(res, {
          episode_id: episodeId,
          scene_blocks: sceneBlocks,
          bindings,
          required_looks: preflight?.required_looks || [],
          contexts: (preflight?.contexts || []).map(compactVisualContext),
        });
      } catch (error) {
        log.error('episode look context', { error: error.message });
        response.internalError(res, error.message);
      }
    },
    storyboardContext: (req, res) => {
      try {
        const context = visualContextResolver.resolveStoryboardVisualContext(
          db,
          req.params.storyboard_id
        );
        if (!context) return response.notFound(res, '分镜不存在');
        response.success(res, context);
      } catch (error) {
        log.error('storyboard visual context', { error: error.message });
        response.internalError(res, error.message);
      }
    },
    episodePreflight: (req, res) => {
      try {
        const report = visualContextResolver.preflightEpisode(
          db,
          req.params.episode_id,
          { persist: req.body?.persist === true }
        );
        if (!report) return response.notFound(res, '分集不存在');
        response.success(res, {
          ...report,
          contexts: (report.contexts || []).map(compactVisualContext),
        });
      } catch (error) {
        log.error('episode visual preflight', { error: error.message });
        response.internalError(res, error.message);
      }
    },
  };
}

module.exports = routes;
