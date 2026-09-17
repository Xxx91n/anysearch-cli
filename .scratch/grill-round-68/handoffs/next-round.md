# R68 常驻任务书 — grill-round-68 → next-round

生成：2026-09-17（grill-round-68 定稿，账本 5 条 current）。
账本：D:\Aworker/anysearch-cli/.scratch/grill-round-68/decision-ledger.md（D-001~D-005 全 current）。
调研存档：D:\Aworker/anysearch-cli/.scratch/grill-round-68/q1-atomcode.md、q2-atomcode.md、q3-atomcode.md、q4-atomcode.md。
执行环境：ctx_batch_execute=bash；写文件用 node.js（源码一律前斜杠+String.fromCharCode(92) 转反斜杠——传输层折叠两个反斜杠为一个、JS 字符串非法转义静默丢字）；VC 写一律 but；atomcode 串行；交付文档一律绝对路径。

## 开工前硬事实（勿重查）

- main tip 红：d7bed91 与 2b9e6e8 上 ci+ship-gate 双 FAILURE（runs 35212667972/35212668001/35211959627/35211959694）。机制：9a466b9（release-bot pre-tag commit+push 回写 eval-looks.json）的 read→modify→write 剥掉根 schema_version:1，parity 测试红。
- 第二红点：D:\Aworker/anysearch-cli/packages/store/test/eval-abstain.test.ts:32 裸 runAll(GOLDEN_CASES) 无 excludeGroups，semantic 组须 test:online（ADR-0060 D7 边界）。
- R67 closeout（D:\Aworker/anysearch-cli/.scratch/grill-round-67/handoffs/round-67-closeout.md）缺 handoff-template 必填「绿色 run URL」段+无 Stack 行；「D:\Aworker 全量 evidence」措辞×4（文件实际已入库）。
- release.yml（D:\Aworker/anysearch-cli/.github/workflows/release.yml）：pre-tag（workflow_dispatch）contents:write 直推 main 不等检查；publish needs:release-gate（OF look 断言）从不查 tagged SHA 的 ci/ship-gate——v0.0.5 从红树发布。
- agy CLI 未装（独立安装器 antigravity.google/cli/install.ps1 → ~/AppData/Local/agy/bin，装=系统变更须用户授权）；Antigravity IDE 不执行 hooks（两独立复现）；agy 不注入 hook_event_name（须 argv 传回）、字段 camelCase；官方契约顶层 {decision:allow|deny|ask|force_ask|deny_unless_prior_grant, reason?}；无 SessionStart（5 事件）；Gemini CLI 已被取代。
- ADR 下一号=0069；CONTEXT「Grill Round 68 — Terms (ADR-0069)」8 词已落盘。
- pnpm 钉 11.24.0；better-sqlite3 allowBuilds=false 勿动；ans_* 前缀+fail-open 硬契约。

## T0 — 火线修红（覆盖 D-001, D-004）

- 文件：D:\Aworker/anysearch-cli/packages/store/src/eval/looks-ledger.ts、D:\Aworker/anysearch-cli/packages/store/test/eval-abstain.test.ts:32、D:\Aworker/anysearch-cli/eval-looks.json（补回 schema_version:1）。
- 修法=preserve-unknown-fields（Tolerant Reader）：读端保留原始 JSON 未知字段 merge-back，勿逐字段重建；写 round-trip 契约测试断言未知字段【字节级】保留（不只“能读”）。
- abstain 补 excludeGroups（对齐 ADR-0060 D7：semantic/vector-arm 归 test:online）。
- F-17 sweep 入完成定义：ast-grep/semgrep 找 JSON.parse→对象重建→writeFile 管线；diff 磁盘字段集 vs writer 构造字段集；excludeGroups 消费链回溯；范围限 eval-looks/golden 读写管线+测试加载链。预写规则：N>1 处→并入 T0 不扩轮。
- 验收锚：T0 commit 上 ci+ship-gate 真实双绿 run URL；eval-looks.json 根 schema_version 回在；sweep 台账落 D:\Aworker/anysearch-cli/.scratch/grill-round-68/evidence/。
- suggested skills：$implement、tdd、diagnosing-bugs。

## T1 — 双层门禁（覆盖 D-001, D-002, D-004）

- pre-tag job 自等：commit+push 后按【固定 SHA】两段轮询 check-runs（discovery ~60-120s 等出现 + completion 15-20min 硬超时 fail-closed；间隔≥15-30s；同名 check 取最新且全终态；concurrency:release）。优先 lewagon/wait-on-check-action 钉 SHA（内置 discovery-timeout/wait-for-duplicates）；手写 gh api 须复刻空窗处理。
- post-tag/publish 前置断言：tagged SHA 的 ci+ship-gate 全绿放行/红 fail-fast/in-progress 短轮询≤10min。
- 告警=job-failure+step summary+红时自动开 issue+可选给 bot commit 打 release-gate/failed commit-status。不做自动 revert。
- 验证=dry-run 打既有 concluded SHA（绿腿+红腿如可模拟）：不烧 OF look；partial verification 显式入账，首次真 pre-tag 前不得宣称 fully verified。
- 关联发现入 ADR-0069：v* tag ruleset、environment reviewer（可选）、PR-mode=future direction。
- suggested skills：$implement、atomcode-research（action pin 版本核验）。

## T2 — 收口必填栏 lint（覆盖 D-001, D-002, D-004）

- ship-gate 加 lint：.scratch/*/handoffs/ 收口文档须含「绿色 run URL」段+URL 形如 actions/runs/<id>+指向本轮 run。
- 与 T1 同 PR 系列；先红（R67 closeout 缺栏被检出）后绿（T4 回填后）证据对。
- suggested skills：$implement。

## T3 — antigravity spike→验收（覆盖 D-001, D-003, D-004）

- s0：跑官方 install.ps1 装 agy（系统变更须用户授权）→agy --version≥1.1.10、agy -p 返回。
- s1：双探 ~/.gemini/config/hooks.json 与 ~/.gemini/antigravity-cli/hooks.json + 项目 .agents/hooks.json；transcriptPath 的 antigravity-cli/brain 证执行表面=CLI；顺手复测 IDE 2.5.5 hooks（一腿成本）。
- s2：L0-L3 裁决重排=L-empty→L-decision（官方顶层形）→L-allow_tool（legacy）→L-plain-text（exit 语义）；adapter 审计点=hook_event_name 不注入须 argv 传回、camelCase 字段、exit-0-only 语义。
- s3：agy -p headless hooks 触发+输出可观测。任一环断→降级宿主限制证据记断点环号。
- 过则：adapter 修复（改前备份至 D:\Aworker/anysearch-cli/.scratch/grill-round-68/backups/t3/）+契约测试+验收 6 腿（契约端到端/session_id 传播/fail-open/PostToolUse {} 合规/SessionStart 不存在性复核+mdc 兜底/variance 可选）+SEP-2484 exclusion ledger。
- README per-surface：Antigravity CLI (agy)—verified (reduced matrix, ledger:<绝对路径>)；IDE 并列「hooks not executed by host; rules fallback only」。
- suggested skills：$implement、tdd、atomcode-research。

## T4 — 文书（覆盖 D-002, D-004, D-005）

- R67 closeout 回填「绿色 run URL」段=真实复绿 run URL（T0 产出）+Stack 行；「D:\Aworker 全量 evidence」×4 改为指向库内已提交证据+其绝对路径（deliverable 绝对路径纪律与锐评修正两兼容）。
- but-land 侧门治理票：直推 main 绕 PR 的政策裁决入档。
- ADR-0069（D:\Aworker/anysearch-cli/docs/adr/0069-*.md）：主题+D-002/D-003 决策条目+T1 验证边界显式声明+future direction（PR-mode/required-checks）+关联发现（tag ruleset/environment）。
- CHANGELOG 更新；lesson log=T1 dry-run 结果入档。
- suggested skills：$handoff、domain-modeling。

## T5 — 收口（覆盖 D-001, D-004, D-005）

- goal.md 定稿；四段收口证据齐（D-005 四段：修红/门禁/antigravity/文书）；found/fixed/deferred 三元组逐条闭环；生成本轮 closeout handoff——走 handoff-template 必填栏（自己刚立的 lint 先自查）；下一轮方向指示。
- suggested skills：$handoff、code-review（审计窗口惯例）。

## 红线

- 不烧 OF look 做门禁演练；首次真 pre-tag 前不宣称 gate fully verified；
- 不写裸「Antigravity verified」（须 per-surface）；spike 断则记断点不虚标；
- 修改现有文件前必须备份（D-001 显式约束+R67 惯例）；不做自动 revert；不轮 heads/main；
- 交付文档一律绝对路径；VC 写一律 but；atomcode 串行；grill 票外不动源码。