const fs = require('fs');
const path = require('path');

const repoRoot = path.join(__dirname, '..', '..');
const src = path.join(repoRoot, 'backend-node');
const dest = path.join(__dirname, '..', 'backend-app');

const dirsToCopy = ['src', 'configs', 'scripts', 'migrations'];

if (!fs.existsSync(src)) {
  console.error('backend-node not found at', src);
  process.exit(1);
}

if (fs.existsSync(dest)) fs.rmSync(dest, { recursive: true });
fs.mkdirSync(dest, { recursive: true });

for (const dir of dirsToCopy) {
  const from = path.join(src, dir);
  const to = path.join(dest, dir);
  if (fs.existsSync(from)) {
    fs.cpSync(from, to, { recursive: true });
  }
}

// 合并 desktop 自带的初始迁移（仅补缺失的版本）。
// 同一迁移版本只能有一个文件；否则 migrate.js 会在首次启动时重复记录
// schema_migrations.version，导致全新安装也无法启动。
const migrationsDest = path.join(dest, 'migrations');
const initialMigrations = path.join(__dirname, 'initial-migrations');
if (!fs.existsSync(migrationsDest)) fs.mkdirSync(migrationsDest, { recursive: true });
if (fs.existsSync(initialMigrations)) {
  const existingVersions = new Set(
    fs.readdirSync(migrationsDest)
      .map((name) => name.match(/^(\d+)_.*\.sql$/))
      .filter(Boolean)
      .map((match) => Number(match[1]))
  );
  for (const f of fs.readdirSync(initialMigrations)) {
    const match = f.match(/^(\d+)_.*\.sql$/);
    if (!match || existingVersions.has(Number(match[1]))) continue;
    fs.copyFileSync(path.join(initialMigrations, f), path.join(migrationsDest, f));
    existingVersions.add(Number(match[1]));
  }
  console.log('Merged missing initial-migrations -> desktop/backend-app/migrations');
}

console.log('Copied backend-node (src, configs, scripts, migrations) -> desktop/backend-app');
