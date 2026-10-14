// 03_distill.mjs — 构造蒸馏 SFT 数据集（sharegpt 格式：上下文 → 刘思畅回复）
// 用法: node scripts/03_distill.mjs
// 输入: output/clean/{group,private}_turns.jsonl, output/persona_card.txt
// 输出: output/sft/distill_all.jsonl / distill_train.jsonl / distill_val.jsonl / distill_stats.json

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const ROOT = path.resolve(import.meta.dirname, '..');
const TARGET_ID = 'wxid_al3go0glw03v22';

const CTX_MAX_TURNS = 8;        // 上下文最多带几个轮次
const CTX_WINDOW_SEC = 30 * 60; // 上下文时间窗：回复前 30 分钟内
const CTX_MAX_CHARS = 1500;     // 上下文总长上限（超出丢最老的）
const REPLY_MAX_CHARS = 500;    // 回复超长视为粘贴/刷屏，丢弃
const VAL_RATIO = 0.02;

const personaCard = fs.readFileSync(path.join(ROOT, 'output/persona_card.txt'), 'utf8').trim();

function readJsonl(p) {
  return fs.readFileSync(p, 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l));
}

function renderCtxLine(t) {
  const text = t.text.replace(/\n/g, ' '); // 上下文里同人连发拼成一行
  return `${t.name}：${text}`;
}

// 从轮次流构造样本
function build(turns, source) {
  const stats = { targetTurns: 0, made: 0, noCtx: 0, stickerOnly: 0, tooLong: 0, dup: 0 };
  const samples = [];
  const seen = new Set();

  for (let i = 0; i < turns.length; i++) {
    const t = turns[i];
    if (t.senderId !== TARGET_ID) continue;
    stats.targetTurns++;
    const reply = t.text.replace(/(?:^|\n)\[表情包\]/g, '').trim(); // 去掉纯表情包行后看还有没有正文
    if (!reply || /^\[表情包\]$/.test(t.text.trim())) { stats.stickerOnly++; continue; }
    if (t.text.length > REPLY_MAX_CHARS) { stats.tooLong++; continue; }

    // 回溯收集上下文
    const ctx = [];
    for (let j = i - 1; j >= 0 && ctx.length < CTX_MAX_TURNS; j--) {
      const p = turns[j];
      if (t.ts - p.tsEnd > CTX_WINDOW_SEC) break;
      ctx.unshift(p);
    }
    if (ctx.length === 0) { stats.noCtx++; continue; }

    // 裁剪上下文总长
    let total = 0, start = ctx.length;
    for (let k = ctx.length - 1; k >= 0; k--) {
      total += renderCtxLine(ctx[k]).length + 1;
      if (total > CTX_MAX_CHARS) { start = k + 1; break; }
      if (k === 0) start = 0;
    }
    const ctxText = ctx.slice(start).map(renderCtxLine).join('\n');

    const key = crypto.createHash('md5').update(source + '\x00' + ctxText + '\x00' + reply).digest('hex');
    if (seen.has(key)) { stats.dup++; continue; }
    seen.add(key);

    samples.push({
      conversations: [
        { from: 'system', value: personaCard },
        { from: 'human', value: ctxText },
        { from: 'gpt', value: reply },
      ],
      meta: { source, ts: t.ts },
    });
    stats.made++;
  }
  return { samples, stats };
}

const group = readJsonl(path.join(ROOT, 'output/clean/group_turns.jsonl'));
const priv = readJsonl(path.join(ROOT, 'output/clean/private_turns.jsonl'));

const g = build(group, 'group');
const p = build(priv, 'private');
const all = [...g.samples, ...p.samples].sort((a, b) => a.meta.ts - b.meta.ts);

// 确定性 train/val 划分
const train = [], val = [];
for (const s of all) {
  const h = parseInt(crypto.createHash('md5').update(s.conversations[1].value + s.conversations[2].value).digest('hex').slice(0, 8), 16);
  (h % 1000 < VAL_RATIO * 1000 ? val : train).push(s);
}

fs.mkdirSync(path.join(ROOT, 'output/sft'), { recursive: true });
const write = (f, arr) => fs.writeFileSync(path.join(ROOT, `output/sft/${f}`), arr.map(s => JSON.stringify(s)).join('\n') + '\n');
write('distill_all.jsonl', all);
write('distill_train.jsonl', train);
write('distill_val.jsonl', val);

const statsOut = {
  group: g.stats, private: p.stats,
  total: all.length, train: train.length, val: val.length,
  params: { CTX_MAX_TURNS, CTX_WINDOW_SEC, CTX_MAX_CHARS, REPLY_MAX_CHARS, VAL_RATIO },
};
fs.writeFileSync(path.join(ROOT, 'output/sft/distill_stats.json'), JSON.stringify(statsOut, null, 2));
console.log(JSON.stringify(statsOut, null, 2));
console.log('数据集 → output/sft/distill_{all,train,val}.jsonl');
