const test = require('node:test');
const assert = require('node:assert/strict');
const Database = require('better-sqlite3');
const auth = require('../src/services/authService');

test('auth system seeds the only super admin and verifies its password', () => {
  const db = new Database(':memory:');
  auth.ensureAuthSystem(db);

  const admin = auth.findUserByUsername(db, 'ZHANGZEXING');
  assert.equal(admin.username, 'zhangzexing');
  assert.equal(admin.role, auth.SUPER_ADMIN_ROLE);
  assert.equal(auth.verifyPassword('zhangzexing', admin.password_hash), true);
  assert.equal(auth.verifyPassword('wrong-password', admin.password_hash), false);
  db.close();
});

test('standard accounts can be created, disabled and have their password reset', () => {
  const db = new Database(':memory:');
  auth.ensureAuthSystem(db);

  const created = auth.createAccount(db, 'editor_01', 'secret123');
  assert.equal(created.role, 'user');
  assert.equal(created.is_active, true);

  const disabled = auth.setAccountActive(db, created.id, false);
  assert.equal(disabled.is_active, false);

  auth.resetAccountPassword(db, created.id, 'newSecret123');
  const row = auth.getAccount(db, created.id);
  assert.equal(auth.verifyPassword('newSecret123', row.password_hash), true);
  db.close();
});

test('the highest-privilege account cannot be managed by account operations', () => {
  const db = new Database(':memory:');
  auth.ensureAuthSystem(db);
  const admin = auth.findUserByUsername(db, 'zhangzexing');

  assert.throws(() => auth.setAccountActive(db, admin.id, false), /最高权限账号/);
  assert.throws(() => auth.deleteAccount(db, admin.id), /最高权限账号/);
  db.close();
});

test('a valid standard-user session is authenticated but rejected by the super-admin guard', () => {
  const db = new Database(':memory:');
  auth.ensureAuthSystem(db);
  const created = auth.createAccount(db, 'viewer_01', 'secret123');
  const row = auth.getAccount(db, created.id);
  const token = auth.issueToken(db, row);
  const req = { headers: { authorization: `Bearer ${token}` } };
  const res = {
    statusCode: 200,
    body: null,
    status(code) {
      this.statusCode = code;
      return this;
    },
    json(body) {
      this.body = body;
      return this;
    },
  };

  let authenticated = false;
  auth.authenticate(db)(req, res, () => {
    authenticated = true;
  });
  assert.equal(authenticated, true);
  assert.equal(req.user.username, 'viewer_01');

  let adminNextCalled = false;
  auth.requireSuperAdmin(req, res, () => {
    adminNextCalled = true;
  });
  assert.equal(adminNextCalled, false);
  assert.equal(res.statusCode, 403);
  assert.equal(res.body.error.code, 'FORBIDDEN');
  db.close();
});
