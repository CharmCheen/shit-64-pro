// 02_stats.mjs — 目标人物画像统计报告
// 用法: node scripts/02_stats.mjs
// 输入: output/clean/{group,private}_turns.jsonl
// 输出: output/report/persona_report.md

import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');
const TARGET_ID = 'wxid_al3go0glw03v22';
const TARGET_NAME = '刘思畅';

function readJsonl(p) {
  return fs.readFileSync(p, 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l));
}
const group = readJsonl(path.join(ROOT, 'output/clean/group_turns.jsonl'));
const priv = readJsonl(path.join(ROOT, 'output/clean/private_turns.jsonl'));

const mine = [...group, ...priv].filter(t => t.senderId === TARGET_ID).sort((a, b) => a.ts - b.ts);

// ---- 基础量 ----
const nTextTurns = mine.filter(t => t.nSticker === 0).length;
const nStickerOnly = mine.filter(t => t.nSticker > 0 && t.text.replace(/\[表情包\]/g, '').trim() === '').length;
const allChars = mine.reduce((s, t) => s + t.text.length, 0);
const lens = mine.map(t => t.text.length).sort((a, b) => a - b);
const pct = q => lens[Math.floor(lens.length * q)];

// ---- 时间分布 ----
const hourCnt = Array(24).fill(0), monthCnt = {}, wdCnt = Array(7).fill(0);
for (const t of mine) {
  const d = new Date(t.ts * 1000);
  hourCnt[d.getHours()]++;
  wdCnt[(d.getDay() + 6) % 7]++;
  const ym = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
  monthCnt[ym] = (monthCnt[ym] || 0) + 1;
}
const bar = (arr, labels) => {
  const max = Math.max(...arr, 1);
  return labels.map((l, i) => `${String(l).padStart(2)}时 ${'█'.repeat(Math.round(arr[i] / max * 30))} ${arr[i]}`).join('\n');
};

// ---- 口头禅：高频整句 / 高频2-gram ----
const phraseCnt = {};
for (const t of mine) {
  if (t.nSticker > 0) continue;
  const key = t.text.replace(/\s+/g, '');
  if (key.length >= 2 && key.length <= 8) phraseCnt[key] = (phraseCnt[key] || 0) + 1;
}
const topPhrases = Object.entries(phraseCnt).filter(([, c]) => c >= 8).sort((a, b) => b[1] - a[1]).slice(0, 40);

const STOP = new Set('的了是不我你他她它啊呢吧嘛呀哦哈嗯呃也就在有和跟对说要去好这样那什么没有都还很更太真的会能行来看想去点个只又又被把让给他她你我们你们他们'.split('').concat(['一个','什么','没有','不是','就是','这个','那个','现在','知道','时候','感觉','然后','已经','自己','因为','所以','但是','可以','这个']));
const biCnt = {};
for (const t of mine) {
  const s = t.text.replace(/\[[^\]]{1,6}\]|@\S+|[^\u4e00-\u9fa5]+/g, '');
  for (let i = 0; i + 1 < s.length; i++) {
    const bi = s.slice(i, i + 2);
    if (STOP.has(bi[0]) || STOP.has(bi[1])) continue;
    biCnt[bi] = (biCnt[bi] || 0) + 1;
  }
}
const topBigrams = Object.entries(biCnt).filter(([, c]) => c >= 10).sort((a, b) => b[1] - a[1]).slice(0, 40);

// ---- 微信表情码 ----
const emoCnt = {};
for (const t of mine) for (const m of t.text.matchAll(/\[([^\[\]]{1,8})\]/g)) emoCnt[m[1]] = (emoCnt[m[1]] || 0) + 1;
const topEmo = Object.entries(emoCnt).sort((a, b) => b[1] - a[1]).slice(0, 15);

// ---- 表情包 top ----
const stickerCnt = {};
for (const t of mine) if (t.nSticker > 0) for (const m of t.text.matchAll(/\[表情包\]/g)) { /* 仅计数 */ }
// md5 在清洗时存于 turn? 清洗版只留文本，重新从原始档案取 md5 top
function loadRawStickers(rel) {
  const raw = fs.readFileSync(path.join(ROOT, rel), 'utf8');
  const json = JSON.parse(raw.slice(raw.indexOf('=') + 1).trim().replace(/;\s*$/, ''));
  const cnt = {};
  for (const m of json.messages) {
    if (m.senderId === TARGET_ID && m.type === '表情包') {
      const k = m.contentData?.md5 || m.exportMediaUrl || 'unk';
      cnt[k] = (cnt[k] || 0) + 1;
    }
  }
  return cnt;
}
const stCnt = { ...loadRawStickers('data/不喷猎鹰喷秦粪群_聊天档案/data/messages.js'), ...loadRawStickers('data/刘思畅_聊天档案/data/messages.js') };
const topStickers = Object.entries(stCnt).sort((a, b) => b[1] - a[1]).slice(0, 10);

// ---- 回复速度：上一轮(任何人)到我发言的间隔 ----
const latencies = [];
for (const turns of [group, priv]) {
  for (let i = 1; i < turns.length; i++) {
    if (turns[i].senderId === TARGET_ID && turns[i - 1].senderId !== TARGET_ID) {
      const gap = turns[i].ts - turns[i - 1].tsEnd;
      if (gap >= 0 && gap <= 3600) latencies.push(gap);
    }
  }
}
latencies.sort((a, b) => a - b);
const latPct = q => latencies[Math.floor(latencies.length * q)];

// ---- 引用率（原始消息层面） ----
function quoteRate(rel) {
  const raw = fs.readFileSync(path.join(ROOT, rel), 'utf8');
  const json = JSON.parse(raw.slice(raw.indexOf('=') + 1).trim().replace(/;\s*$/, ''));
  let text = 0, quote = 0;
  for (const m of json.messages) {
    if (m.senderId !== TARGET_ID) continue;
    if (m.type === '普通文本') text++;
    if (m.type === '引用消息') quote++;
  }
  return { text, quote };
}
const qrG = quoteRate('data/不喷猎鹰喷秦粪群_聊天档案/data/messages.js');

// ---- 随机样例 ----
const pick = (arr, n) => [...arr].sort(() => Math.random() - 0.5).slice(0, n);
const samples = pick(mine.filter(t => t.text.length >= 4 && t.text.length <= 60 && !t.text.startsWith('「')), 40)
  .map(t => `- ${new Date(t.ts * 1000).toLocaleString('zh-CN', { hour12: false })} [${t.source === 'group' ? '群' : '私'}] ${t.text.replace(/\n/g, ' ⏎ ')}`);

const fmtDate = ts => new Date(ts * 1000).toLocaleDateString('zh-CN');
const span = `${fmtDate(mine[0].ts)} ~ ${fmtDate(mine[mine.length - 1].ts)}`;
const months = Object.entries(monthCnt).sort();

const md = `# 刘思畅（wxid_al3go0glw03v22，群名片「尼古拉.柯围棋」）人物画像报告

> 数据：群聊「不喷猎鹰喷秦粪群」+ 私聊档案，发言跨度 ${span}。

## 一、总量与形态
- 合并轮次后发言 **${mine.length}** 轮（群 ${mine.filter(t => t.source === 'group').length} + 私 ${mine.filter(t => t.source === 'private').length}）
- 纯文本轮 ${nTextTurns}，纯表情包轮 ${nStickerOnly}（占 ${(nStickerOnly / mine.length * 100).toFixed(1)}%）
- 总字数 ${allChars}，**单轮中位数 ${pct(0.5)} 字，p90 ${pct(0.9)} 字** —— 典型的短句刷屏型选手
- 群内引用消息 ${qrG.quote} 条 / 文本 ${qrG.text} 条（引用率 ${(qrG.quote / (qrG.quote + qrG.text) * 100).toFixed(1)}%）

## 二、活跃时段（本地时间）
\`\`\`
${bar(hourCnt, [...Array(24).keys()])}
\`\`\`
按星期：周一至周日 = ${wdCnt.join(' / ')}

## 三、月度发言量
| 月份 | 条数 |
|---|---|
${months.map(([m, c]) => `| ${m} | ${c} |`).join('\n')}

## 四、口头禅（高频整句，≥8 次）
| 句子 | 次数 |
|---|---|
${topPhrases.map(([s, c]) => `| ${s.replace(/\|/g, '/')} | ${c} |`).join('\n')}

## 五、高频词（2-gram，去停用词）
${topBigrams.map(([s, c]) => `**${s}**×${c}`).join('　')}

## 六、微信表情码 top
${topEmo.map(([s, c]) => `[${s}]×${c}`).join('　')}

## 七、常用表情包 top10（按 md5）
| 次数 | md5 |
|---|---|
${topStickers.map(([k, c]) => `| ${c} | \`${k.slice(0, 16)}…\` |`).join('\n')}

## 八、回复速度（对上一条他人消息）
中位数 ${latPct(0.5)} 秒，p90 ${latPct(0.9)} 秒 —— ${latPct(0.5) < 60 ? '跟得非常紧' : '节奏正常'}

## 九、发言样例（随机 40 条）
${samples.join('\n')}
`;
fs.mkdirSync(path.join(ROOT, 'output/report'), { recursive: true });
fs.writeFileSync(path.join(ROOT, 'output/report/persona_report.md'), md);
console.log('画像报告 → output/report/persona_report.md');
console.log(`轮次 ${mine.length} | 纯文本 ${nTextTurns} | 中位长度 ${pct(0.5)} 字 | 口头禅 ${topPhrases.length} 个`);
