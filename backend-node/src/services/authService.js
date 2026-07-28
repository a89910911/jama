const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const { upsertSql } = require('../db/portableSql');

const SUPER_ADMIN_USERNAME = 'admin';
const SUPER_ADMIN_ROLE = 'super_admin';
const PASSWORD_ITERATIONS = 210000;
const TOKEN_TTL_SECONDS = 7 * 24 * 60 * 60;
const JWT_SECRET_KEY = 'auth.jwt_secret';
const MIN_INITIAL_ADMIN_PASSWORD_LENGTH = 12;
const SESSION_ACCOUNT_CACHE_TTL_MS = 30 * 1000;
const authRuntimeByDb = new WeakMap();

function authRuntime(db) {
  if (!db || (typeof db !== 'object' && typeof db !== 'function')) return null;
  let runtime = authRuntimeByDb.get(db);
  if (!runtime) {
    runtime = { secret: '', accounts: new Map() };
    authRuntimeByDb.set(db, runtime);
  }
  return runtime;
}

function cacheAccount(db, row) {
  const runtime = authRuntime(db);
  if (runtime && row?.id != null) {
    runtime.accounts.set(Number(row.id), { row, loadedAt: Date.now() });
  }
  return row;
}

function invalidateAccountCache(db, id) {
  authRuntime(db)?.accounts.delete(Number(id));
}

function getSessionAccount(db, id) {
  const accountId = Number(id);
  const runtime = authRuntime(db);
  const cached = runtime?.accounts.get(accountId);
  if (cached && Date.now() - cached.loadedAt < SESSION_ACCOUNT_CACHE_TTL_MS) {
    return cached.row;
  }
  return cacheAccount(db, getAccount(db, accountId));
}

function nowIso() {
  return new Date().toISOString();
}

function hashPassword(password, salt = crypto.randomBytes(16).toString('hex')) {
  const value = String(password || '');
  const hash = crypto
    .pbkdf2Sync(value, salt, PASSWORD_ITERATIONS, 32, 'sha512')
    .toString('hex');
  return `pbkdf2$${PASSWORD_ITERATIONS}$${salt}$${hash}`;
}

function verifyPassword(password, storedHash) {
  const parts = String(storedHash || '').split('$');
  if (parts.length !== 4 || parts[0] !== 'pbkdf2') return false;
  const iterations = Number(parts[1]);
  const salt = parts[2];
  const expectedHex = parts[3];
  if (!Number.isInteger(iterations) || iterations < 1 || !salt || !expectedHex) return false;

  const actual = crypto
    .pbkdf2Sync(String(password || ''), salt, iterations, 32, 'sha512');
  const expected = Buffer.from(expectedHex, 'hex');
  return actual.length === expected.length && crypto.timingSafeEqual(actual, expected);
}

function publicUser(row) {
  if (!row) return null;
  return {
    id: Number(row.id),
    username: row.username,
    role: row.role,
    is_active: Boolean(row.is_active),
    is_super_admin:
      row.role === SUPER_ADMIN_ROLE &&
      String(row.username).toLowerCase() === SUPER_ADMIN_USERNAME,
    last_login_at: row.last_login_at || null,
    created_at: row.created_at || null,
    updated_at: row.updated_at || null,
  };
}

function resolveInitialAdminPassword(options = {}) {
  const env = options.env || process.env;
  const explicit = String(
    options.initialAdminPassword
      ?? env.JAMA_ADMIN_INITIAL_PASSWORD
      ?? ''
  );
  if (explicit) {
    if (
      explicit.length < MIN_INITIAL_ADMIN_PASSWORD_LENGTH
      || explicit.length > 128
      || explicit.toLowerCase() === SUPER_ADMIN_USERNAME
    ) {
      throw new Error(
        `JAMA_ADMIN_INITIAL_PASSWORD 必须为 ${MIN_INITIAL_ADMIN_PASSWORD_LENGTH}-128 位，且不能与管理员账号相同`
      );
    }
    return { password: explicit, generated: false };
  }
  return {
    password: crypto.randomBytes(24).toString('base64url'),
    generated: true,
  };
}

function ensureAuthSystem(db, options = {}) {
  if (db.dialect !== 'mysql') {
    db.exec(`
    CREATE TABLE IF NOT EXISTS user_accounts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'user',
      is_active INTEGER NOT NULL DEFAULT 1,
      token_version INTEGER NOT NULL DEFAULT 0,
      last_login_at TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE UNIQUE INDEX IF NOT EXISTS idx_user_accounts_username
      ON user_accounts(LOWER(username));
    CREATE TABLE IF NOT EXISTS global_settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL DEFAULT '',
      updated_at TEXT NOT NULL DEFAULT ''
    );
    `);
  }

  const existingAdmin = db
    .prepare('SELECT id FROM user_accounts WHERE LOWER(username) = LOWER(?)')
    .get(SUPER_ADMIN_USERNAME);
  const now = nowIso();
  let initialAdmin = null;
  if (!existingAdmin) {
    initialAdmin = resolveInitialAdminPassword(options);
    db.prepare(`
      INSERT INTO user_accounts
        (username, password_hash, role, is_active, token_version, created_at, updated_at)
      VALUES (?, ?, ?, 1, 0, ?, ?)
    `).run(
      SUPER_ADMIN_USERNAME,
      hashPassword(initialAdmin.password),
      SUPER_ADMIN_ROLE,
      now,
      now
    );
  } else {
    db.prepare(`
      UPDATE user_accounts
      SET role = ?, is_active = 1, updated_at = ?
      WHERE id = ?
    `).run(SUPER_ADMIN_ROLE, now, existingAdmin.id);
  }

  // 数据层也只允许 admin 保有最高权限。
  db.prepare(`
    UPDATE user_accounts
    SET role = 'user', updated_at = ?
    WHERE role = ? AND LOWER(username) != LOWER(?)
  `).run(now, SUPER_ADMIN_ROLE, SUPER_ADMIN_USERNAME);

  let secret = db
    .prepare('SELECT value FROM global_settings WHERE key = ?')
    .get(JWT_SECRET_KEY)?.value;
  if (!secret || secret.length < 32) {
    secret = crypto.randomBytes(48).toString('base64url');
    db.prepare(upsertSql(db, `
      INSERT INTO global_settings (key, value, updated_at)
      VALUES (?, ?, ?)
    `, ['key'], ['value', 'updated_at'])).run(JWT_SECRET_KEY, secret, now);
  }
  const runtime = authRuntime(db);
  if (runtime) {
    runtime.secret = secret;
    runtime.accounts.clear();
    const accounts = db.prepare('SELECT * FROM user_accounts').all();
    for (const account of accounts) cacheAccount(db, account);
  }
  return initialAdmin
    ? {
        created: true,
        generated: initialAdmin.generated,
        password: initialAdmin.password,
      }
    : { created: false, generated: false, password: null };
}

function getJwtSecret(db) {
  const runtime = authRuntime(db);
  if (runtime?.secret) return runtime.secret;
  let secret;
  try {
    secret = db
      .prepare('SELECT value FROM global_settings WHERE key = ?')
      .get(JWT_SECRET_KEY)?.value;
  } catch (_) {
    // 首次启动或独立测试数据库尚未初始化。
  }
  if (!secret) {
    ensureAuthSystem(db);
    secret = db
      .prepare('SELECT value FROM global_settings WHERE key = ?')
      .get(JWT_SECRET_KEY).value;
  }
  if (runtime) runtime.secret = secret;
  return secret;
}

function issueToken(db, user) {
  return jwt.sign(
    {
      sub: String(user.id),
      username: user.username,
      role: user.role,
      token_version: Number(user.token_version || 0),
    },
    getJwtSecret(db),
    {
      algorithm: 'HS256',
      expiresIn: TOKEN_TTL_SECONDS,
      issuer: 'local-mini-drama',
    }
  );
}

function findUserByUsername(db, username) {
  return db
    .prepare('SELECT * FROM user_accounts WHERE LOWER(username) = LOWER(?)')
    .get(String(username || '').trim());
}

function validateUsername(username) {
  const value = String(username || '').trim();
  if (!/^[A-Za-z0-9._-]{3,50}$/.test(value)) {
    throw new Error('账号需为 3-50 位字母、数字、点、下划线或短横线');
  }
  return value;
}

function validatePassword(password) {
  const value = String(password || '');
  if (value.length < 6 || value.length > 128) {
    throw new Error('密码长度需为 6-128 位');
  }
  return value;
}

function createAccount(db, username, password) {
  const cleanUsername = validateUsername(username);
  const cleanPassword = validatePassword(password);
  if (cleanUsername.toLowerCase() === SUPER_ADMIN_USERNAME) {
    throw new Error('该账号为系统最高权限账号');
  }
  if (findUserByUsername(db, cleanUsername)) {
    throw new Error('账号已存在');
  }
  const now = nowIso();
  const result = db.prepare(`
    INSERT INTO user_accounts
      (username, password_hash, role, is_active, token_version, created_at, updated_at)
    VALUES (?, ?, 'user', 1, 0, ?, ?)
  `).run(cleanUsername, hashPassword(cleanPassword), now, now);
  return publicUser(getAccount(db, result.lastInsertRowid));
}

function listAccounts(db) {
  return db.prepare(`
    SELECT id, username, role, is_active, last_login_at, created_at, updated_at
    FROM user_accounts
    ORDER BY CASE WHEN LOWER(username) = LOWER(?) THEN 0 ELSE 1 END, id ASC
  `).all(SUPER_ADMIN_USERNAME).map(publicUser);
}

function getAccount(db, id) {
  return cacheAccount(
    db,
    db.prepare('SELECT * FROM user_accounts WHERE id = ?').get(Number(id))
  );
}

function assertMutableAccount(row) {
  if (!row) throw new Error('账号不存在');
  if (String(row.username).toLowerCase() === SUPER_ADMIN_USERNAME) {
    throw new Error('最高权限账号不能被停用、删除或由此处重置');
  }
}

function setAccountActive(db, id, active) {
  const row = getAccount(db, id);
  assertMutableAccount(row);
  db.prepare(`
    UPDATE user_accounts
    SET is_active = ?, token_version = token_version + 1, updated_at = ?
    WHERE id = ?
  `).run(active ? 1 : 0, nowIso(), row.id);
  return publicUser(getAccount(db, row.id));
}

function resetAccountPassword(db, id, password) {
  const row = getAccount(db, id);
  assertMutableAccount(row);
  const cleanPassword = validatePassword(password);
  db.prepare(`
    UPDATE user_accounts
    SET password_hash = ?, token_version = token_version + 1, updated_at = ?
    WHERE id = ?
  `).run(hashPassword(cleanPassword), nowIso(), row.id);
  return publicUser(getAccount(db, row.id));
}

function changeOwnPassword(db, id, currentPassword, newPassword) {
  const row = getAccount(db, id);
  if (!row || !verifyPassword(currentPassword, row.password_hash)) {
    throw new Error('当前密码不正确');
  }
  const cleanPassword = validatePassword(newPassword);
  db.prepare(`
    UPDATE user_accounts
    SET password_hash = ?, token_version = token_version + 1, updated_at = ?
    WHERE id = ?
  `).run(hashPassword(cleanPassword), nowIso(), row.id);
  invalidateAccountCache(db, row.id);
}

function deleteAccount(db, id) {
  const row = getAccount(db, id);
  assertMutableAccount(row);
  const now = nowIso();
  const remove = db.transaction(() => {
    // 账号删除时清除其明文凭据；保留无凭据的版本骨架，供历史任务/日志审计。
    const cleanupStatements = [
      [
        `UPDATE user_ai_config_revisions
            SET api_key = '', credentials_json = '{}'
          WHERE user_id = ?`,
        [row.id],
      ],
      [
        `UPDATE user_ai_configs
            SET deleted_at = COALESCE(deleted_at, ?), updated_at = ?
          WHERE user_id = ?`,
        [now, now, row.id],
      ],
      ['DELETE FROM user_ai_config_defaults WHERE user_id = ?', [row.id]],
      ['DELETE FROM user_ai_scene_model_maps WHERE user_id = ?', [row.id]],
      ['DELETE FROM user_ai_preferences WHERE user_id = ?', [row.id]],
    ];
    for (const [sql, params] of cleanupStatements) {
      try {
        db.prepare(sql).run(...params);
      } catch (_) {
        // 兼容尚未执行个人 AI 配置迁移的旧数据库和精简单元测试库。
      }
    }
    db.prepare('DELETE FROM user_accounts WHERE id = ?').run(row.id);
  });
  remove();
  invalidateAccountCache(db, row.id);
}

function tokenFromRequest(req) {
  const authorization = String(req.headers?.authorization || '');
  if (authorization.startsWith('Bearer ')) {
    return authorization.slice(7).trim();
  }
  const cookieHeader = String(req.headers?.cookie || '');
  for (const part of cookieHeader.split(';')) {
    const [name, ...valueParts] = part.trim().split('=');
    if (name === 'auth_token') return decodeURIComponent(valueParts.join('='));
  }
  return '';
}

function authenticate(db) {
  return (req, res, next) => {
    const token = tokenFromRequest(req);
    if (!token) {
      return res.status(401).json({
        success: false,
        error: { code: 'UNAUTHORIZED', message: '请先登录' },
        timestamp: nowIso(),
      });
    }
    try {
      const payload = jwt.verify(token, getJwtSecret(db), {
        algorithms: ['HS256'],
        issuer: 'local-mini-drama',
      });
      const row = getSessionAccount(db, payload.sub);
      if (
        !row ||
        !row.is_active ||
        Number(row.token_version || 0) !== Number(payload.token_version || 0)
      ) {
        throw new Error('session invalid');
      }
      req.user = publicUser(row);
      next();
    } catch (_) {
      res.clearCookie?.('auth_token', { path: '/' });
      return res.status(401).json({
        success: false,
        error: { code: 'UNAUTHORIZED', message: '登录已失效，请重新登录' },
        timestamp: nowIso(),
      });
    }
  };
}

function requireSuperAdmin(req, res, next) {
  if (
    req.user?.role !== SUPER_ADMIN_ROLE ||
    String(req.user?.username || '').toLowerCase() !== SUPER_ADMIN_USERNAME
  ) {
    return res.status(403).json({
      success: false,
      error: { code: 'FORBIDDEN', message: '仅最高权限账号可访问此功能' },
      timestamp: nowIso(),
    });
  }
  next();
}

module.exports = {
  SUPER_ADMIN_USERNAME,
  SUPER_ADMIN_ROLE,
  TOKEN_TTL_SECONDS,
  hashPassword,
  verifyPassword,
  publicUser,
  resolveInitialAdminPassword,
  ensureAuthSystem,
  issueToken,
  findUserByUsername,
  createAccount,
  listAccounts,
  getAccount,
  setAccountActive,
  resetAccountPassword,
  changeOwnPassword,
  deleteAccount,
  authenticate,
  requireSuperAdmin,
};
