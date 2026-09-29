# R91 Decision Ledger

| 状态说明 | current=现役决策 revised=已被后续记录修订（保留原文） stale=事实过期 deferred=显式押后 |
|---|---|

<!-- 记录格式：D-NNN | 原问题 | 用户原回答原文 | 规范化需求 | 显式约束/负向需求 | 状态 -->

---

## D-001 — R91 主轴裁决（售后验收轮）

- **原问题**：Q1 — R91 主轴裁决。A 售后验收轮（L3 实机冒烟→README 行对齐+readme-token claims 机腿+WORKFLOW.md 终审+弃用文案+ship-gate 正则+approval-channel 同台架顺验票内裁）；B 垂域死刑复核轮；C approval-channel 独立验证轮；D 纯清账轻轮；E 另指。
- **用户原回答原文**：「A」
- **规范化需求**：R91=售后验收轮。正题=dsh 原生工具面 L3 实机冒烟（`--profile headless` 真宿主跑通五 ans_* 工具调用链，stream-json transcript 取证）；冒烟绿才动 README.md:227/README.zh-CN.md:217（版本+拓扑对齐现役）+integration 专文同步+readme-token claims 机腿立法（表与 catalog 漂移从此有机器闸）。同域纳编：WORKFLOW.md 终审（写或 ADR 判死）、弃用文案双空格修正、ship-gate.mjs `id:s*mcp` 正则修补、approval-channel 同台架顺验（票内裁）。
- **显式约束/负向需求**：repin 不做（0.2.0-rc.2 在架仅 T0 哨戒记录）；垂域重议不复活但明文排期为下轮主轴候选（开庭传票非核销）；defer-r72-dsh-web-interactive-matrix 主体维持 defer；无 tag/push/publish 除非用户明示；一票一 commit；票级熔断=同票连续 2 LOOP 失败回退缩轮呈报；失真三向（R84 D-007）+断言载体预注册承继；pathlint 冻结不动；npm deprecate 为外发元数据动作（EOTP 可能需用户亲触）。
- **状态**：current
---

## D-002 — L3 冒烟验收判据预注册 + 宿主版本选型（A″，atomcode 修订版）

- **原问题**：Q2 — L3 冒烟验收判据（探针跑前立法什么算绿）+宿主版本选型。A 五层判据+升 0.1.7-rc.2；B as-is 0.1.5-rc.3；C 全层含 hooks 复验；D 另指。经 atomcode 调研修订为 A″。
- **用户原回答原文**：「采纳」
- **规范化需求**：宿主升 @deepseek-ai/dsh@0.1.7-rc.2 单版本冒烟（测=记=钉三版收敛）。**门判据三腿**：L3a 装册绿（plugin add+--dump-config 见 bundle 层单行，确定性）；L3b 枚举绿（stream-json transcript 的 model-request tools 载荷含五 ans_* 裸名+inputSchema；前置义务=跑前先实证 transcript 取证通道存在，不可得则 L3b 不可判定须回报）；L3c-min 执行绿（≥1 个 ans_* 真实调起并完成 ans-mcp /mcp 往返回，content 或 isError 皆算；诱导任务措辞跑前定死不得改题迁就模型，N=3 重试上限）。**增强判据**：L3c-full 五工具诱导矩阵逐命中（不阻塞 README 改行，只决定 claim 措辞宽窄→established/not-established 清单）。**非判据**：L3d fail-open=同台架顺验项（测 execute 层 ans-mcp 死亡容忍，非注册面）；L3e hooks 面=免测引用 R72 wire 证据档。**判词三分支**：a+b+c-min 全绿→README 改行解锁；仅 a+b（c-min 未达）→如实改行+status 降格措辞带 established/not-established 清单+呈报；a 或 b 败→F-bug 立项（败因诊断含 as-is 0.1.5-rc.3 对照补跑）。
- **显式约束/负向需求**：门内判据≤3 腿（5-8 条上限纪律），d/e 明文标「非判据（顺验/免测）」防误读为门槛；as-is 对照冒烟仅作败因诊断工具不作验收门；双版本冒烟不做（rc 生态维护税）；hooks 面不复验（无信息增量）；诱导任务措辞与 N=3 须写入判据本身（跑中不改）；全量工件落盘（transcript/verdict 双工件对质）。
- **状态**：current
- **依据**：atomcode R91-Q2（mcp-smoke silent-first-turn-tool-loss/Autonoma 三层法/AgentV 四层 taxonomy/Agent-smoke-testing viability gate/Momentic 预注册/zimster exact-build claim+not-established 列/hermes-qvac exact hash，≥2 独立信源/结论）；信息缺口=0.1.7-rc.2 changelog 不可公网核验（升版风险冒烟兜底）+transcript tools 载荷存在性为跑前确认项+Cordis register 官方语义未公开。
---

## D-003 — R91 票序 + commit 结构 + 条件票（A″，atomcode 修订版）

- **原问题**：Q3 — 轮内票序+commit 结构+纳编边界。A 八票序；B approval-channel 升门禁票；C 判据立法并入探针票；D 另排。经 atomcode 调研修订为 A″ 七票序+TC。
- **用户原回答原文**：「采纳」
- **规范化需求**：七票序——T0 哨戒+宿主备版（dist-tags 复观一次记档 0.2.0-rc.2/0.1.7-rc.2+stable 检查**一次定死 TC 启停窗口**+本机升 0.1.7-rc.2+check/test/ship-gate --quick 基线快照）；T1 L3 判据立法（ADR-0092：门三腿+非判据标注+三分支判词+诱导任务措辞跑前定死+N=3+**established/not-established 字段词汇预注册**）+transcript 取证通道确认探针（**=T2 entry criterion**，证伪→判词落 F-bug 分支）；T2 L3 冒烟执行（pack→plugin add→dump-config→诱导 turns→transcript/verdict 双工件落盘→判词，F-bug 熔断转修复）；T3 README 行对齐【条件票：判词≥降格档才启】（README.md:227/README.zh-CN.md:217 版本+拓扑+status 对齐实测+integration 专文同步检查）；T4 小修+顺验批四件四 commit（ship-gate 正则 s*→s* fix 独票须先于 T5；弃用文案 deprecate 备准+尝试+EOTP 呈报按 R87 D4 执行态记账不记 clean fail；approval-channel 可行性探测 evidence-only 顺验低成本可挂 T2 同 rig；WORKFLOW.md 终审 ADR 判死=supersede 语义登记等价机制覆盖+审计发现封口+文内机外路径带 machine-local marker）；T5 收口件批（ADR-0092 完成体+CONTEXT 词块+registry 更态+**readme-token claims 立法无条件票**+closeout-claims+报告+任务书终态戳+CHANGELOG r91 段；机检首跑显式登记 R92 候选票）；T6 门禁+审计 LOOP。TC=T0 目击 0.2.0 stable 晋升→closing probe（消费子集+r72 实施面 .d.ts 再 diff），未目击不启不留痕。
- **显式约束/负向需求**：条件票不携带无条件内容（「未启不留痕」语义纪律）；一票一 commit 类型不混；claims 机检词汇与 D-002 判词词汇一字不差；T2 启动后不再复观 dist-tags（宿主版本轮中不漂移）；deprecate 修正限双空格+文案质量核对不改写措辞；approval-channel 探测产出恒 evidence-only 不入判词；机检首跑不在本轮（两拍节奏，R92 首跑登记）。
- **状态**：current
- **依据**：atomcode R91-Q3（Kualitee gate-ordering/Scrum Alliance AC/npm deprecate 官方/Fowler Spike+ADR supersede/Documentation Theater 反模式，≥2 信源/结论）；R87 D4/R83 TE1/R89 D-003 仓内先例。
