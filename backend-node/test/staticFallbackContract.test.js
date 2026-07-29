const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const appSource = fs.readFileSync(
  path.join(__dirname, '..', 'src', 'app.js'),
  'utf8'
);

test('missing static media returns 404 before the SPA fallback', () => {
  const staticMount = appSource.indexOf("app.use('/static', express.static(storageRoot))");
  const staticNotFound = appSource.indexOf("app.use('/static', (_req, res) => res.status(404)");
  const spaFallback = appSource.indexOf('A pathless middleware is compatible');

  assert.ok(staticMount >= 0);
  assert.ok(staticNotFound > staticMount);
  assert.ok(spaFallback > staticNotFound);
});
