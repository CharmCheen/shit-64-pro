// 06_validate_v2.mjs — v2 数据集自动验收 + v1/v2 对比报告
// 用法: node scripts/06_validate_v2.mjs
// 输入: output/clean/*, output/sft/*, output/_v1_backup/*, output/sticker_names.json
// 输出: output/report/v2_report.md（控制台同时打印验收结果）

import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');
const TARGET_ID = 'wxid_al3go0glw03v22';
const readJsonl = p => fs.readFileSync(p, 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l));
const j = p => JSON.parse(fs.readFileSync(path.join(ROOT, p), 'utf8'));

const turns = [...readJsonl('output/clean/group_turns.jsonl'), ...readJsonl('output/clean/private_turns.jsonl')];
const samples = readJsonl('output/sft/distill_all.jsonl');
const names = j('output/sticker_names.json');
const cleanStats = j('output/clean/clean_stats.json');
const distillStats = j('output/sft/distill_stats.json');

const checks = [];
const add = (name, pass, detail) => { checks.push({ name, pass, detail }); console.log(`${pass ? '✅' : '❌'} ${name} — ${detail}`); };

// 1. HTML 实体残留 = 0
const ENTITY_RE = /&#x?[0-9A-Za-z]+;|&quot;|&lt;|&gt;|&nbsp;/;
const entityHits = turns.filter(t => ENTITY_RE.test(t.text)).length;
add('HTML实体残留=0', entityHits === 0, `${entityHits} 轮含残留（&amp; 属正文转义不算，此检不含）`);

// 2. 表情包覆盖率：他的轮次里带名表情包占比
const targetTurns = turns.filter(t => t.senderId === TARGET_ID);
let tagNamed = 0, tagBare = 0;
for (const t of targetTurns) for (const m of t.text.matchAll(/\[表情包([^\]]*)\]/g)) (m[1] ? tagNamed++ : tagBare++);
const coverage = tagNamed / (tagNamed + tagBare) * 100;
add('表情包语义ID覆盖率', coverage >= 80, `带名 ${tagNamed} / 通用 ${tagBare} = ${coverage.toFixed(1)}%（命名范围 168/535 个，覆盖 91.5% 用量）`);

// 3. 上下文断裂：样本上一轮是图/视频/表情包 → 上下文必须含对应占位
const VISUAL = { image: '[图片]', video: '[视频]', sticker: '[表情包' };
let visualSamples = 0, broken = 0;
for (const s of samples) {
  const ph = VISUAL[s.meta.prevKind];
  if (!ph) continue;
  visualSamples++;
  if (!s.conversations[1].value.includes(ph)) broken++;
}
add('视觉触发上下文完整', broken === 0, `${visualSamples} 条视觉触发样本，断裂 ${broken}`);

// 4. 纯表情包轮进样本
const stickerOnlyReply = samples.filter(s => s.conversations[2].value.replace(/\[表情包[^\]]*\]/g, '').trim() === '').length;
add('纯表情包轮保留', stickerOnlyReply > 500, `${stickerOnlyReply} 条纯表情包回复样本（v1 为 0）`);

// 5. 多轮样本
const multi = samples.filter(s => s.meta.nGptTurns > 1).length;
add('多轮对话样本', multi > 500, `${multi} 条多轮 sharegpt（v1 为 0）`);

// 6. 超短回复同质度（双轨：文本超短 / 纯表情包）
const STICKER_TAG = /\[表情包[^\]]*\]/g;
const shortCnt = new Map(), stickerRepCnt = new Map();
for (const s of samples) {
  const r = s.conversations[2].value;
  const stripped = r.replace(STICKER_TAG, '').replace(/\s/g, '');
  if (stripped === '' && r.includes('[表情包')) stickerRepCnt.set(r, (stickerRepCnt.get(r) || 0) + 1);
  else if (stripped.length <= 2) shortCnt.set(r, (shortCnt.get(r) || 0) + 1);
}
const maxShort = Math.max(0, ...shortCnt.values());
const maxSticker = Math.max(0, ...stickerRepCnt.values());
add('超短回复双轨封顶', maxShort <= distillStats.params.SHORT_REPLY_MAX && maxSticker <= distillStats.params.STICKER_REPLY_MAX,
  `相同文本超短最多 ${maxShort}（上限 ${distillStats.params.SHORT_REPLY_MAX}），单表情包回复最多 ${maxSticker}（上限 ${distillStats.params.STICKER_REPLY_MAX}）`);

// 7. 时间跳跃与场景分离
const withJump = samples.filter(s => s.conversations[1].value.includes('---时间跳跃---')).length;
const sysGroup = samples.filter(s => s.conversations[0].value.includes('群聊')).length;
const sysPriv = samples.filter(s => s.conversations[0].value.includes('私聊')).length;
add('场景分离+时间跳跃', sysGroup > 0 && sysPriv > 0 && withJump > 0, `群 ${sysGroup} / 私 ${sysPriv}，含时间跳跃 ${withJump}`);

// ---- v1/v2 对比 ----
let v1 = {};
try {
  v1 = {
    clean: j('output/_v1_backup/clean_stats.json'),
    distill: j('output/_v1_backup/distill_stats.json'),
    lines: j('output/_v1_backup/line_counts.json'),
  };
} catch { console.log('（无 v1 备份，跳过对比表）'); }

// 他 top 表情包（从命名表反查用量）
const md5Count = {};
for (const rel of ['data/不喷猎鹰喷秦粪群_聊天档案/data/messages.js', 'data/刘思畅_聊天档案/data/messages.js']) {
  const raw = fs.readFileSync(path.join(ROOT, rel), 'utf8');
  const json = JSON.parse(raw.slice(raw.indexOf('=') + 1).trim().replace(/;\s*$/, ''));
  for (const m of json.messages) {
    if (m.type === '表情包' && m.senderId === TARGET_ID && m.contentData?.md5) {
      md5Count[m.contentData.md5] = (md5Count[m.contentData.md5] || 0) + 1;
    }
  }
}
const topNamed = Object.entries(md5Count).map(([md5, c]) => [names[md5] || '（未命名）', c])
  .filter(([n]) => n !== '（未命名）').sort((a, b) => b[1] - a[1]).slice(0, 10);

const fmt = n => (n ?? '—').toLocaleString('en-US');
const compareTable = v1.clean ? `| 指标 | v1 | v2 | 变化 |
|---|---|---|---|
| 群聊轮次 | ${fmt(v1.clean.group.turns)} | ${fmt(cleanStats.group.turns)} | ${cleanStats.group.turns - v1.clean.group.turns >= 0 ? '+' : ''}${cleanStats.group.turns - v1.clean.group.turns} |
| 私聊轮次 | ${fmt(v1.clean.private.turns)} | ${fmt(cleanStats.private.turns)} | ${cleanStats.private.turns - v1.clean.private.turns >= 0 ? '+' : ''}${cleanStats.private.turns - v1.clean.private.turns} |
| 保留消息(群) | ${fmt(v1.clean.group.kept)} | ${fmt(cleanStats.group.kept)} | +${cleanStats.group.kept - v1.clean.group.kept}（图片/视频/语音/文件占位回归） |
| SFT 样本 | ${fmt(v1.distill.total)} | ${fmt(distillStats.total)} | ${distillStats.total - v1.distill.total >= 0 ? '+' : ''}${distillStats.total - v1.distill.total}（多轮折叠计数） |
| train/val | ${fmt(v1.distill.train)}/${fmt(v1.distill.val)} | ${fmt(distillStats.train)}/${fmt(distillStats.val)} | — |
| 上下文窗 | 30min | 60min + 时间跳跃标记 | 参照覆盖率 67%→74% |
| system prompt | 单一 | 群聊/私聊双场景 | — |
| 表情包表达 | 全部 [表情包] | ${tagNamed.toLocaleString()} 条带语义名 | 覆盖率 ${coverage.toFixed(1)}% |
| 纯表情包回复样本 | 0 | ${fmt(stickerOnlyReply)} | 新增 |
| 多轮 sharegpt | 0 | ${fmt(multi)} | 新增 |
` : '（无 v1 备份）';

const sampleExamples = samples
  .filter(s => s.conversations[2].value.includes('[表情包:') && s.conversations[1].value.length > 40)
  .slice(0, 6)
  .map(s => `【${s.meta.source}】\n${s.conversations[1].value}\n→ 他：${s.conversations[2].value.replace(/\n/g, ' ⏎ ')}`)
  .join('\n\n');

const md = `# 数据清洗+增强 v2 验收报告

> 生成时间 ${new Date().toLocaleString('zh-CN')}。核心变化：表情包语义 ID（视觉命名 168 个）、图片/视频占位回归、HTML 实体全解码、合并窗 300s、上下文窗 60min + 时间跳跃标记、群/私双 system prompt、多轮延伸、超短回复封顶。

## 一、自动验收（${checks.filter(c => c.pass).length}/${checks.length} 通过）

${checks.map(c => `- ${c.pass ? '✅' : '❌'} **${c.name}**：${c.detail}`).join('\n')}

## 二、v1 / v2 对比

${compareTable}

## 三、他的表情包词汇 top10（视觉命名后）

| 次数 | 语义名 |
|---|---|
${topNamed.map(([n, c]) => `| ${c} | ${n} |`).join('\n')}

## 四、新数据集样例（表情包回复）

\`\`\`
${sampleExamples}
\`\`\`

## 五、清洗统计明细

\`\`\`json
${JSON.stringify(cleanStats, null, 1)}
\`\`\`
`;
fs.mkdirSync(path.join(ROOT, 'output/report'), { recursive: true });
fs.writeFileSync(path.join(ROOT, 'output/report/v2_report.md'), md);
console.log(`\n验收 ${checks.filter(c => c.pass).length}/${checks.length} 通过 → output/report/v2_report.md`);
