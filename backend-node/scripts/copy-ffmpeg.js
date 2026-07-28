'use strict';

const fs = require('node:fs');
const path = require('node:path');

const sourceDirectory = process.argv[2] ? path.resolve(process.argv[2]) : '';
if (!sourceDirectory || !fs.existsSync(sourceDirectory)) {
  console.error('Usage: node scripts/copy-ffmpeg.js <directory-containing-ffmpeg-and-ffprobe>');
  process.exit(1);
}

const isWindows = process.platform === 'win32';
const names = isWindows
  ? ['ffmpeg.exe', 'ffprobe.exe']
  : ['ffmpeg', 'ffprobe'];
const destinationDirectory = path.resolve(__dirname, '..', 'tools', 'ffmpeg');
fs.mkdirSync(destinationDirectory, { recursive: true });

for (const name of names) {
  const source = path.join(sourceDirectory, name);
  if (!fs.existsSync(source) || !fs.statSync(source).isFile()) {
    console.error(`Missing required media tool: ${source}`);
    process.exit(1);
  }
}

for (const name of names) {
  const source = path.join(sourceDirectory, name);
  const destination = path.join(destinationDirectory, name);
  fs.copyFileSync(source, destination);
  if (!isWindows) fs.chmodSync(destination, 0o755);
  console.log(`Copied ${source} -> ${destination}`);
}

