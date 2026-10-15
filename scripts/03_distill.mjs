// 03_distill.mjs — 构造蒸馏 SFT 数据集（sharegpt 格式：上下文 → 刘思畅回复）（v2）
// 用法: node scripts/03_distill.mjs
// 输入: output/clean/{group,private}_turns.jsonl, output/persona_card.txt
// 输出: output/sft/distill_all.jsonl / distill_train.jsonl / distill_val.jsonl / distill_stats.json
//
// v2 相对 v1:
//   1. 纯表情包轮作为合法回复保留（配合 01 的 [表情包:名字]，模型学"什么语境甩哪张"）
//   2. 上下文窗 30min→60min（参照覆盖率 67%→74%），>10min 静默处插 ---时间跳跃---
//   3. 群聊/私聊双 system prompt（说话对象不同，不再混训同一场景）
//   4. 多轮延伸：同一对话片段采样成最多 3 个 gpt 轮的 sharegpt 多轮样本
//   5. 超短相同回复（"？"/"?"类）去重封顶，压同质样本

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const ROOT = path.resolve(import.meta.dirname, '..');
const TARGET_ID = 'wxid_al3go0glw03v22';

const CTX_MAX_TURNS = 8;         // 上下文最多带几个轮次
const CTX_WINDOW_SEC = 60 * 60;  // 上下文时间窗：回复前 60 分钟内（v1 30min 只覆盖 67% 参照）
const CTX_MAX_CHARS = 1500;      // 上下文总长上限（超出丢最老的）
const TIME_JUMP_SEC = 600;       // >10min 静默 → 插入时间跳跃标记
const REPLY_MAX_CHARS = 500;     // 回复超长视为粘贴/刷屏，丢弃
const MAX_GPT_TURNS = 3;         // 多轮延伸最多几个 gpt 轮
const EXT_GAP_SEC = 600;         // 延伸中断：他上次发言后静默 >10min 视为话题结束
const EXT_MAX_CHARS = 600;       // 延伸中间 human 轮字符上限
const SHORT_REPLY_MAX = 15;      // 超短文本回复保留上限（"？"/"?"类，按文本精确匹配）
const STICKER_REPLY_MAX = 60;    // 纯表情包回复保留上限（按表情包精确匹配；词汇分布是建模目标，只压头部不压扁）
const VAL_RATIO = 0.02;

const personaBase = fs.readFileSync(path.join(ROOT, 'output/persona_card.txt'), 'utf8').trim();

const SCENE = {
  group: '\n\n当前场景：微信群「不喷猎鹰喷秦粪群」群聊，多人在场。上下文每行是「名字：内容」，按时间排序；「---时间跳跃---」表示此处之前有超过 10 分钟没人说话。',
  private: '\n\n当前场景：你与好友「铐锟斤烫烫烫」的微信私聊，一对一对话。上下文每行是「名字：内容」；「---时间跳跃---」表示此处之前有超过 10 分钟没人说话。',
};

const STICKER_TAG = /\[表情包[^\]]*\]/g;

function readJsonl(p) {
  return fs.readFileSync(p, 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l));
}

function renderCtxLine(t) {
  const text = t.text.replace(/\n/g, ' '); // 上下文里同人连发拼成一行
  return `${t.name}：${text}`;
}

// 回溯收集上下文，>10min 静默处插时间跳跃标记；末尾与他回复之间也检查
function buildCtx(turns, i) {
  const t = turns[i];
  const picked = [];
  for (let j = i - 1; j >= 0 && picked.length < CTX_MAX_TURNS; j--) {
    const p = turns[j];
    if (t.ts - p.tsEnd > CTX_WINDOW_SEC) break;
    picked.unshift(p);
  }
  if (picked.length === 0) return null;

  let lines = picked.map(p => ({ p, line: renderCtxLine(p) }));
  while (lines.length > 1 && lines.reduce((s, x) => s + x.line.length + 1, 0) > CTX_MAX_CHARS) {
    lines.shift(); // 丢最老的
  }
  const out = [];
  let prevEnd = null;
  for (const { p, line } of lines) {
    if (prevEnd !== null && p.ts - prevEnd > TIME_JUMP_SEC) out.push('---时间跳跃---');
    out.push(line);
    prevEnd = p.tsEnd;
  }
  if (t.ts - prevEnd > TIME_JUMP_SEC) out.push('---时间跳跃---');
  return out.join('\n');
}

// 多轮延伸：他回复后，别人继续说话、他再接 → 2~3 轮 sharegpt
function extend(turns, i, ctx) {
  const conv = [{ from: 'human', value: ctx }, { from: 'gpt', value: turns[i].text }];
  let pending = [], pendingChars = 0, nGpt = 1, prev = turns[i];
  for (let j = i + 1; j < turns.length && nGpt < MAX_GPT_TURNS; j++) {
    const p = turns[j];
    if (p.ts - prev.tsEnd > EXT_GAP_SEC) break;
    if (p.senderId === TARGET_ID) {
      if (p.text.length > REPLY_MAX_CHARS) break;
      const humanVal = pending.join('\n').trim();
      if (!humanVal) break; // 中间没人说话（清洗合并窗没盖住的连发）→ 不硬造人设切换
      conv.push({ from: 'human', value: humanVal }, { from: 'gpt', value: p.text });
      nGpt++; pending = []; pendingChars = 0;
    } else {
      const line = renderCtxLine(p);
      if (pendingChars + line.length + 1 > EXT_MAX_CHARS) break;
      pending.push(line); pendingChars += line.length + 1;
    }
    prev = p;
  }
  return conv;
}

// 超短文本回复判定：去掉表情包标签后 ≤2 字（"？" "?" "来" "6" 这类）
function isShortReply(text) {
  return text.replace(STICKER_TAG, '').replace(/\s/g, '').length <= 2;
}

// 纯表情包回复：去掉标签后无正文
function isPureStickerReply(text) {
  return text.replace(STICKER_TAG, '').trim() === '' && text.includes('[表情包');
}

function build(turns, source) {
  const stats = {
    targetTurns: 0, made: 0, multiTurn: 0, noCtx: 0, tooLong: 0, dup: 0,
    stickerReply: 0, stickerOnlyReply: 0, ctxWithVisual: 0, timeJumpInserted: 0,
  };
  const samples = [];
  const seen = new Set();

  for (let i = 0; i < turns.length; i++) {
    const t = turns[i];
    if (t.senderId !== TARGET_ID) continue;
    stats.targetTurns++;
    if (t.text.length > REPLY_MAX_CHARS) { stats.tooLong++; continue; }

    const ctx = buildCtx(turns, i);
    if (!ctx) { stats.noCtx++; continue; }

    const conv = extend(turns, i, ctx);
    if (conv.length > 2) stats.multiTurn++;
    if (STICKER_TAG.test(t.text)) {
      stats.stickerReply++;
      if (t.text.replace(STICKER_TAG, '').trim() === '') stats.stickerOnlyReply++;
    }
    STICKER_TAG.lastIndex = 0;
    if (/\[图片\]|\[视频\]/.test(ctx)) stats.ctxWithVisual++;
    if (ctx.includes('---时间跳跃---')) stats.timeJumpInserted++;

    const key = crypto.createHash('md5')
      .update(source + '\x00' + JSON.stringify(conv))
      .digest('hex');
    if (seen.has(key)) { stats.dup++; continue; }
    seen.add(key);

    samples.push({
      conversations: [
        { from: 'system', value: personaBase + SCENE[source] },
        ...conv,
      ],
      meta: {
        source, ts: t.ts, nGptTurns: conv.length / 2,
        prevKind: i > 0 ? turns[i - 1].kinds[turns[i - 1].kinds.length - 1] : 'none',
      },
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

// 双轨封顶：文本超短 15/种；纯表情包 60/种（都保留最早出现的，按 ts 序）
const shortCnt = new Map(), stickerCnt = new Map();
let shortCapped = 0, stickerCapped = 0;
const capped = [];
for (const s of all) {
  const reply = s.conversations[2].value;
  if (isPureStickerReply(reply)) {
    const c = (stickerCnt.get(reply) || 0) + 1;
    stickerCnt.set(reply, c);
    if (c > STICKER_REPLY_MAX) { stickerCapped++; continue; }
  } else if (isShortReply(reply)) {
    const c = (shortCnt.get(reply) || 0) + 1;
    shortCnt.set(reply, c);
    if (c > SHORT_REPLY_MAX) { shortCapped++; continue; }
  }
  capped.push(s);
}
capped.sort((a, b) => a.meta.ts - b.meta.ts);

// 确定性 train/val 划分（不含 system，避免场景文案改动重划分）
const train = [], val = [];
for (const s of capped) {
  const h = parseInt(crypto.createHash('md5')
    .update(s.conversations.slice(1).map(c => c.from + '\x00' + c.value).join('\x01'))
    .digest('hex').slice(0, 8), 16);
  (h % 1000 < VAL_RATIO * 1000 ? val : train).push(s);
}

fs.mkdirSync(path.join(ROOT, 'output/sft'), { recursive: true });
const write = (f, arr) => fs.writeFileSync(path.join(ROOT, `output/sft/${f}`), arr.map(s => JSON.stringify(s)).join('\n') + '\n');
write('distill_all.jsonl', capped);
write('distill_train.jsonl', train);
write('distill_val.jsonl', val);

const statsOut = {
  group: g.stats, private: p.stats,
  total: capped.length, train: train.length, val: val.length,
  shortCapped, shortReplyKinds: shortCnt.size,
  stickerCapped, stickerReplyKinds: stickerCnt.size,
  params: { CTX_MAX_TURNS, CTX_WINDOW_SEC, CTX_MAX_CHARS, TIME_JUMP_SEC, REPLY_MAX_CHARS, MAX_GPT_TURNS, EXT_GAP_SEC, EXT_MAX_CHARS, SHORT_REPLY_MAX, STICKER_REPLY_MAX, VAL_RATIO },
};
fs.writeFileSync(path.join(ROOT, 'output/sft/distill_stats.json'), JSON.stringify(statsOut, null, 2));
console.log(JSON.stringify(statsOut, null, 2));
console.log('数据集 → output/sft/distill_{all,train,val}.jsonl');
