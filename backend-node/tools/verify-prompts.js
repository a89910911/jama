const fs = require('fs');
const path = require('path');
const { buildCatalog } = require('../src/services/promptCatalog');
const {
  validateTemplateContent,
} = require('../src/services/promptTemplateService');

function collectJavaScriptFiles(directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const file = path.join(directory, entry.name);
    if (entry.isDirectory()) return collectJavaScriptFiles(file);
    return entry.name.endsWith('.js') ? [file] : [];
  });
}

const catalog = buildCatalog();
const errors = [];
const seen = new Set();

for (const item of catalog) {
  if (seen.has(item.prompt_key)) errors.push(`重复 prompt_key: ${item.prompt_key}`);
  seen.add(item.prompt_key);
  const current = item.contents?.find((entry) => entry.locale === 'default') || item.contents?.[0];
  if (!current?.content?.trim()) {
    errors.push(`提示词内容为空: ${item.prompt_key}`);
    continue;
  }
  const validation = validateTemplateContent(
    { variable_schema: item.variable_schema },
    current.content
  );
  if (!validation.ok) {
    errors.push(`${item.prompt_key}: ${validation.errors.join('；')}`);
  }
}

const sourceFiles = collectJavaScriptFiles(path.join(__dirname, '..', 'src'));
const runtimeSource = sourceFiles
  .filter((file) => !file.endsWith('promptCatalog.js') && !file.endsWith('promptI18n.js'))
  .map((file) => fs.readFileSync(file, 'utf8'))
  .join('\n');
const dynamicPromptKeys = new Set([
  'frame.first.system',
  'frame.key.system',
  'frame.last.system',
  'frame.first.fallback',
  'frame.key.fallback',
  'frame.last.fallback',
  'vision.character.extract.system',
  'vision.scene.extract.system',
  'vision.prop.extract.system',
  'vision.character.extract.user',
  'vision.scene.extract.user',
  'vision.prop.extract.user',
]);
for (const item of catalog) {
  if (!runtimeSource.includes(item.prompt_key) && !dynamicPromptKeys.has(item.prompt_key)) {
    errors.push(`没有运行时调用方: ${item.prompt_key}`);
  }
}

if (errors.length) {
  console.error(`提示词检查失败，共 ${errors.length} 项：`);
  for (const error of errors) console.error(`- ${error}`);
  process.exitCode = 1;
} else {
  console.log(`提示词检查通过：${catalog.length} 个当前系统管线，Key、内容、变量和调用方均有效。`);
}
