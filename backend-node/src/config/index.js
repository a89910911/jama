const fs = require('fs');
const path = require('path');
const yaml = require('js-yaml');

const configPaths = [
  path.join(process.cwd(), 'configs', 'config.yaml'),
  path.join(process.cwd(), 'config.yaml'),
  path.join(__dirname, '..', '..', 'configs', 'config.yaml'),
];

function loadConfig() {
  let raw = null;
  for (const p of configPaths) {
    if (fs.existsSync(p)) {
      raw = fs.readFileSync(p, 'utf8');
      break;
    }
  }
  if (!raw) {
    throw new Error('Config file not found: configs/config.yaml');
  }
  const parsed = yaml.load(raw);
  if (!parsed?.app?.name) {
    throw new Error('Invalid config: missing app section');
  }
  parsed.database = {
    ...(parsed.database || {}),
    type: process.env.JAMA_DB_TYPE || parsed.database?.type || 'sqlite',
    host: process.env.JAMA_DB_HOST || parsed.database?.host,
    port: Number(process.env.JAMA_DB_PORT || parsed.database?.port || 3306),
    user: process.env.JAMA_DB_USER || parsed.database?.user,
    password: process.env.JAMA_DB_PASSWORD || parsed.database?.password,
    database: process.env.JAMA_DB_NAME || parsed.database?.database,
    charset: process.env.JAMA_DB_CHARSET || parsed.database?.charset || 'utf8mb4',
  };
  return parsed;
}

module.exports = { loadConfig };
