const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const { randomUUID } = require('crypto');
const { getFfmpegPath, hasLocalFfmpeg } = require('../utils/ffmpegPath');
const storageLayout = require('./storageLayout');
const { storageRootFromConfig, resolveStoragePath } = require('./redrawQualityService');

const STRENGTHS = {
  keep: { width: 72, blur: 5, contrast: 0.7, maskBottom: 0.14 },
  balanced: { width: 48, blur: 8, contrast: 0.55, maskBottom: 0.18 },
  replace: { width: 36, blur: 10, contrast: 0.45, maskBottom: 0.22 },
};

function resolveSourceFile(cfg, sourceVideoPath) {
  const abs = resolveStoragePath(cfg, sourceVideoPath);
  if (abs && fs.existsSync(abs) && fs.statSync(abs).isFile()) return abs;
  const raw = String(sourceVideoPath || '').trim();
  if (path.isAbsolute(raw) && fs.existsSync(raw) && fs.statSync(raw).isFile()) return raw;
  return null;
}

function makeStructureReference(db, cfg, log, card, strength = 'balanced') {
  if (!hasLocalFfmpeg()) throw new Error('未找到 ffmpeg，无法生成低细节结构视频');
  const source = resolveSourceFile(cfg, card.source_video_path);
  if (!source) throw new Error('源视频不存在，无法生成结构参考');

  const preset = STRENGTHS[strength] || STRENGTHS.balanced;
  const storageRoot = storageRootFromConfig(cfg);
  const projectSubdir = storageLayout.getProjectStorageSubdir(db, card.drama_id || card.job_drama_id);
  const relDir = path.join(projectSubdir, 'redraw', 'structures').replace(/\\/g, '/');
  const absDir = path.join(storageRoot, relDir);
  fs.mkdirSync(absDir, { recursive: true });

  const name = `redraw_card_${card.id}_${strength}_${randomUUID().slice(0, 8)}.mp4`;
  const absOut = path.join(absDir, name);
  const relOut = `${relDir}/${name}`.replace(/\\/g, '/');
  const filter = [
    `scale=${preset.width}:-2`,
    `boxblur=${preset.blur}:1`,
    `eq=contrast=${preset.contrast}`,
    `drawbox=x=0:y=ih*(1-${preset.maskBottom}):w=iw:h=ih*${preset.maskBottom}:color=black:t=fill`,
  ].join(',');

  const args = [
    '-y',
    '-i', source,
    '-vf', filter,
    '-an',
    '-c:v', 'libx264',
    '-preset', 'veryfast',
    '-crf', '30',
    '-pix_fmt', 'yuv420p',
    '-movflags', '+faststart',
    absOut,
  ];
  const result = spawnSync(getFfmpegPath(), args, { encoding: 'utf8', maxBuffer: 8 * 1024 * 1024 });
  if (result.status !== 0) {
    try { fs.unlinkSync(absOut); } catch (_) {}
    throw new Error(`结构视频生成失败: ${(result.stderr || result.stdout || '').slice(-600)}`);
  }
  log.info('[redraw] structure reference created', { card_id: card.id, strength, local_path: relOut });
  return { local_path: relOut, url: `/static/${relOut}` };
}

module.exports = {
  STRENGTHS,
  makeStructureReference,
  resolveSourceFile,
};
