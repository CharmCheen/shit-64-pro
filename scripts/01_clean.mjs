// 01_clean.mjs — 清洗两份聊天档案，输出统一格式的"对话轮次"JSONL
// 用法: node scripts/01_clean.mjs
//
// 输入:
//   data/不喷猎鹰喷秦粪群_聊天档案/data/messages.js  (群聊, 68479 条)
//   data/刘思畅_聊天档案/data/messages.js            (私聊, 4792 条)
// 输出:
//   output/clean/group_turns.jsonl    每行一个轮次: {source,ts,tsEnd,name,senderId,nMsg,text,nSticker}
//   output/clean/private_turns.jsonl
//   output/clean/clean_stats.json     清洗统计(各类型取舍数量)

import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');
const TARGET_ID = 'wxid_al3go0glw03v22';       // 刘思畅（群名片曾为/现为 尼古拉.柯围棋）
const TARGET_NAME = '刘思畅';
const EXPORTER_ID = 'wxid_nfeu4n7namtn22';     // 导出者本人（群里叫 铐锟斤烫烫烫）
const EXPORTER_NICK = '铐锟斤烫烫烫';

const MERGE_GAP_SEC = 120;   // 同一发送者间隔 ≤120s 的连发合并为一个轮次

// 文本类消息 → 渲染规则；其余类型丢弃
// kind: 'text' 普通文本 | 'quote' 引用 | 'sticker' 表情包 | 'link' 链接/分享
function render(m) {
  const t = m.type;
  if (t === '普通文本') {
    return { kind: 'text', text: m.content || '' };
  }
  if (t === '引用消息') {
    const d = m.contentData || {};
    const reply = (d.content || d.title || '').trim();
    const qSender = (d.quotedSender || '某人').trim();
    const qContent = (d.quotedContent || '').replace(/\s+/g, ' ').trim().slice(0, 120);
    return { kind: 'quote', text: `「${qSender}：${qContent}」\n${reply}` };
  }
  if (t === '表情包') {
    return { kind: 'sticker', text: '[表情包]', md5: m.contentData?.md5 || m.exportMediaUrl || '' };
  }
  if (t === '分享消息' || t === '公众号链接') {
    // 标题一般在 contentData.title，此处统一占位
    const title = (m.contentData?.title || '').trim();
    return { kind: 'link', text: title ? `[链接] ${title}` : '[链接]' };
  }
  return null; // 图片/视频/文件/语音/通话/转账/位置/系统消息等 → 丢弃
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
  const stats = { total: 0, kept: 0, droppedByType: {}, pureMention: 0, empty: 0 };
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
    stats.kept++;
    cleaned.push({
      source, kind: r.kind, text, md5: r.md5 || null,
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
      text: cur.parts.join('\n'),
      nSticker: cur.stickers,
    });
    cur = null;
  };
  for (const c of cleaned) {
    if (cur && cur.senderId === c.senderId && c.ts - cur.tsEnd <= MERGE_GAP_SEC) {
      cur.parts.push(c.text);
      cur.tsEnd = c.ts;
      if (c.kind === 'sticker') cur.stickers++;
    } else {
      flush();
      cur = { source, senderId: c.senderId, name: c.name, ts: c.ts, tsEnd: c.ts, parts: [c.text], stickers: c.kind === 'sticker' ? 1 : 0 };
    }
  }
  flush();
  return { turns, stats };
}

fs.mkdirSync(path.join(ROOT, 'output/clean'), { recursive: true });
const allStats = {};
for (const [src, rel] of [['group', 'data/不喷猎鹰喷秦粪群_聊天档案/data/messages.js'], ['private', 'data/刘思畅_聊天档案/data/messages.js']]) {
  const msgs = loadMessages(rel).sort((a, b) => a.createTime - b.createTime);
  const { turns, stats } = toTurns(msgs, src);
  const out = path.join(ROOT, `output/clean/${src}_turns.jsonl`);
  fs.writeFileSync(out, turns.map(t => JSON.stringify(t)).join('\n') + '\n');
  const targetTurns = turns.filter(t => t.senderId === TARGET_ID);
  allStats[src] = { ...stats, turns: turns.length, targetTurns: targetTurns.length, file: out };
  console.log(`[${src}] 消息 ${stats.total} → 保留 ${stats.kept} → 轮次 ${turns.length}（目标 ${targetTurns.length}）→ ${out}`);
}
fs.writeFileSync(path.join(ROOT, 'output/clean/clean_stats.json'), JSON.stringify(allStats, null, 2));
console.log('清洗统计 → output/clean/clean_stats.json');
