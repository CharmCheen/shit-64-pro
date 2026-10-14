// 04_pseudonymize.mjs — 生成好友昵称脱敏映射表
// 用法: node scripts/04_pseudonymize.mjs
// 输入: output/clean/{group,private}_turns.jsonl
// 输出: output/deidentify_map.json  { byName: {原名→代号}, byId: {senderId→代号}, exporter }
//
// 规则:
//   - 刘思畅（本人知情，项目主角）保留原名；他的群名片「尼古拉.柯围棋」同样保留
//   - 导出者「铐锟斤烫烫烫」→ 统一映射为「我」（私聊里对面视角的"我"就是他）
//   - 其余所有群友 → 好友A/B/C…（按消息量降序分配，消息越多代号越靠前）
//   - 群友的「花名/群名片」（被 @ 或被引用时显示，与导出 name 字段不同）挂在对应 senderId
//     名下共用同一个代号；无法归属的按出现频次补入花名表

import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');
const TARGET_ID = 'wxid_al3go0glw03v22';
const TARGET_NAME = '刘思畅';
const TARGET_ALIASES = ['尼古拉.柯围棋']; // 刘思畅的群名片，保留不脱敏
const EXPORTER_NICK = '铐锟斤烫烫烫';
const SELF_ALIAS = '我';
const MIN_ALIAS_FREQ = 3; // 花名至少出现 N 次才纳入（防误抓普通词）
// 不当作花名的匹配（普通词/代词，或本身就是常见群公告用语）
const ALIAS_BLACKLIST = new Set(['我', '某人', '所有人', '刘思唱', '全体成员', '帝国时代2', '帝国时代', '王者荣耀教科书', '数学大人和408大人不要再虐我了']);

function readJsonl(p) {
  return fs.readFileSync(p, 'utf8').split('\n').filter(Boolean).map(l => JSON.parse(l));
}

const turns = [
  ...readJsonl(path.join(ROOT, 'output/clean/group_turns.jsonl')),
  ...readJsonl(path.join(ROOT, 'output/clean/private_turns.jsonl')),
];

// senderId → 消息量 & 出现过的昵称
const byId = new Map();
for (const t of turns) {
  if (!byId.has(t.senderId)) byId.set(t.senderId, { nMsg: 0, names: new Set() });
  const e = byId.get(t.senderId);
  e.nMsg += t.nMsg;
  if (t.name && t.name !== '未知') e.names.add(t.name);
}

// 文本中出现的花名（@xxx 与 「xxx：」引用），统计频次
const aliasFreq = new Map();
for (const t of turns) {
  const at = /@([^\s@「」]{1,30})/g;
  let m;
  while ((m = at.exec(t.text))) aliasFreq.set(m[1], (aliasFreq.get(m[1]) || 0) + 1);
  const qm = t.text.match(/^「([^：\n]{1,30})：/);
  if (qm) aliasFreq.set(qm[1], (aliasFreq.get(qm[1]) || 0) + 1);
}

// 排除目标本人；导出者单列；其余按消息量降序编号
const others = [...byId.entries()].filter(([id]) => id !== TARGET_ID);
others.sort((a, b) => b[1].nMsg - a[1].nMsg);

const mapById = {};
const mapByName = {};
let exporterId = null;
let idx = 0;
for (const [id, e] of others) {
  if (e.names.has(EXPORTER_NICK)) {
    exporterId = id;
    mapById[id] = SELF_ALIAS;
    for (const n of e.names) mapByName[n] = SELF_ALIAS;
    continue;
  }
  idx++;
  const alias = `好友${String.fromCharCode(64 + idx)}`; // 好友A、好友B…
  mapById[id] = alias;
  for (const n of e.names) mapByName[n] = alias;
}
mapByName[TARGET_NAME] = TARGET_NAME;
mapById[TARGET_ID] = TARGET_NAME;

// 高频花名补入：目标是本人的花名保留；其余统一替换为「某人」（可读且不泄身份）。
// 黑名单词跳过（@我 / @所有人 是普通用法，不是花名）。
const extraAliases = {};
for (const [name, freq] of aliasFreq) {
  if (freq < MIN_ALIAS_FREQ) continue;
  if (ALIAS_BLACKLIST.has(name)) continue;
  if (TARGET_ALIASES.includes(name) || name === TARGET_NAME) continue;
  if (mapByName[name]) continue;
  extraAliases[name] = '某人';
}

const out = {
  generatedAt: new Date().toISOString(),
  note: `好友昵称脱敏映射：按消息量降序分配代号，共 ${idx} 人；无法归属的花名统一替换为「某人」`,
  exporterId,
  exporterNick: EXPORTER_NICK,
  selfAlias: SELF_ALIAS,
  targetId: TARGET_ID,
  targetName: TARGET_NAME,
  targetAliases: TARGET_ALIASES,
  byId: mapById,
  byName: mapByName,
  extraAliases, // 花名/群名片 → 某人
};
fs.writeFileSync(path.join(ROOT, 'output/deidentify_map.json'), JSON.stringify(out, null, 2));
console.log(`脱敏映射：${idx} 位好友 + 导出者(${SELF_ALIAS}) + 目标(${TARGET_NAME}) + ${Object.keys(extraAliases).length} 个花名 → output/deidentify_map.json`);
