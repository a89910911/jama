const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const AdmZip = require('adm-zip');
const sharp = require('sharp');
const { getFfmpegPath, hasLocalFfmpeg } = require('../utils/ffmpegPath');

const LAST_FRAME_TYPES = new Set(['last', 'storyboard_last', 'tail', 'last_frame']);
const EXPORT_SCOPE_META = Object.freeze({
  all: {
    filenameSuffix: '资产',
    emptyMessage: '当前集没有可导出的图片或视频',
  },
  characters: {
    filenameSuffix: '角色资产',
    emptyMessage: '当前集没有可导出的角色资产',
  },
  scenes: {
    filenameSuffix: '场景资产',
    emptyMessage: '当前集没有可导出的场景资产',
  },
  props: {
    filenameSuffix: '道具资产',
    emptyMessage: '当前集没有可导出的道具资产',
  },
  storyboard_images: {
    filenameSuffix: '分镜图片',
    emptyMessage: '当前集没有可导出的分镜图片',
  },
  storyboard_videos: {
    filenameSuffix: '分镜视频',
    emptyMessage: '当前集没有可导出的分镜视频',
  },
});

function normalizeExportScope(value) {
  const scope = String(value || 'all').trim().toLowerCase();
  if (EXPORT_SCOPE_META[scope]) return scope;
  const err = new Error(`不支持的导出范围：${scope}`);
  err.code = 'INVALID_EXPORT_SCOPE';
  throw err;
}

function getStoragePath(cfg) {
  const raw = cfg?.storage?.local_path || './data/storage';
  return path.isAbsolute(raw) ? raw : path.join(process.cwd(), raw);
}

function safeBaseName(value, fallback = '未命名') {
  const cleaned = String(value || fallback)
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, '_')
    .replace(/\s+/g, ' ')
    .replace(/[.\s]+$/g, '')
    .trim();
  return (cleaned || fallback).slice(0, 100);
}

function uniqueZipPath(folder, rawName, ext, usedPaths) {
  const name = safeBaseName(rawName);
  let suffix = 1;
  let zipPath = `${folder}/${name}${ext}`;
  while (usedPaths.has(zipPath.toLowerCase())) {
    suffix += 1;
    zipPath = `${folder}/${name}_${suffix}${ext}`;
  }
  usedPaths.add(zipPath.toLowerCase());
  return zipPath;
}

function localPathToAbs(storagePath, relPath) {
  if (!relPath) return null;
  const root = path.resolve(storagePath);
  const abs = path.resolve(root, String(relPath).replace(/^[/\\]+/, ''));
  if (abs !== root && !abs.startsWith(root + path.sep)) return null;
  return abs;
}

function sourceExtension(asset) {
  const raw = asset.localPath || asset.url || '';
  const withoutQuery = String(raw).split(/[?#]/)[0];
  return path.extname(withoutQuery).toLowerCase();
}

async function loadAssetBuffer(storagePath, asset) {
  const candidates = [];
  if (asset.localPath) candidates.push(asset.localPath);
  if (asset.url && String(asset.url).startsWith('/static/')) {
    candidates.push(String(asset.url).slice('/static/'.length));
  }
  for (const relPath of candidates) {
    const abs = localPathToAbs(storagePath, relPath);
    if (abs && fs.existsSync(abs)) return fs.readFileSync(abs);
  }

  const url = String(asset.url || '').trim();
  if (/^data:/i.test(url)) {
    const match = url.match(/^data:[^;,]+;base64,(.+)$/i);
    if (!match) throw new Error('data URL 格式无效');
    return Buffer.from(match[1], 'base64');
  }
  if (/^https?:\/\//i.test(url)) {
    const res = await fetch(url, { signal: AbortSignal.timeout(60000) });
    if (!res.ok) throw new Error(`下载失败（HTTP ${res.status}）`);
    return Buffer.from(await res.arrayBuffer());
  }
  throw new Error('本地文件不存在且没有可下载地址');
}

async function imageToJpeg(buffer) {
  return sharp(buffer, { animated: false })
    .rotate()
    .flatten({ background: '#ffffff' })
    .jpeg({ quality: 92, chromaSubsampling: '4:4:4' })
    .toBuffer();
}

function videoToMp4(buffer, asset, tempDir) {
  if (sourceExtension(asset) === '.mp4') return buffer;
  if (!hasLocalFfmpeg()) {
    throw new Error('源视频不是 MP4，且本机未找到 ffmpeg，无法转换');
  }

  const sourceExt = sourceExtension(asset) || '.video';
  const inputPath = path.join(tempDir, `input_${asset.id || Date.now()}${sourceExt}`);
  const outputPath = path.join(tempDir, `output_${asset.id || Date.now()}.mp4`);
  fs.writeFileSync(inputPath, buffer);
  const result = spawnSync(
    getFfmpegPath(),
    [
      '-y',
      '-i', inputPath,
      '-c:v', 'libx264',
      '-preset', 'veryfast',
      '-c:a', 'aac',
      '-movflags', '+faststart',
      outputPath,
    ],
    { encoding: 'utf8', timeout: 10 * 60 * 1000 }
  );
  if (result.status !== 0 || !fs.existsSync(outputPath)) {
    throw new Error((result.stderr || 'ffmpeg 转换失败').split(/\r?\n/).slice(-3).join(' '));
  }
  return fs.readFileSync(outputPath);
}

function storyboardAssetName(storyboard) {
  const number = storyboard.storyboard_number ?? storyboard.id;
  const title = String(storyboard.title || '').trim();
  return title ? `分镜${number}_${title}` : `分镜${number}`;
}

function getEpisodeResources(db, dramaId, episodeId) {
  const characters = db.prepare(
    `SELECT c.*
     FROM characters c
     INNER JOIN episode_characters ec ON ec.character_id = c.id
     WHERE ec.episode_id = ? AND c.drama_id = ? AND c.deleted_at IS NULL
     ORDER BY c.sort_order ASC, c.id ASC`
  ).all(episodeId, dramaId);

  const scenes = db.prepare(
    `SELECT * FROM scenes
     WHERE episode_id = ? AND drama_id = ? AND deleted_at IS NULL
     ORDER BY id ASC`
  ).all(episodeId, dramaId);

  const directProps = db.prepare(
    `SELECT * FROM props
     WHERE episode_id = ? AND drama_id = ? AND deleted_at IS NULL
     ORDER BY id ASC`
  ).all(episodeId, dramaId);
  const linkedProps = db.prepare(
    `SELECT DISTINCT p.*
     FROM props p
     INNER JOIN storyboard_props sp ON sp.prop_id = p.id
     INNER JOIN storyboards sb ON sb.id = sp.storyboard_id
     WHERE sb.episode_id = ? AND p.drama_id = ?
       AND sb.deleted_at IS NULL AND p.deleted_at IS NULL
     ORDER BY p.id ASC`
  ).all(episodeId, dramaId);
  const propMap = new Map();
  [...directProps, ...linkedProps].forEach((item) => propMap.set(Number(item.id), item));

  const storyboards = db.prepare(
    `SELECT * FROM storyboards
     WHERE episode_id = ? AND deleted_at IS NULL
     ORDER BY storyboard_number ASC, id ASC`
  ).all(episodeId);

  return { characters, scenes, props: Array.from(propMap.values()), storyboards };
}

function latestStoryboardImage(db, storyboard) {
  if (storyboard.first_frame_image_id != null) {
    const bound = db.prepare(
      `SELECT * FROM image_generations
       WHERE id = ? AND deleted_at IS NULL AND status = 'completed'`
    ).get(storyboard.first_frame_image_id);
    if (bound && (bound.local_path || bound.image_url)) return bound;
  }
  const rows = db.prepare(
    `SELECT * FROM image_generations
     WHERE storyboard_id = ? AND deleted_at IS NULL AND status = 'completed'
     ORDER BY created_at DESC, id DESC`
  ).all(storyboard.id);
  return rows.find((row) => (
    !LAST_FRAME_TYPES.has(String(row.frame_type || '').toLowerCase())
    && (row.local_path || row.image_url)
  )) || null;
}

function latestStoryboardVideo(db, storyboardId) {
  return db.prepare(
    `SELECT * FROM video_generations
     WHERE storyboard_id = ? AND deleted_at IS NULL AND status = 'completed'
       AND (local_path IS NOT NULL OR video_url IS NOT NULL)
     ORDER BY created_at DESC, id DESC
     LIMIT 1`
  ).get(storyboardId) || null;
}

function buildAssets(db, dramaId, episodeId, rawScope = 'all') {
  const scope = normalizeExportScope(rawScope);
  const resources = getEpisodeResources(db, dramaId, episodeId);
  const assets = [];
  for (const item of resources.characters) {
    if (item.local_path || item.image_url) {
      assets.push({
        id: `character_${item.id}`,
        scope: 'characters',
        kind: 'image',
        folder: '角色',
        name: item.name || `角色${item.id}`,
        localPath: item.local_path,
        url: item.image_url,
      });
    }
  }
  for (const item of resources.scenes) {
    if (item.local_path || item.image_url) {
      assets.push({
        id: `scene_${item.id}`,
        scope: 'scenes',
        kind: 'image',
        folder: '场景',
        name: item.location || `场景${item.id}`,
        localPath: item.local_path,
        url: item.image_url,
      });
    }
  }
  for (const item of resources.props) {
    if (item.local_path || item.image_url) {
      assets.push({
        id: `prop_${item.id}`,
        scope: 'props',
        kind: 'image',
        folder: '道具',
        name: item.name || `道具${item.id}`,
        localPath: item.local_path,
        url: item.image_url,
      });
    }
  }
  for (const storyboard of resources.storyboards) {
    const name = storyboardAssetName(storyboard);
    const image = latestStoryboardImage(db, storyboard);
    if (image) {
      assets.push({
        id: `storyboard_image_${image.id}`,
        scope: 'storyboard_images',
        kind: 'image',
        folder: '分镜图片',
        name,
        localPath: image.local_path,
        url: image.image_url,
      });
    }
    const video = latestStoryboardVideo(db, storyboard.id);
    if (video) {
      assets.push({
        id: `storyboard_video_${video.id}`,
        scope: 'storyboard_videos',
        kind: 'video',
        folder: '分镜视频',
        name,
        localPath: video.local_path,
        url: video.video_url,
      });
    }
  }
  return scope === 'all' ? assets : assets.filter((asset) => asset.scope === scope);
}

async function exportEpisodeAssets(db, cfg, log, dramaId, episodeId, options = {}) {
  const scope = normalizeExportScope(
    typeof options === 'string' ? options : options?.scope
  );
  const scopeMeta = EXPORT_SCOPE_META[scope];
  const drama = db.prepare(
    'SELECT * FROM dramas WHERE id = ? AND deleted_at IS NULL'
  ).get(Number(dramaId));
  if (!drama) throw new Error('剧本不存在');
  const episode = db.prepare(
    'SELECT * FROM episodes WHERE id = ? AND drama_id = ? AND deleted_at IS NULL'
  ).get(Number(episodeId), Number(dramaId));
  if (!episode) throw new Error('当前集不存在');

  const assets = buildAssets(db, Number(dramaId), Number(episodeId), scope);
  if (assets.length === 0) throw new Error(scopeMeta.emptyMessage);

  const storagePath = getStoragePath(cfg);
  const zip = new AdmZip();
  const usedPaths = new Set();
  const skipped = [];
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'jama-assets-'));
  let exportedCount = 0;
  try {
    for (const asset of assets) {
      try {
        const source = await loadAssetBuffer(storagePath, asset);
        const ext = asset.kind === 'video' ? '.mp4' : '.jpg';
        const zipPath = uniqueZipPath(asset.folder, asset.name, ext, usedPaths);
        const output = asset.kind === 'video'
          ? videoToMp4(source, asset, tempDir)
          : await imageToJpeg(source);
        zip.addFile(zipPath, output);
        exportedCount += 1;
      } catch (err) {
        skipped.push(`${asset.folder}/${asset.name}: ${err.message}`);
        log?.warn?.('Asset export skipped', {
          asset: asset.name,
          kind: asset.kind,
          error: err.message,
        });
      }
    }
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }

  if (exportedCount === 0) {
    throw new Error(`资产导出失败：${skipped[0] || '没有可读取的媒体文件'}`);
  }
  if (skipped.length > 0) {
    zip.addFile(
      '导出说明.txt',
      Buffer.from(`以下 ${skipped.length} 个资产未能导出：\r\n${skipped.join('\r\n')}`, 'utf8')
    );
  }

  const dramaName = safeBaseName(drama.title || '短剧');
  const episodeName = safeBaseName(
    episode.title || `第${episode.episode_number || episode.id}集`
  );
  return {
    buffer: zip.toBuffer(),
    filename: `${dramaName}-${episodeName}-${scopeMeta.filenameSuffix}`,
    count: exportedCount,
    skipped: skipped.length,
    scope,
  };
}

module.exports = {
  safeBaseName,
  normalizeExportScope,
  buildAssets,
  exportEpisodeAssets,
};
