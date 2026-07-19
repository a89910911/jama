const response = require('../response');
const authService = require('../services/authService');

function cookieOptions(req) {
  const forwardedProto = String(req.headers?.['x-forwarded-proto'] || '');
  return {
    httpOnly: true,
    sameSite: 'lax',
    secure: Boolean(req.secure) || forwardedProto === 'https',
    path: '/',
    maxAge: authService.TOKEN_TTL_SECONDS * 1000,
  };
}

function authRoutes(db, log) {
  // setupRouter 也会被部分“仅检查路由注册”的测试用伪数据库调用。
  if (typeof db?.exec === 'function' && typeof db?.prepare === 'function') {
    authService.ensureAuthSystem(db);
  }

  return {
    login(req, res) {
      const username = String(req.body?.username || '').trim();
      const password = String(req.body?.password || '');
      const user = authService.findUserByUsername(db, username);
      if (!user || !user.is_active || !authService.verifyPassword(password, user.password_hash)) {
        return response.error(res, 401, 'INVALID_CREDENTIALS', '账号或密码错误');
      }

      const loginAt = new Date().toISOString();
      db.prepare(`
        UPDATE user_accounts
        SET last_login_at = ?, updated_at = ?
        WHERE id = ?
      `).run(loginAt, loginAt, user.id);
      const refreshed = authService.getAccount(db, user.id);
      const token = authService.issueToken(db, refreshed);
      res.cookie('auth_token', token, cookieOptions(req));
      log.info('Account logged in', { username: refreshed.username });
      return response.success(res, { user: authService.publicUser(refreshed) });
    },

    logout(req, res) {
      res.clearCookie('auth_token', { path: '/' });
      return response.success(res, { message: '已退出登录' });
    },

    me(req, res) {
      return response.success(res, { user: req.user });
    },

    changePassword(req, res) {
      try {
        authService.changeOwnPassword(
          db,
          req.user.id,
          req.body?.current_password,
          req.body?.new_password
        );
        res.clearCookie('auth_token', { path: '/' });
        return response.success(res, { message: '密码已修改，请重新登录' });
      } catch (err) {
        return response.badRequest(res, err.message);
      }
    },

    listAccounts(req, res) {
      return response.success(res, { items: authService.listAccounts(db) });
    },

    createAccount(req, res) {
      try {
        const user = authService.createAccount(db, req.body?.username, req.body?.password);
        log.info('Account created', { username: user.username, operator: req.user.username });
        return response.created(res, { user });
      } catch (err) {
        return response.badRequest(res, err.message);
      }
    },

    updateAccount(req, res) {
      try {
        if (typeof req.body?.is_active !== 'boolean') {
          return response.badRequest(res, '请提供 is_active');
        }
        const user = authService.setAccountActive(db, req.params.id, req.body.is_active);
        return response.success(res, { user });
      } catch (err) {
        if (err.message === '账号不存在') return response.notFound(res, err.message);
        return response.badRequest(res, err.message);
      }
    },

    resetPassword(req, res) {
      try {
        const user = authService.resetAccountPassword(
          db,
          req.params.id,
          req.body?.password
        );
        return response.success(res, { user, message: '密码已重置' });
      } catch (err) {
        if (err.message === '账号不存在') return response.notFound(res, err.message);
        return response.badRequest(res, err.message);
      }
    },

    deleteAccount(req, res) {
      try {
        authService.deleteAccount(db, req.params.id);
        return response.success(res, { message: '账号已删除' });
      } catch (err) {
        if (err.message === '账号不存在') return response.notFound(res, err.message);
        return response.badRequest(res, err.message);
      }
    },
  };
}

module.exports = authRoutes;
