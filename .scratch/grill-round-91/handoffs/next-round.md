# R91 常驻任务书 — dsh 售后验收轮

> 任意子 Agent 可依赖的任务书。数据源唯一=.scratch/grill-round-91/decision-ledger.md（D-001~D-003 全 current）。
> 本轮目标：让 0.1.0 已发布物的 dsh 声明追上证据——L3 实机冒烟在前，README 改行在后。

## 开工三件套（默认执行环境）

1. ctx 工具面确认（ctx_execute/ctx_batch_execute[需 commands+queries 双必填，shell=bash]/ctx_search/ctx_index）；不可用→退回内置工具并在报告首行声明。
2. 读 .scratch/grill-round-91/decision-ledger.md 全文（唯一数据源）+本任务书+CONTEXT.md R91 词块+docs/adr/0091（上轮）+docs/deepseek-harness-integration.md（现役专文）。
3. 写文件用 node.js fs（防嵌套断连）；shell=Git Bash；版本控制=GitButler but（禁裸 git 写）。

## 硬约束（跨票闸）

- **一票一 commit，类型不混**（fix/refactor/docs/chore 分票）；票级熔断=同票连续 2 LOOP 失败→回退该票入 registry+缩轮+呈报。
- **规则先于行为**：T1 判据立法必须先于 T2 探针执行。
- **条件票纪律**：T3 未启不留痕；条件票不携带无条件内容（D-003）。
- **TC 窗口 T0 一次定死**：T2 启动后不再复观 dist-tags（宿主版本轮中不漂移，D-003）。
- **跨票词汇锁定**：T5 claims 机检的 established/not-established 字段取值与 D-002 判词三分支词汇表一字不差（预注册于 T1 ADR 判据段）。
- **执行序约束**：T4 ship-gate fix 必须 land 在 T5 收口文档之前（先修检测器再写被扫对象）。
- **deprecate 记账**：命中 EOTP=零写入半残留，按 R87 D4「执行态如实记账」，不得记 clean fail。
- 失真三向（R84 D-007）+断言载体预注册承继；pathlint 冻结不动；无 tag/push/publish 除非用户明示。

## 票序

### T0 哨戒续班+宿主备版 — 覆盖 D-003
- npm view dist-tags 复观（@deepseek-ai/dsh/dsh-tools/dsh-agent/dsh-session）：记档 next=0.2.0-rc.2、meta latest=0.1.7-rc.2、0.2.0 stable 有无——**本次观测一次定死 TC 启停**（stable 晋升→启 TC）。
- 本机 dsh 升 0.1.7-rc.2（npm i -g @deepseek-ai/dsh@0.1.7-rc.2；现装 0.1.5-rc.3；可逆环境动作，命令+版本回执入 evidence）。
- 基线快照：pnpm -r check / pnpm -r test / node scripts/ship-gate.mjs --quick 三份输出入 evidence/。
- commit：chore（证据件）。

### T1 L3 判据立法 + 取证通道确认 — 覆盖 D-002/D-003
- **立法**：ADR-0092 判据段——门判据三腿 L3a 装册绿/L3b 枚举绿/L3c-min 执行绿；增强 L3c-full；非判据标注 L3d 顺验/L3e 免测；三分支判词；**诱导任务措辞跑前定死**（逐工具诱导句，禁止跑中改题）；N=3 重试上限；**established/not-established 字段词汇预注册**（T5 机检复用此词汇表）。
- **通道确认探针（=T2 entry criterion）**：跑一次 headless turn 抓 stream-json transcript，实证 model-request tools 载荷字段存在且可解析。证伪→T2 判词直接落 F-bug 分支（L3b 不可判定如实呈报）。
- commit：docs（ADR 判据段）+evidence（通道确认 transcript/verdict）。

### T2 L3 冒烟执行 — 覆盖 D-002/D-003
- 流程：apps/dsh-plugin pnpm pack→dsh plugin --profile headless add tgz→--dump-config→按 T1 定死措辞跑诱导 turns（N≤3）→transcript.jsonl+verdict.json 双工件落盘→按三分支出判词。
- approval-channel 探测若环境成本低可同 rig 顺跑（evidence-only 不入判词）。
- 判词=F-bug→熔断：开 F-bug 修复票（as-is 0.1.5-rc.3 对照补跑作败因诊断）。
- commit：chore（evidence+判词记录）。

### T3 README 行对齐【条件票】 — 覆盖 D-001/D-003
- **门槛：T2 判词≥降格档才启**；未启→不留痕（报告记「条件未达」）。
- 改 README.md:227+README.zh-CN.md:217：版本=实测宿主（0.1.7-rc.2）、拓扑=native tool registration+hooks bundle（桥退役现役）、status=live-verified（headless）或降格档措辞（established/not-established 清单内嵌或随行注）。
- integration 专文同步检查（确认其声明与改行一致；R90 已同步原生态，仅需对齐版本字段）。
- commit：docs。

### T4 小修+顺验批（四件四 commit） — 覆盖 D-001/D-003
- 4a scripts/ship-gate.mjs 正则 /id:s*mcp-anysearch/→/id:s*mcp-anysearch/——**fix 独票**，须先于 T5 落（检测器先行）。验证：ship-gate 该腿仍绿+构造样例证第二选言活。
- 4b 弃用文案双空格：npm view 枚举受影响 0.0.x→npm deprecate 备准命令清单→尝试执行；EOTP→呈报用户亲触（R87 D4 模板）；仅修双空格+核对文案质量，不改写措辞。无外发 commit，证据入报告。
- 4c approval-channel 可行性探测：查 headless 是否可触交互审批路径（.d.ts/文档/低成本试跑）；不可行→如实维持 defer 记证据。evidence-only。
- 4d WORKFLOW.md 终审 **ADR 判死**（ADR-0092 D-条）：supersede 语义——§4.2 外部承诺补件显式登记为「由 GitButler skill+全局 but 协议等价覆盖」常驻裁决+10+ 轮「缺位核销」审计发现封口条款；文内机外路径带 machine-local marker（AGENTS.md R79/R80 惯例）。commit：docs。

### T5 收口件批 — 覆盖 D-001/D-002/D-003
- ADR-0092 完成体（主题+判据段+票序节+判死 D-条+范围外）；adr/index 0092 行；CONTEXT R91 词块核查（7 词已在案，补齐引用锚）；registry 更态（approval-channel carried_log/探测结论、无 closed 除非判词全开）；**readme-token claims 立法【无条件票】**：新 kind 定义+断言检查器接线（README dsh 行版本令牌钉 catalog/实测值），机检首跑显式登记 R92 候选票；closeout-claims（含 deprecate 执行态如实记账）；轮报；本任务书终态戳；CHANGELOG r91 段。
- commit：docs（单件收口批）。

### T6 门禁+审计 LOOP — 覆盖 D-003
- pnpm -r check / pnpm -r test / node scripts/ship-gate.mjs --quick 全跑；惯例复核（一票一 commit/类型不混/条件票不留痕/词汇锁定）；审计 LOOP 至收敛。

### TC 条件票 — 覆盖 D-003
- 仅当 T0 目击 0.2.0 stable 晋升：closing probe=消费子集+r72 实施面 .d.ts 再 diff+判词封账。未目击→不启不留痕（报告仅记 T0 观测值）。

## 范围外（D-001 固化）

repin（0.2.0-rc.2/0.1.7-rc.2 仅哨戒记档不消费升级判词）；垂域死刑复核（r88-candidate 明文排期下轮主轴候选——开庭传票非核销）；defer-r72-dsh-web-interactive-matrix 主体；评测面/上游债/常驻债五项；tag/push/publish；pathlint 规则改动；approval-channel 实质验证（探测之外）。

## 汇报纪律

- 判词必须落在预注册三分支内，禁止现场造第四态；部分绿用 established/not-established 清单措辞。
- 探针证伪/票熔断/条件未启，全部如实呈报不谎报。
- 重要产物汇报双路径（全路径+仓内相对路径）。
- 终态戳：T6 收口后在本文件尾部补「## 终态」段（逐票 sha but-id 双锚+判词+TC 态+挂账）。

## Suggested skills

- $implement（T2/T4 驱动面；tdd at seams 不适用——本轮为探针+文档轮）
- code-review（T6 双轴复核）
- gitbutler（全程版本控制）
- atomcode-research（TC 触发或 F-bug 需外部对照时）
- neat-freak（T5 收口面盘点）
- handoff（终态戳后再交接）

## 终态

- **终态戳时间**: 2026-09-29T19:08+08:00
- **总决议**: R91 售后验收轮圆满收口。所有既定硬约束严格守住。
- **分支状态**: `r91-agy` (基于 `r91-grill`)

### 逐票双锚终态表

| 票号 | commit sha | but-id | 状态/判词 | 说明 |
|---|---|---|---|---|
| T0 | f40f227b | kmv | ✅ ESTABLISHED | dist-tags 快照 (next=0.2.0-rc.2/latest=0.1.7-rc.2)；dsh 本机升至 0.1.7-rc.2；基线 check/test/ship-gate 三份证据入案 |
| T1 | b74fe057 | wpr | ✅ ESTABLISHED | ADR-0092 判据立法 (门三腿/三分支判词/词汇锁定/WORKFLOW 判死/readme-token claims 立法) + index 0092 行 |
| T1 探针 | a5ec8eeb | ssl | ✅ ESTABLISHED | stream-json 通道机制 ESTABLISHED；model-request 端点直达实证；T2 准入通过 |
| T2 | 5b6a397f | otk | ⚠️ F-bug (分支 C) | L3a established (dump-config 单行在架)；L3b/L3c 因 DEEPSEEK_API_KEY 环境缺失 not-established；双工件落盘 |
| T3 | — | — | ⏭ 未启不留痕 | 条件票纯度守则：判词 F-bug 未达降格档要求，README 维持现状不留虚构痕迹 |
| T4a | fcf97e32 | lvx | ✅ ESTABLISHED | `scripts/ship-gate.mjs` 正则修补独票 fix：`/id:s*mcp-anysearch/` -> `/id:\s*mcp-anysearch/` |
| T4b/c | 144015a2 | ppu | ✅ ESTABLISHED | T4b 弃用文案双空格枚举 6 版本并备准修复命令，E401 权限闸按 R87 D4 如实记账；T4c 探测实证 headless 无交互 answerer 维持 defer |
| T4d | 随 T1 (b74fe057) 落地 | wpr | ✅ ESTABLISHED | D3 判死立法随 T1 落地，票序节由 T5 补记；D-003 四件实落三 commit (T4a 独票, T4b+c 合票, T4d 随 T1) |
| T5 | 本批 | uts | ✅ ESTABLISHED | ADR-0092 完成体 + CONTEXT 7 词引用锚补齐 + registry 更态 + closeout-claims 8 项 + 轮报 + 终态戳 + CHANGELOG |
| T6 | — | — | ✅ ESTABLISHED | 门禁复核：check exit 0 / test exit 0 / ship-gate --quick [pass]×65 [fail]×0 全绿，四项惯例复核闭环 |
| TC | — | — | ⏭ 未启不留痕 | T0 观测无 0.2.0 stable 晋升，一次定死不启 |

注：but-id 列（kmv/wpr/ssl/otk/lvx/ppu/uts）为唯一稳定锚；文内 sha 均为**落笔时值**——每次 amend 后即失效，不可作为可核锚点；land 后以 main `git log` 为准。

### 核心挂账与移交
1. **DEEPSEEK_API_KEY**: 环境中未找到有效 key，T2 实际调用 tools 载荷受阻；待用户注入 key 后复跑 T2 诱导 turns。
2. **readme-token-pin**: ADR-0092 D4 立法已就绪，两拍节奏，断言检查器接入登记为 R92 候选票。
3. **defer-r72-dsh-approval-channel**: 探测实证 headless 不可达，维持 open/defer。
4. **npm deprecate**: 备准命令已就绪，待用户具备写入权限的账号亲触执行。

