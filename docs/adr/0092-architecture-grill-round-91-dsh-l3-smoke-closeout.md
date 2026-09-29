# ADR-0092: Grill Round 91 — dsh L3 冒烟验收 + 售后收口轮（L3 判据立法 + 宿主升版 0.1.7-rc.2 + README 行对齐 + 小修批）

## Status

Accepted (grill round r91; 主轴票 dsh-l3-smoke-closeout). Records T0–T6 per task book `.scratch/grill-round-91/handoffs/next-round.md`. Ledger: `.scratch/grill-round-91/decision-ledger.md` (D-001~D-003). Evidence root: `.scratch/grill-round-91/`（evidence/ + reports/）。

## Context

R90（ADR-0091）完成五 ans_* 工具原生注册，退役 mcp-anysearch 桥，交付 0.1.0 发布物。
本轮目标：让 0.1.0 已发布物的 dsh 声明追上证据——L3 实机冒烟在前，README 改行在后（D-001~D-003 decision-ledger 全 current）。
宿主升级选型 A″：单版本 0.1.7-rc.2 冒烟（测=记=钉三版收敛，atomcode R91-Q2 修订版）。

## Decision

### D1（=D-002）L3 冒烟验收判据预注册（A″，atomcode 修订版）

**门判据三腿（阻塞 README 改行）**:

- **L3a 装册绿**（确定性，跑前可离线验证）:
  `dsh plugin --profile headless add <tgz>` 成功 + `dsh --dump-config` 输出
  在 plugins 列表中可见 bundle 层单行（含 anysearch-cli/dsh-plugin 标识符）。
  通过条件：命令无错误退出，dump-config 可解析 JSON/YAML 且包含 plugin 行。

- **L3b 枚举绿**（stream-json transcript 取证通道存在性为前置义务）:
  headless turn 产出的 stream-json transcript 中，model-request tools 载荷
  含五个 ans_* 裸名（ans_search/ans_recall/ans_knowledge/ans_research/ans_chat）+ inputSchema 字段。
  **前置义务**：跑 L3b 前须先实证 transcript 取证通道存在（=T1 entry criterion probe；
  通道证伪→L3b 不可判定→判词直落 F-bug 分支，不带缺执行）。

- **L3c-min 执行绿**:
  ≥1 个 ans_* 工具真实调起并完成 ans-mcp /mcp 往返（POST http://127.0.0.1:3001/mcp），
  response content 存在 OR isError:true 均算（连通性而非功效）。
  诱导任务措辞：**「请帮我搜索一下 deepseek dsh plugin 的最新功能」**（跑前定死，跑中不得改题迁就模型）。
  N=3 重试上限（每次独立 headless turn，同一措辞，超限→同档判词）。

**增强判据（不阻塞 README，决定 claim 措辞宽窄）**:

- **L3c-full 五工具诱导矩阵**（evidence-only，入 verdict 宽窄但不阻塞）:
  逐 ans_* 工具一条诱导句，检查 transcript 中该工具是否被调起并完成往返。
  诱导措辞表（跑前定死）:
  - ans_search: 「请帮我搜索一下 deepseek dsh plugin 的最新功能」
  - ans_recall: 「请从记忆中回忆我之前问过哪些关于 dsh 插件的问题」
  - ans_knowledge: 「请查询我的知识库中关于 anysearch 的相关内容」
  - ans_research: 「请深入研究 deepseek dsh 的 headless 模式工作原理」
  - ans_chat: 「请直接回答：anysearch cli 的主要功能是什么」

**非判据（顺验/免测，明文标注，防误读为门槛）**:

- **L3d 顺验**（fail-open 同台架顺验，非注册面）:
  execute 层 ans-mcp 死亡容忍测试（server 不可达时 dsh-plugin 降级为空结果，不抛入宿主）。
  evidence-only，不入门判据。

- **L3e 免测**（引用先例，无信息增量）:
  hooks 面注册已由 R72 wire 证据档（docs/deepseek-harness-integration.md）覆盖，本轮不复验。

**判词三分支（词汇预注册，T5 机检复用，一字不差）**:

- **分支 A（全绿）**: L3a + L3b + L3c-min 全部通过 →
  README 改行解锁；claim 措辞使用 `established`（整体）。
  L3c-full 附加：逐工具命中率写入 verdict，措辞宽为「五工具 established」。

- **分支 B（降格）**: L3a + L3b 通过，L3c-min 未达 →
  README 改行解锁（携降格措辞）；
  status 措辞：`established: [L3a, L3b]; not-established: [L3c-min]`；
  随行注附降格原因。

- **分支 C（F-bug）**: L3a 或 L3b 败 →
  README 改行锁定；开 F-bug 修复票；
  as-is 0.1.5-rc.3 对照补跑作败因诊断；如实呈报，不掩盖。

**established/not-established 词汇表**（T5 机检 claims 使用此词汇，一字不差）:

```
established: [L3a, L3b, L3c-min, L3c-full, L3d, L3e]   # 任意子集
not-established: [L3a, L3b, L3c-min, L3c-full, L3d, L3e]  # 任意子集
```

### D2（=D-003）票序 + commit 结构（A″）

**七票序**:

| 票 | 描述 | 覆盖 D-xxx | commit 类型 |
|----|------|-----------|------------|
| T0 | 哨戒续班+宿主备版 | D-003 | chore |
| T1 | L3 判据立法+取证通道确认 | D-002/D-003 | docs+evidence |
| T2 | L3 冒烟执行 | D-002/D-003 | chore（evidence+判词） |
| T3【条件票】 | README 行对齐（判词≥降格档才启） | D-001/D-003 | docs |
| T4 | 小修+顺验批（四件四 commit） | D-001/D-003 | fix/docs/chore |
| T5 | 收口件批 | D-001/D-002/D-003 | docs |
| T6 | 门禁+审计 LOOP | D-003 | — |

**TC 条件票**: T0 目击 0.2.0 stable 晋升→启动，否则不启不留痕。
（T0 观测：next=0.2.0-rc.2, no stable → TC 不启）

**硬约束**:
- 一票一 commit，类型不混（fix/refactor/docs/chore 分票）
- T2 启动后不再复观 dist-tags（宿主版本轮中不漂移）
- T4 ship-gate fix 必须先于 T5（检测器先行）
- deprecate 修正限双空格+文案质量核对，不改写措辞；EOTP 如实记账按 R87 D4 执行态
- approval-channel 探测产出恒 evidence-only，不入判词

### D3 — WORKFLOW.md §4.2 外部承诺等价覆盖（ADR 判死）

**判死条款（D-条，supersede 语义）**:

WORKFLOW.md §4.2「版本控制外部承诺」自本 ADR 生效起，由以下机制等价覆盖，
显式登记为常驻裁决，无需 WORKFLOW.md 文件存在：

1. **GitButler skill + 全局 `but` 协议**（C:\Users\Administrator\.agents\skills\gitbutler\SKILL.md <!-- machine-local: user-level skill path @ 2026-09-29 --> + AGENTS.md `but` 规则）
   等价替代 WORKFLOW.md §4.2 所述「外部工具版本控制承诺」。
   具体：一票一 commit（类型不混）+ 禁裸 git 写 + 分支独立 + 无 tag/push/publish 除非用户明示。

2. **10+ 轮「缺位核销」审计发现封口条款**:
   自 R80 起已有 10+ 轮 ADR（R80~R91）未发现 WORKFLOW.md §4.2 承诺缺位导致的版本控制风险。
   本条款封口该缺位发现，归档为「已审计，等价机制覆盖，无残余风险」。

机外路径声明（AGENTS.md R79/R80 惯例）:
- GitButler skill 路径 C:\Users\Administrator\.agents\skills\gitbutler\SKILL.md <!-- machine-local: user-level skill path @ 2026-09-29 --> 为机外路径，带 marker 合规。
- hooks.json 路径为用户级路径，不在仓内，marker 已在 AGENTS.md ADR-0069 段落声明。

### D4 — T5 readme-token claims 立法（无条件票）

新 claim kind `readme-token-pin`：
- 断言对象：README.md dsh 行的版本字段（catalog 声明版本 vs 实测宿主版本）
- 检查器接线：T5 收口时执行首次机检，结果登记为 R92 候选票（本轮 evidence-only）
- 机检首跑：`node scripts/ship-gate.mjs --quick` 中 readme-token 腿不在本轮启用（两拍节奏）

## Consequences

- L3 验收判据以此 ADR 为唯一法律依据，不得轮中改题
- established/not-established 词汇表锁定，T5 机检一字不差复用
- WORKFLOW.md §4.2 缺位审计封口，GitButler skill 为等价覆盖机制
- TC 条件票本轮未启（T0 观测 0.2.0 stable 未晋升）
- T3 README 改行为条件票：仅当 T2 判词 ≥ 降格档（分支 A 或分支 B）才启

## 范围外

- repin（0.2.0-rc.2/0.1.7-rc.2 仅哨戒记档，不消费升级判词）
- 垂域死刑复核（r88-candidate，明文排期下轮主轴候选）
- defer-r72-dsh-web-interactive-matrix 主体
- 评测面/上游债/常驻债五项
- tag/push/publish（本 ADR 范围内无）
- pathlint 规则改动
- approval-channel 实质验证（探测之外）

## 票序节（逐票 sha+but-id 双锚）

（待 T6 收口后填写）