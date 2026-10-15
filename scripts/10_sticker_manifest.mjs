// 10_sticker_manifest.mjs — 生成表情包清单（含使用频次、磁盘文件路径、命名标记）
// 用法: node scripts/10_sticker_manifest.mjs
// 输出: output/sticker_manifest.json
//
// 命名范围: 目标人物用过的全部 + 其他人 total>=3 的高频表情包（其余长尾在清洗时保留 [表情包] 通用占位）

import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');
const TARGET_ID = 'wxid_al3go0glw03v22';
const OTHER_NAMED_MIN = 3; // 其他人表情包进入命名范围的最低使用次数

const ARCHIVES = {
  group: 'data/不喷猎鹰喷秦粪群_聊天档案',
  private: 'data/刘思畅_聊天档案',
};

function loadMessages(rel) {
  const raw = fs.readFileSync(path.join(ROOT, rel), 'utf8');
  const json = JSON.parse(raw.slice(raw.indexOf('=') + 1).trim().replace(/;\s*$/, ''));
  return json.messages;
}

const stickers = new Map(); // md5 -> { total, target, files: Set }
for (const dir of Object.values(ARCHIVES)) {
  for (const m of loadMessages(path.join(dir, 'data/messages.js'))) {
    if (m.type !== '表情包') continue;
    const md5 = m.contentData?.md5;
    if (!md5) continue;
    const e = stickers.get(md5) || { total: 0, target: 0, files: new Set() };
    e.total++;
    if (m.senderId === TARGET_ID) e.target++;
    if (m.exportMediaUrl) e.files.add(path.join(ROOT, dir, m.exportMediaUrl));
    stickers.set(md5, e);
  }
}

const rows = [...stickers.entries()].map(([md5, e]) => {
  const file = [...e.files].find(f => fs.existsSync(f)) || null;
  return { md5, total: e.total, target: e.target, file };
});
rows.sort((a, b) => b.target - a.target || b.total - a.total);

let labelIdx = 0;
const out = [];
for (const r of rows) {
  const named = r.target > 0 || r.total >= OTHER_NAMED_MIN;
  out.push({ ...r, named, label: named ? `S${String(++labelIdx).padStart(3, '0')}` : null });
}

const result = {
  generatedAt: new Date().toISOString(),
  totalDistinct: rows.length,
  namedCount: labelIdx,
  otherNamedMin: OTHER_NAMED_MIN,
  stickers: out,
};
fs.mkdirSync(path.join(ROOT, 'output'), { recursive: true });
fs.writeFileSync(path.join(ROOT, 'output/sticker_manifest.json'), JSON.stringify(result, null, 1));
const named = out.filter(r => r.named);
const covered = named.reduce((s, r) => s + r.total, 0);
const totalUse = rows.reduce((s, r) => s + r.total, 0);
console.log(`去重表情包 ${rows.length} 个，命名范围 ${named.length} 个（覆盖用量 ${(covered / totalUse * 100).toFixed(1)}%），需 ${Math.ceil(named.length / 30)} 张拼图`);
console.log('manifest → output/sticker_manifest.json');
