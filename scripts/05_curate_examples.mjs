// 05_curate_examples.mjs — 从 SFT 样本中精选风格例证，渲染成 references/examples.md
// 用法: node scripts/05_curate_examples.mjs
// 输入: output/sft/distill_all.jsonl, output/deidentify_map.json
// 输出: skill/references/examples.md   （按场景分类的「上下文→他会怎么回」真实例证库）
//
// 精选策略（数量在 TARGETS 里调）:
//   关键词场景桶（CS2/帝国时代2/原神/考研数学/日常互损/约车开黑/表情包回怼/深夜）
//   + 随机通用桶补足。同桶内按 (上下文丰富度, 回复长度适中) 打分排序，去近似重复。
// 全部样本先过脱敏映射（好友X/我），刘思畅原名保留。

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const ROOT = path.resolve(import.meta.dirname, '..');

// 场景桶：名字 → 关键词正则（匹配上下文或回复任一命中）
const BUCKETS = [
  { name: 'CS2 开黑与枪械', re: /cs2|cs版|野牛|p90|awp|狙|分段|天梯|官匹|完美|cago|counter|拆包|rush|爆弹|eco|手枪局|m4|ak|沙鹰/i, target: 50 },
  { name: '帝国时代2', re: /帝国|阿兹|投石|和尚|土耳其|匈奴|玛雅|哥特|撒拉森|蒙古|中国连环弩|封建|城堡兵|tc爆|塔爆/i, target: 35 },
  { name: '原神与其他游戏', re: /原神|草神|须弥|劫波莲|纳西|深渊|圣遗物|王者|钢铁雄心|战地|魔兽|dota|lol|金克丝/i, target: 30 },
  { name: '考研与学习', re: /考研|数学二|吉米|基米|复习|刷题|张宇|汤家凤|660|880|真题|模拟卷|线代|概率|自习/i, target: 25 },
  { name: '日常互损与抬杠', re: /牛魔|byd|急急|小丑|干嘛|笑死|逆天|唐|挠摊|飞舞|烂完|滚|逆天|ez|纯纯/i, target: 55 },
  { name: '约车开黑与日常安排', re: /上号|来了|开电|开一把|来人|缺人|几排|车队|睡了|吃饭|上课|下课|回宿舍|洗澡/i, target: 40 },
  { name: '表情包与斗图', re: /\[表情包\]/, target: 20, ctxMust: true }, // 只看上下文里有含义、他回表情包/表情码的
  { name: '深夜与作息', re: /睡|困|熬夜|肝|夜宵|起不来|起了|晚安|早上|上课|迟/, target: 15, hour: h => h === 0 || h === 1 || h === 2 || h === 23 },
  { name: '安慰与坏消息', re: /复试|调剂|落榜|没考上|挂了我简历|简历被|面试挂|被刷|差一点|差几分|没进面|干昏|干碎|干爆|考砸|寄了/, target: 12, ctxMust: true, replyScore: false },
  { name: '研究生日常（2026）', re: /导师|组会|lab|实验室|师兄|arxiv|论文|审稿|投稿|科研|跑实验|工位/, target: 10, after: d => d >= new Date('2026-09-01').getTime() / 1000 },
];
const GENERIC_TARGET = 60; // 随机通用桶
const DEDUP_SIM = 0.8;     // 近似重复阈值（reply 3-gram Jaccard）

const map = JSON.parse(fs.readFileSync(path.join(ROOT, 'output/deidentify_map.json'), 'utf8'));

function readJsonl(p) {
  return fs.readFileSync(p, 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l));
}
const samples = readJsonl(path.join(ROOT, 'output/sft/distill_all.jsonl'));

// HTML 实体解码（导出数据里混有 &#x0A; 等）
const ENTITIES = { '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&#x27;': "'", '&#x0A;': ' ', '&#x20;': ' ', '&#39;': "'" };
function decodeEntities(s) {
  return s.replace(/&#x[0-9A-Fa-f]+;|&#\d+;|&\w+;/g, e => ENTITIES[e] || e.replace(/^&#x([0-9A-Fa-f]+);$/, (_, h) => String.fromCodePoint(parseInt(h, 16))).replace(/^&#(\d+);$/, (_, d) => String.fromCodePoint(+d)));
}

// 脱敏：替换上下文里出现的所有好友昵称与花名
function deidentify(ctxText) {
  let s = decodeEntities(ctxText);
  // 按名字长度降序替换，避免短名嵌在长名里被先替换
  const names = Object.keys(map.byName).concat(Object.keys(map.extraAliases || {})).sort((a, b) => b.length - a.length);
  for (const n of names) s = s.split(n).join(map.byName[n] || map.extraAliases[n]);
  return s;
}

// 上下文渲染前压缩：每行截断到 60 字（链接/刷屏行不影响风格学习），超过 10 行丢最老的
function squeezeCtx(ctxText) {
  const lines = ctxText.split('\n');
  const kept = lines.slice(-10).map(l => (l.length > 60 ? l.slice(0, 57) + '…' : l));
  return kept.join('\n');
}

function score(s, bucketRe) {
  const ctx = s.conversations[1].value;
  const reply = s.conversations[2].value;
  const ctxTurns = ctx.split('\n').length;
  const replyLen = reply.length;
  // 上下文 3~8 行（有来有回）、回复 4~40 字（他最常见的区间）打分最高
  let sc = 0;
  sc += Math.min(ctxTurns, 8) * 2;
  if (replyLen >= 4 && replyLen <= 40) sc += 10;
  else if (replyLen <= 80) sc += 5;
  sc += Math.min(ctx.length / 100, 10);
  // 回复本身命中桶关键词 → 话题内容性强，额外加分（避免选出一堆靠上下文蹭桶的空回复）
  if (bucketRe && bucketRe.test(reply)) sc += 15;
  return sc;
}

function trigrams(s) {
  const t = new Set();
  const clean = s.replace(/\s+/g, '');
  for (let i = 0; i + 3 <= clean.length; i++) t.add(clean.slice(i, i + 3));
  return t;
}
function jaccard(a, b) {
  let inter = 0;
  for (const x of a) if (b.has(x)) inter++;
  return inter / (a.size + b.size - inter || 1);
}

// 分桶
const picked = new Map(); // idx → bucket名
const usedReplyGrams = [];

function tryPick(list, bucketName, limit = Infinity) {
  const out = [];
  for (const { idx, s } of list) {
    if (out.length >= limit) break;
    if (picked.has(idx)) continue;
    const g = trigrams(s.conversations[2].value);
    if (usedReplyGrams.some(u => jaccard(g, u) > DEDUP_SIM)) continue;
    usedReplyGrams.push(g);
    picked.set(idx, bucketName);
    out.push({ idx, s });
  }
  return out;
}

const bucketed = {};
const enriched = samples.map((s, idx) => ({ idx, s }));

for (const b of BUCKETS) {
  let pool = enriched.filter(({ s }) => {
    const ctx = s.conversations[1].value;
    const reply = s.conversations[2].value;
    const hit = b.re.test(ctx) || b.re.test(reply);
    if (!hit) return false;
    if (b.ctxMust && !b.re.test(ctx)) return false;
    if (b.hour && !b.hour(new Date(s.meta.ts * 1000).getHours())) return false;
    if (b.after && s.meta.ts < b.after) return false;
    return true;
  });
  pool.sort((a, z) => score(z.s, b.replyScore === false ? null : b.re) - score(a.s, b.replyScore === false ? null : b.re));
  // 高分的一半 + 随机的一半，兼顾「典型」和「多样」
  const half = Math.ceil(pool.length / 2);
  const top = pool.slice(0, half);
  const rest = pool.slice(half).sort(() => Math.random() - 0.5);
  const ordered = [...top, ...rest];
  bucketed[b.name] = tryPick(ordered, b.name, b.target);
}

// 通用随机桶补足
const remain = enriched.filter(({ idx }) => !picked.has(idx));
const genericPool = remain.sort(() => Math.random() - 0.5);
const generic = tryPick(genericPool, '日常杂谈', GENERIC_TARGET);

// ---- 渲染 markdown ----
function renderSample(s, i) {
  const ctx = squeezeCtx(deidentify(s.conversations[1].value));
  // 他引用别人时引用头里的花名也要脱敏，他自己的话保留
  const reply = deidentify(s.conversations[2].value);
  const d = new Date(s.meta.ts * 1000);
  const when = `${d.getFullYear()}/${d.getMonth() + 1}/${d.getDate()}`;
  const lines = ctx.split('\n').map(l => `> ${l}`).join('\n');
  return `### ${i}\n\n**上下文**（${s.meta.source === 'group' ? '群聊' : '私聊'}，${when}）：\n\n${lines}\n\n**刘思畅回**：\n\n\`\`\`\n${reply}\n\`\`\`\n`;
}

function renderBucket(name, list) {
  if (!list.length) return '';
  const body = list.map(({ s }, i) => renderSample(s, i + 1)).join('\n');
  return `## ${name}（${list.length} 条）\n\n${body}\n`;
}

const order = [...BUCKETS.map(b => b.name), '日常杂谈'];
const parts = [];
for (const name of order) {
  const list = name === '日常杂谈' ? generic : bucketed[name];
  if (list && list.length) parts.push(renderBucket(name, list));
}

const totalPicked = [...picked.values()].length; // 已去重
const header = `# 刘思畅风格例证库

> 从 5086 条「上下文→回复」蒸馏样本中精选 ${totalPicked} 条真实例证（脱敏：群友昵称→好友A~U，花名→某人，导出者→我；刘思畅原话保留）。
> 用途：风格模仿的 evidence 基础。看节奏（短句连发）、看用词（黑话/表情码）、看态度（损但不恼），**不要照抄具体句子到新场景**。
> 每条格式：上下文（\`昵称：内容\` 逐行）→ 他实际回的（\`\`\` 块内原文，换行=他连发多条）。

---

`;

fs.mkdirSync(path.join(ROOT, 'skill/references'), { recursive: true });
fs.writeFileSync(path.join(ROOT, 'skill/references/examples.md'), header + parts.join('\n---\n\n'));
console.log(`例证库 → skill/references/examples.md（共 ${totalPicked} 条）`);
for (const n of order) {
  const c = n === '日常杂谈' ? generic.length : (bucketed[n]?.length || 0);
  console.log(`  ${n}: ${c}`);
}
