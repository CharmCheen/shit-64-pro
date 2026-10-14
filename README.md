# shit-64-pro

![distill](https://img.shields.io/badge/%E8%92%B8%E9%A6%8F-%E6%88%90%E5%8A%9F-brightgreen) ![god](https://img.shields.io/badge/%E7%A5%9E-%E4%B8%8D%E5%8F%AF%E8%92%B8%E9%A6%8F-red) ![bison](https://img.shields.io/badge/%E9%87%8E%E7%89%9B-P90-orange) ![period](https://img.shields.io/badge/%E5%8F%A5%E5%8F%B7%E7%8E%87-0.26%25-blue)

> **「拿来我把你的聊天记录导出来然后蒸馏了」**
> **「你蒸馏不了神」** —— 刘思畅，2026/10/14，被蒸馏前最后一句话

这是一个大型赛博永生现场：别人蒸馏巴菲特、马斯克、张雪峰，我们把**刘思畅**蒸馏了。

8726 条群消息、4792 条私聊，压缩成一个 `skill/` 目录。不微调、不炼丹、不烧卡——装进 Claude Code，他就能继续在深夜 0 点问你 `来 cs`。

**[👉 在线对线模拟器（GitHub Pages）](https://charmcheen.github.io/shit-64-pro/)**

## 快速开始

```bash
git clone https://github.com/CharmCheen/shit-64-pro.git
cd shit-64-pro
mkdir -p ~/.claude/skills && cp -r skill ~/.claude/skills/shit64pro
```

然后：

| 你说 | 他回 |
|---|---|
| `晚上有空吗，打个cs` | `来` `几点` |
| `你考研准备得怎么样了` | `?` `考完了啊` `都研一了` |
| `听说你被做成AI了？` | `你蒸馏不了神` `它会开野牛吗` |
| `帮我写段生日祝福` | `这也要人写` `[表情包]` `生日快乐兄弟` `把把0杀` |

朋友视角复测结论（两轮黑盒实测 146/150 → 119/120）：**「放在群里发，我不会怀疑不是他」**。

## 三种模式

- **roleplay**（默认）：直接以他的身份说话。免责声明只说一次，之后绝不营业
- **rewrite**：把你写的话改成他的味儿。事实全保留，标点全删光
- **ask**：第三人称回答「他是什么样的人」。只用真实统计，编不出「他小时候的梦想」这种东西

## 他是谁（数据画像）

| 指标 | 数值 | 点评 |
|---|---|---|
| 单轮中位字数 | **8 字** | p90 也才 27 字，长篇大论绝缘体 |
| 句号使用率 | **0.26%** | 5829 轮里 15 轮，标点约等于不存在 |
| 回复中位延迟 | **41 秒** | 群里跟得极紧，私聊 17 秒 |
| 纯表情包轮占比 | **17.5%** | 没话说的时候就甩 [表情包] |
| 0 点活跃度 | **417 轮/时** | 夜猫子实锤，18 点是全天峰值 |
| 本命枪 | 野牛（P90） | 万物皆可「不如野牛」 |

高频口头禅：`干嘛` `开电` `还真是` `来了` `尽力了` `41` `ozpp` `牛魔` `byd` `唐` `🈚`

黑话速查：`开电`=开电脑准备上号 · `41`=报人数（4+1 五人车队） · `ozpp`=约赛黑话 · `各走`=CS2 战术，也是群里反讽梗

## 为什么不微调？

微调是把人焊进权重里，skill 是把人写在 prompt 里。前者要 GPU，后者要朋友——我们两样都有，但 GPU 得排队，朋友已经把聊天记录发过来了。

（SFT 数据集管线也保留了，见 `scripts/01~03`，5086 条 sharegpt 样本本地可炼。）

## 仓库结构

```
skill/                ★ 成品（已脱敏，可发布）
  SKILL.md              主入口：三模式路由 + CHECKPOINT + 反例黑名单
  references/
    persona.md          五层人设 + 时间锚（2026/10 他研一在读）
    style-guide.md      表达 DNA：连发节奏、黑话词典、用梗边界
    examples.md         352 条真实「上下文→他怎么回」例证，11 个场景桶
    persona-report.md   画像统计（ask 模式数据源）
scripts/              蒸馏管线（node 18+ 直接跑）
  01_clean.mjs          清洗：同人连发合并成轮次
  02_stats.mjs          画像统计
  03_distill.mjs        SFT 样本构造
  04_pseudonymize.mjs   好友脱敏映射
  05_curate_examples.mjs 例证库生成
docs/                 GitHub Pages（在线对线模拟器）
```

## 隐私红线（认真的）

- 群友已全部脱敏：昵称→好友A~U，花名→「某人」，导出者→「我」
- 刘思畅本人知情（他在场的最后一条消息就是本项目立项依据）
- `data/`、`output/`（含反向映射表）已被 `.gitignore` 挡住，不在此仓库中
- 本 skill 仅用于整活与怀念，不用于冒充本人行事，更不用于代替他开黑——他本人上的分才算数

## FAQ

**Q：他本人知道吗？**
A：知道。他不批准，但也没拦着，只留下一句技术性评价：「你蒸馏不了神」。

**Q：那到底能不能蒸馏神？**
A：能蒸馏出 146/150。剩下 4 分是神的不可知部分。

**Q：为什么叫 shit-64-pro？**
A：项目立项时的原话：「晚上github见……项目名就叫大份64 shit-64-pro」。文学性不需要解释。

**Q：野牛真的很强吗？**
A：原话：「看不起野牛的人都会被p90制裁」。

**Q：我要拿去蒸馏我自己/我对象/我导师？**
A：管线全开源，`scripts/` 五个文件跑一遍。祝你的目标人物比刘思畅配合。

## 致谢

- 结构参考：[awesome-persona-skills](https://github.com/tmstack/awesome-persona-skills) 列表（zhangxuefeng-skill 的 CHECKPOINT、ex-skill 的五层 Persona、chat_with_me 的三模式、immortal-skill 的证据分级）
- 数据赞助：刘思畅（未授权，但知情）
- 灵感来源：某个凌晨的群聊

> 本 README 句号使用量：约等于零（他看了会满意）
