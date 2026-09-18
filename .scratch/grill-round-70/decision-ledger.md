# R70 Decision Ledger — grill-round-70

| ID | 原问题 | 我的原回答 | 规范化需求 | 约束/负向需求 | 状态 | 时间 |
|---|---|---|---|---|---|---|
| D-001 | R70 主题定界 | A | 验证层时序语义硬化单主题：主线=F-S4 开票（assert-checks-green 严格两段式 discovery/completion 截止语义设计+实现）；次级=store *.integration.test.mjs Windows 负载抖动处置（挂 Flaky Case Quarantine 既有机器或 limitations 记档，票内裁） | 显式范围外：真 release 摘 partial 帽 / agy ans-MCP P7 真链 / PR-mode required-checks 治理 / deferred 大项池（cursor/F-01a/npm provider/projectIndex/TUI/embedding/cross-OS/plugin/watch）；jitter 不得扩成独立轮 | current | 2026-09-18 |
| D-002 | F-S4 completion 时钟锚点+discovery 谓词（atomcode 调研裁定） | 采纳 A″ | assert-checks-green.mjs 改严格两段式：Phase 1 discovery=全 5 family 注册谓词（discovery-sec 120s 快败、exit 2 分列 missing/present）；Phase 2 completion=timeout-min 从进程启动起算的绝对 deadline 不变；RED 两段内即时短路；--once/exit 10 不动；错误行按 phase 拆分（D 内核并入）；ADR-0071 记 stub-registration 不变量（每个 required family 必有壳保证注册，禁改原生 paths: 过滤）+C 升格触发器（discovery 常态>30s 或 completion 吃紧事故）+近 30 次发布 check 耗时分位数证据 | 负向：禁 re-anchor（B=移动锚反模式且偏离 lewagon 契约）；禁加 --completion-min 第三旗（C=YAGNI，升格触发器留档）；禁只拆报错不动语义 | current | 2026-09-18 |
| D-003 | 票序结构 | A | 四票串行：T0=F-S4 落地（脚本两段式+头注更新+ESM 夹具新腿+契约测试+真 SHA --once 干跑 transcript）；T1=jitter 处置（Spike-Gated：先复现定位失败签名，再三裁一 quarantine/retry/limitations，复现不了则记档收口）；T2=文书（ADR-0071 三件必录：stub-registration 不变量/C 升格触发器/近 30 次发布 check 耗时分位数证据 + CONTEXT 新词+CHANGELOG+found/fixed/deferred 三元组）；T3=收口（goal 定稿+handoff+四段收口证据） | 负向：禁 T0+T1 并票（跨子系统混 diff）；禁 F-S4 再拆设计稿/实现两票（过仪式）；一票一验串行 | current | 2026-09-18 |
| D-004 | 收口判据 | A | 四段收口：(i) F-S4 段=脚本 diff+头注更新+夹具新腿先红后绿证据对（partial→all/never-appears exit2 点名/stale 落 completion）+真 SHA --once 干跑 transcript+land commit 上 ci+ship-gate 真实绿 run URL；(ii) jitter 段=spike transcript 全量，复现则签名+处置机制绿、复现不了则 limitations 记档引用不虚标；(iii) 值守段=ship-gate --quick 亲测 transcript 绿+release.yml 调用点 flag 语义未漂或同步 diff；(iv) 文书+收口段=ADR-0071 三件必录+CONTEXT 新词+CHANGELOG+found/fixed/deferred 闭环+全绝对路径+but commit 后工作区干净 | 负向：禁 CI 绿即收口；禁只账本约定无锚点；复现不了不得虚标 fixed | current | 2026-09-18 |

## 落地对账（T3 实施收尾追加，2026-09-18）
| D | 裁决落地 | 对账锚点 |
|---|---|---|
| D-001 主题定界 | 落地 | F-S4 主线 T0 落地（land 72495cb3）；jitter 次级 T1 Spike-Gated 处置（land 3b78b835）；三线+deferred 池未染指 |
| D-002 F-S4 设计 A″ | 落地 | `scripts/assert-checks-green.mjs` 严格两段式实现+头注；夹具 7 腿先红后绿；release.yml flag 未漂；--once/exit10 保真；禁项（re-anchor/--completion-min/只拆报错）全未犯 |
| D-003 票序 T0→T3 | 落地 | 四票串行各自 land：T0=72495cb3、T1=3b78b835、T2=9ebb9856（被 T3 push 顶替 superseded-cancelled，其 diff 全含于 6736aaae）、T3=6736aaae |
| D-004 四段收口 | 落地 | (i) F-S4 段证据齐（diff+头注+红绿对+真SHA --once+land run URL）；(ii) jitter 段 spike 复现+签名+处置绿；(iii) 值守段 ship-gate --quick 57x[pass] transcript+flag 未漂；(iv) 文书段 ADR-0071 三件必录+CONTEXT 新词+CHANGELOG+found/fixed/deferred+工作区干净 |

过程违规自报：无。WORKFLOW.md §4.2 任务书引用件缺失（全盘搜索确认不存在）——以 gitbutler SKILL+全局 but 协议等价覆盖，开工三件套内已声明偏差。
