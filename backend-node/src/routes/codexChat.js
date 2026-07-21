const response = require('../response');
const codexChatService = require('../services/codexChatService');
const { codexChatEventBus } = require('../services/codexChatEventBus');
const { getCodexRuntime } = require('../integrations/codex/codexRuntimeManager');

module.exports = function codexChatRoutes(db, cfg, log) {
  return {
    status: async (req, res) => {
      const runtime = getCodexRuntime({ log });
      try {
        await runtime.ensureReady();
        response.success(res, runtime.status());
      } catch (error) {
        response.success(res, { ...runtime.status(), available: false, error: error.message });
      }
    },

    createSession: (req, res) => {
      try {
        const session = codexChatService.createSession(db, {
          drama_id: req.params.drama_id,
          episode_id: req.body?.episode_id,
          title: req.body?.title,
          user_id: req.user?.id,
        });
        response.created(res, session);
      } catch (error) {
        if (error.code === 'NOT_FOUND') return response.notFound(res, error.message);
        if (error.code === 'BAD_REQUEST') return response.badRequest(res, error.message);
        log.error('Create Codex chat session failed', { error: error.message });
        response.internalError(res, error.message);
      }
    },

    listSessions: (req, res) => {
      try {
        response.success(res, codexChatService.listSessions(
          db,
          req.params.drama_id,
          req.user?.id,
          req.query.episode_id
        ));
      } catch (error) {
        response.internalError(res, error.message);
      }
    },

    listMessages: (req, res) => {
      const session = codexChatService.getSession(db, req.params.session_id, req.user?.id);
      if (!session) return response.notFound(res, 'AI 对话不存在');
      response.success(res, codexChatService.listMessages(db, session.id));
    },

    sendMessage: (req, res) => {
      try {
        const result = codexChatService.startMessage(db, cfg, log, {
          session_id: req.params.session_id,
          user_id: req.user?.id,
          content: req.body?.content,
          intent_hint: req.body?.intent_hint,
          episode_count: req.body?.episode_count,
          style: req.body?.style,
          type: req.body?.type,
          target_type: req.body?.target_type,
          target_id: req.body?.target_id,
          frame_type: req.body?.frame_type,
          asset_name: req.body?.asset_name,
        });
        response.created(res, result);
      } catch (error) {
        if (error.code === 'NOT_FOUND') return response.notFound(res, error.message);
        if (error.code === 'BAD_REQUEST') return response.badRequest(res, error.message);
        if (error.code === 'CONFLICT') {
          return response.error(res, 409, 'CONFLICT', error.message);
        }
        log.error('Send Codex chat message failed', { error: error.message });
        response.internalError(res, error.message);
      }
    },

    events: (req, res) => {
      const session = codexChatService.getSession(db, req.params.session_id, req.user?.id);
      if (!session) return response.notFound(res, 'AI 对话不存在');
      res.status(200);
      res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
      res.setHeader('Cache-Control', 'no-cache, no-transform');
      res.setHeader('Connection', 'keep-alive');
      res.setHeader('X-Accel-Buffering', 'no');
      res.flushHeaders?.();
      // 立即写入首个字节，避免 Vite/反向代理一直等待首个事件而让 EventSource 误判断线。
      res.write(': connected\n\n');

      const send = (event) => {
        res.write(`id: ${event.id}\n`);
        res.write(`event: ${event.type}\n`);
        res.write(`data: ${JSON.stringify(event.data)}\n\n`);
      };
      const afterId = Number(req.headers['last-event-id'] || req.query.after || 0);
      for (const event of codexChatEventBus.listAfter(session.id, afterId)) send(event);
      const unsubscribe = codexChatEventBus.subscribe(session.id, send);
      const heartbeat = setInterval(() => res.write(': heartbeat\n\n'), 20_000);
      heartbeat.unref?.();
      req.on('close', () => {
        clearInterval(heartbeat);
        unsubscribe();
      });
    },
  };
};
