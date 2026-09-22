# R68 closeout handoff — 2026-09-17

Stack (primary key = GitButler change-ids; SHAs are time-lagged):
  r68-grill → tnq/ouz/xmz @ 2026-09-17（r68-gate landed → e752254/3c3729f/af8a855）→ r68-fix → lkv（ee54479）→ r68-fix2 → nqm（f8a9c43）→ r68-t3 → 3d346ed（main tip at closeout）

接棒人下一轮（R69 或续跑）从这里开始。完整报告（git-committed，绝对路径）：`.scratch/grill-round-68/reports/2026-09-17-report.md`；任务书：`.scratch/grill-round-68/handoffs/next-round.md`；goal：`.scratch/grill-round-68/goal.md`。

## 一句话状态

**R68 全闭环**：T0–T5 全部完成——main 双红已修（Tolerant Reader preserve-unknown-fields），release.yml 双层门禁落地（pre-tag 自等固定 SHA + post-tag 断言 + 告警腿），ship-gate 新增收口必填栏 lint，agy 1.2.5 真宿主契约探明并重写 adapter（5 事件/protojson 决策/injectSteps 注入），ADR-0069 入档。

## 已完成的票

- **T0 火线修红**（commit `14514da`）：eval-looks.json 回 `schema_version:1`；looks-ledger.ts+cli.ts calibrate-reset 改 Tolerant Reader（索引签名+spread 保未知字段）；eval-abstain.test.ts 补 excludeGroups（semantic/vector-arm 归 test:online）；字节级 round-trip 契约断言；F-17 sweep 台账（N=2 同型，全修）。
- **T1 双层门禁**（commit `e752254`）：release.yml 加 release-gate job——pre-tag commit+push 后 wait-on-check-action@v1.9.1（pin 36976907）钉固定 SHA 等 ci+ship-gate 五 job 族（discovery 120s + step 20min fail-closed，同名取最新）；post-tag scripts/assert-checks-green.mjs 断言 tagged SHA 全绿（exit 2 fail-closed）；红则 job failure+step summary+自动开 issue+release-gate/failed commit-status；concurrency 收敛到固定 `release` 组。
- **T2 收口 lint**（同 `e752254`，ship-gate.mjs step1g）：.scratch/*/handoffs/ 收口文档必填栏=「绿色 run URL」段+Stack 行+actions/runs/<id> URL+liveness（gh 可解析时 headSha 须为本轮祖先）；作用域=diff 触碰∪最新收口文档。先红证据（R67 closeout 三违规）+后绿证据双入库。
- **T3 antigravity spike→验收通过**（commit `3d346ed`）：agy 1.2.5 官方 install.ps1 安装（用户授权）+OAuth 登录；s2 L 序全裁决（空=allow、{}=deny、protojson 严格、非零退出=工具 ERROR、injectSteps.ephemeralMessage=唯一 context 注入面）；s3 五事件全触发端到端（routing card 注入轨迹实证）；adapter 重写至实测契约 + hooks.json named-map + ans-hook-antigravity bin + 11 条契约测试 + SEP-2484 exclusion ledger。
- **T4 文书**：R67 closeout 回填（Stack 行+4 条真 run URL+措辞修正，commit `3c3729f`）；ADR-0069（D-001~D-005 全覆盖+T1 验证边界显式声明+治理裁决，commit `af8a855`）；CHANGELOG r68 条目+lesson-log（5 lessons）。
- **T5 收口**：goal 定稿+四段证据（本文件）+报告+handoff lint 自验。
- **过程中修复**：evidence-anchor 合规（ADR repo@sha 背引→permalink，`ee54479`）；handoff-lint CI 联通（ship-gate job 加 actions:read+GH_TOKEN env，api 全失败降级 skip 不误杀，`f8a9c43`）。

## 绿色 run URL（必填）

- ci（T0 `14514da`，success）：https://github.com/Xxx91n/anysearch-cli/actions/runs/35232698557
- ship-gate（T0 `14514da`，success）：https://github.com/Xxx91n/anysearch-cli/actions/runs/35232698560
- native-smoke（T0 `14514da`，success）：https://github.com/Xxx91n/anysearch-cli/actions/runs/35232698687
- ci（T1/T2+T4 land `af8a855`，success）：https://github.com/Xxx91n/anysearch-cli/actions/runs/35235880754
- ship-gate（修复后 tip `f8a9c43`，success）：https://github.com/Xxx91n/anysearch-cli/actions/runs/35240541694
- ci（`f8a9c43`，success）：https://github.com/Xxx91n/anysearch-cli/actions/runs/35240541598
- ci（T3 `3d346ed`，success）：https://github.com/Xxx91n/anysearch-cli/actions/runs/35247078761
- ship-gate（T3 `3d346ed`，success）：https://github.com/Xxx91n/anysearch-cli/actions/runs/35247078620
- native-smoke（T3 `3d346ed`，success）：https://github.com/Xxx91n/anysearch-cli/actions/runs/35247078558

## 四段收口证据（机器可复验）

(i) 修红：commit 14514da + 双绿 run（35232698557/35232698560）+ eval-looks.json schema_version 回在 + round-trip 字节级断言（eval-docs-golden.test.ts §7）+ abstain 绿 + F-17 台账 .scratch/grill-round-68/evidence/f17-sweep-ledger.md。
(ii) 门禁：release.yml diff 全要素 + dry-run transcript .scratch/grill-round-68/evidence/t1-dryrun-transcript.txt（绿 14514da exit0 / 红 d7bed91 exit1 / 无信号 4833833 exit2）+ **部分验证声明**（首次真 pre-tag dispatch 前不称 fully verified）+ T2 lint 先红（R67 三违规检出）后绿（35240541694 全 4 job 绿，CI 内 liveness 腿真跑）。
(iii) antigravity：spike s0-s3 transcript 全量 .scratch/grill-round-68/evidence/t3-s0s1-probe.md + t3-s2s3-verdict.md；6 腿验收（5 passed + session 传播 contract-level + variance excluded-optional）+ exclusion ledger（P7 ans-MCP excluded、P8 -c excluded、P9 IDE excluded-宿主不执行）+ adapter 修复 commit 3d346ed + 契约测试 11 条 + README per-surface 拆分。
(iv) 文书+收口：R67 closeout 回填（35210635315/35210635308/35211150217/35211259312 真实 URL）+ but-land 治理裁决入 ADR-0069 D5 + lesson-log + 本文件 lint 自验。

## found/fixed/deferred 三元组

- found（本轮新发现）：eval-looks 剥字段管线 N=2（looks-ledger+cli.ts calibrate-reset，F-17 sweep）；handoff-lint CI 缺 GH_TOKEN（api 全失败误报违规）；ADR evidence-anchor 拒 repo@sha 背引形；agy hooks Gemini 包装形死文件；agy stdin 无 hook_event_name/无 tool_output；agy {} 在 PreToolUse=deny；agy -p 被挂起 MCP server 阻塞。
- fixed：全部 found 项已修（见各票）。
- deferred（移交下轮）：PR-mode+required-checks+tag ruleset/environment reviewers（ADR-0069 future direction）；agy ans-MCP 真链腿（P7 excluded——probe 沙箱无 ans server）；agy -c 会话续传（P8）；Antigravity IDE hooks（宿主不执行，README 记 rules-fallback-only）；cursor 真宿主（无二进制）；F-01a 工具链桶；npm prefix 双根；provider 服务端；projectIndex 双库；interactive TUI；embedding arm；跨 OS matrix；plugin 升格默认路径；watch 观测窗。

## 下一个 grill 方向指示（按建议优先级）

1. **首次真 release 验证 T1 门禁**：pre-tag dispatch 实跑 wait-on-check-action 腿 + post-tag assert 腿——在此之前门禁维持 partial verification 声明。
2. **agy ans-MCP 真链腿**（P7 excluded）：在用户真 HOME 下注册 anysearch MCP 到 agy，跑 call_mcp_tool 内层名解包+pending flush 全链。
3. **PR-mode/required-checks 治理落地**：ADR-0069 D5 future direction——but land 直推 main 已五次使用，tag ruleset/environment reviewer 待设计。
4. **deferred 池**（沿用）：cursor 真宿主、F-01a 工具链桶、npm prefix 双根、provider 服务端、projectIndex 双库、interactive TUI、embedding arm、跨 OS matrix、plugin 升格、watch 观测窗。

## 关键事实（勿重查）

- agy 1.2.5 契约（ADR-0069 D4）：stdin camelCase（conversationId/toolCall{name,args}/workspacePaths），无 hook_event_name（argv 传事件）；stdout 严格 protojson——PreToolUse {}=DENY、空=allow、{decision,reason,permissionOverrides}；PostToolUse 只收 {}；context 注入=Pre/PostInvocation injectSteps[].ephemeralMessage；PostToolUse 无 tool 输出；非零退出=工具 ERROR。
- agy hooks 双读面：~/.gemini/config/hooks.json + ~/.gemini/antigravity-cli/hooks.json 均装载；named-hook map 才过解析；非工具事件扁平 handler、工具事件 matcher-group。 <!-- machine-local: 用户级 ~ 路径引用（存量合规化） @ 2026-09-22 -->
- agy -p 挂起陷阱：配置的 MCP server 连不上会阻塞 turn 初始化（1mcp 实测）；隔离 HOME 可绕。OAuth token 在 Windows Credential Manager，与 HOME 无关。
- release.yml 门禁：check 族=check-build/install-smoke/test:online/ship-gate/memory-eval；native-smoke+macos-spillover-probe 在门外（实验腿）。
- VC：but land 直推 main=本轮惯例（ADR-0069 D5 已裁决+记录 future direction）；hook 进程 cwd=hooks.json 所在目录（workspacePaths 空时 mdc 兜底落点会偏）。
- 探针沙箱：D:/Aworker/agy-sandbox（仓外，含 hooks.json 实验配置+spike 脚本+dump 全量）。 <!-- machine-local: machine-local path cited in committed doc @ 2026-09-19 -->

## Suggested skills

- R69 grill 开门：`$grill-me` / `$to-questionnaire`（方向见上节——首推真 release 验证 T1 门禁）
- agy 相关迭代：`$implement`（契约测试已建网，改动须过 antigravity-contract）
- 审计窗口惯例：亲跑硬验收+声明→证据→结论对照+双轴 code-review
