// 01_clean.mjs — 清洗两份聊天档案，输出统一格式的"对话轮次"JSONL（v2）
// 用法: node scripts/01_clean.mjs
//
// 输入:
//   data/不喷猎鹰喷秦粪群_聊天档案/data/messages.js  (群聊)
//   data/刘思畅_聊天档案/data/messages.js            (私聊)
//   output/sticker_names.json                        (md5→语义名，视觉标注)
// 输出:
//   output/clean/group_turns.jsonl    每行一个轮次: {source,ts,tsEnd,name,senderId,nMsg,kinds,text,nSticker}
//   output/clean/private_turns.jsonl
//   output/clean/clean_stats.json     清洗统计
//
// v2 相对 v1:
//   1. 表情包 → 稳定语义 ID [表情包:名字]（经 exportMediaUrl 100% 关联磁盘文件后视觉命名）
//   2. 图片/视频/语音/文件不再丢弃，保留占位符（修复"问图答话"断裂上下文）
//   3. HTML 实体（&#x0A;/&#x20;/&amp; 等）全字段解码
//   4. 合并窗 120s→300s（他相邻消息间隔 p50=82s，120s 掐掉一半连发）
//   5. 合并转发按 contentData.items 逐条展开进上下文
//   6. 纯表情包轮不再丢弃（占他 17.5% 的轮次）

import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');
const TARGET_ID = 'wxid_al3go0glw03v22';       // 刘思畅（群名片曾为/现为 尼古拉.柯围棋）
const TARGET_NAME = '刘思畅';
const EXPORTER_ID = 'wxid_nfeu4n7namtn22';     // 导出者本人（群里叫 铐锟斤烫烫烫）
const EXPORTER_NICK = '铐锟斤烫烫烫';

const MERGE_GAP_SEC = 300;   // 同一发送者间隔 ≤300s 的连发合并为一个轮次

// HTML 实体解码：导出数据里混有 &#x0A;（换行）&#x20;（空格）等，v1 只在 05 阶段处理过一部分
function decodeEntities(s) {
  if (!s || !s.includes('&')) return s || '';
  return s
    .replace(/&#x([0-9A-Fa-f]+);/g, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&apos;/g, "'").replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&');
}

// 表情包命名表：md5 → 语义名；命名范围外的长尾保留通用占位
let stickerNames = {};
try {
  stickerNames = JSON.parse(fs.readFileSync(path.join(ROOT, 'output/sticker_names.json'), 'utf8'));
} catch {
  console.warn('未找到 output/sticker_names.json，表情包将全部使用通用占位');
}
let nNamed = 0, nUnnamed = 0;
function renderSticker(m) {
  const name = stickerNames[m.contentData?.md5 || ''];
  if (name) { nNamed++; return `[表情包:${name}]`; }
  nUnnamed++;
  return '[表情包]';
}

// 文本类消息 → 渲染规则；确无信息量的类型丢弃
// kind: text|quote|sticker|image|video|voice|file|link|forward
function render(m) {
  const t = m.type;
  if (t === '普通文本') {
    return { kind: 'text', text: decodeEntities(m.content || '') };
  }
  if (t === '引用消息') {
    const d = m.contentData || {};
    const reply = decodeEntities(d.content || d.title || '').trim();
    const qSender = decodeEntities(d.quotedSender || '某人').trim();
    const qContent = decodeEntities(d.quotedContent || '').replace(/\s+/g, ' ').trim().slice(0, 120);
    return { kind: 'quote', text: `「${qSender}：${qContent}」\n${reply}` };
  }
  if (t === '表情包') {
    return { kind: 'sticker', text: renderSticker(m) };
  }
  if (t === '图片') return { kind: 'image', text: '[图片]' };
  if (t === '视频') return { kind: 'video', text: '[视频]' };
  if (t === '语音') return { kind: 'voice', text: '[语音]' };
  if (t === '文件') return { kind: 'file', text: '[文件]' };
  if (t === '分享消息' || t === '公众号链接') {
    const title = decodeEntities(m.contentData?.title || '').trim();
    return { kind: 'link', text: title ? `[链接] ${title}` : '[链接]' };
  }
  if (t === '合并转发') {
    const d = m.contentData || {};
    const title = decodeEntities(d.title || '聊天记录').trim();
    const lines = (d.items || [])
      .slice(0, 20)
      .map(it => `${decodeEntities(it.sender || '某人').trim()}：${decodeEntities(it.text || '').replace(/\s+/g, ' ').trim()}`)
      .filter(l => l.slice(l.indexOf('：') + 1).length > 0);
    return { kind: 'forward', text: `[转发:${title}]` + (lines.length ? `\n${lines.join('\n')}` : '') };
  }
  return null; // 通话/红包/位置/转账/视频号/小程序/名片/系统消息等 → 丢弃
}

// 文本规范化：\u2005(@提及分隔符)→空格，统一换行，压空白，去首尾
function normalize(s) {
  return (s || '')
    .replace(/\u2005/g, ' ')
    .replace(/\r\n?/g, '\n')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/[ \t]{2,}/g, ' ')
    .trim();
}

// 纯 @某人 的消息（去掉 @xxx 后什么都不剩）视为无内容
function isPureMention(s) {
  const stripped = s.replace(/@\S+/g, '').trim();
  return stripped.length === 0;
}

function loadMessages(relPath) {
  const raw = fs.readFileSync(path.join(ROOT, relPath), 'utf8');
  const json = JSON.parse(raw.slice(raw.indexOf('=') + 1).trim().replace(/;\s*$/, ''));
  return json.messages;
}

// 消息流 → 轮次流（同人连发合并）
function toTurns(msgs, source) {
  const stats = { total: 0, kept: 0, droppedByType: {}, pureMention: 0, empty: 0, entityResidue: 0 };
  const cleaned = [];
  for (const m of msgs) {
    stats.total++;
    if (!m.senderId) { // 系统消息/无主消息
      stats.droppedByType[m.type || '未知'] = (stats.droppedByType[m.type || '未知'] || 0) + 1;
      continue;
    }
    const r = render(m);
    if (!r) {
      stats.droppedByType[m.type] = (stats.droppedByType[m.type] || 0) + 1;
      continue;
    }
    const text = normalize(r.text);
    if (!text) { stats.empty++; continue; }
    if (r.kind === 'text' && isPureMention(text)) { stats.pureMention++; continue; }
    if (/&#x?[0-9A-Fa-f0-9]+;/.test(text)) stats.entityResidue++;
    stats.kept++;
    cleaned.push({
      source, kind: r.kind, text,
      name: m.senderId === EXPORTER_ID && source === 'private' ? EXPORTER_NICK : (m.name || '').trim() || '未知',
      senderId: m.senderId,
      ts: m.createTime, // 秒级 epoch
    });
  }

  const turns = [];
  let cur = null;
  const flush = () => {
    if (!cur) return;
    turns.push({
      source: cur.source, ts: cur.ts, tsEnd: cur.tsEnd,
      name: cur.name, senderId: cur.senderId, nMsg: cur.parts.length,
      kinds: cur.kinds,
      text: cur.parts.join('\n'),
      nSticker: cur.kinds.filter(k => k === 'sticker').length,
    });
    cur = null;
  };
  for (const c of cleaned) {
    if (cur && cur.senderId === c.senderId && c.ts - cur.tsEnd <= MERGE_GAP_SEC) {
      cur.parts.push(c.text);
      cur.kinds.push(c.kind);
      cur.tsEnd = c.ts;
    } else {
      flush();
      cur = { source, senderId: c.senderId, name: c.name, ts: c.ts, tsEnd: c.ts, parts: [c.text], kinds: [c.kind] };
    }
  }
  flush();
  return { turns, stats };
}

fs.mkdirSync(path.join(ROOT, 'output/clean'), { recursive: true });
const allStats = {};
for (const [src, rel] of [['group', 'data/不喷猎鹰喷秦粪群_聊天档案/data/messages.js'], ['private', 'data/刘思畅_聊天档案/data/messages.js']]) {
  nNamed = 0; nUnnamed = 0;
  const msgs = loadMessages(rel).sort((a, b) => a.createTime - b.createTime);
  const { turns, stats } = toTurns(msgs, src);
  const out = path.join(ROOT, `output/clean/${src}_turns.jsonl`);
  fs.writeFileSync(out, turns.map(t => JSON.stringify(t)).join('\n') + '\n');
  const targetTurns = turns.filter(t => t.senderId === TARGET_ID);
  const stickerOnlyTurns = targetTurns.filter(t => t.nSticker > 0 && t.text.replace(/\[表情包[^\]]*\]/g, '').trim() === '').length;
  allStats[src] = {
    ...stats, turns: turns.length, targetTurns: targetTurns.length,
    targetStickerOnlyTurns: stickerOnlyTurns,
    stickerNamed: nNamed, stickerUnnamed: nUnnamed, file: out,
  };
  console.log(`[${src}] 消息 ${stats.total} → 保留 ${stats.kept} → 轮次 ${turns.length}（目标 ${targetTurns.length}，纯表情包轮 ${stickerOnlyTurns}）| 命名表情包 ${nNamed} / 未命名 ${nUnnamed} | 实体残留 ${stats.entityResidue}`);
}
fs.writeFileSync(path.join(ROOT, 'output/clean/clean_stats.json'), JSON.stringify(allStats, null, 2));
console.log('清洗统计 → output/clean/clean_stats.json');
