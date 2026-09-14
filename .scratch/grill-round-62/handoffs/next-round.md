# Round-62 Fixer 任务书（常驻）— 产品真实可用性收口

> 生成：2026-09-15 · grill-round-62 定稿后整理
> 适用对象：任意子 Agent——读本文件 + 账本即可独立执行，不需要对话记忆。
> 数据源纪律：本任务书只索引结论；规范以 `.scratch/grill-round-62/decision-ledger.md`（D-001..D-011）为唯一权威，冲突时以账本为准并标 revised 呈报，禁止静默改向。

## 0. 上下文指针（先读这些，再动手）

| 文件 | 作用 |
|---|---|
| `.scratch/grill-round-62/decision-ledger.md` | 全部 11 条 current 裁决（唯一权威） |
| `.scratch/grill-round-62/goal.md` | /goal 防丢失：目标、验收总闸、硬约束、已读清单 |
| `.scratch/grill-round-62/q2,q4,q5,q5b,q6,q7,q11-atomcode.md` | 各题调研报告（含落地要点、来源、冲突声明） |
| `CONTEXT.md` "Grill Round 62 — Terms" | 本轮新词表（Declared Exclusion / Golden Entry Scope / Spillover Probe / Install Closure） |
| `docs/adr/0033,0057,0059,0060,0061,0062` | 被引用/被修订的 ADR |
| `.scratch/grill-round-61/handoffs/2026-09-14-audit-handoff.md` | 上轮审计（F1-F5 呈报项的原始描述） |

**背景一句话**：main tip `e592cb6` CI 三红（check-build 出处失败、install-smoke 离线断言被免 key 通道击穿、ship-gate macOS libc++abi 崩）；安装闭包含 onnxruntime-node ~728MB（embedding 经 store 静态 import 拖入）；r61 栈（abstain 双闸+README）在本地 GitButler 未落 main；golden.expected 无执行器（F4）；ans_chat 面缺审计事件（F3）；判据5 探针待 key（F2，key 已到位见 T8）。本轮 = 把"产物存在"推进到"产品可实测"，终点 npm 0.0.1 go/no-go。

## 1. 任务表（串行 T1→T9，每票一 but 分支 + 独立验收锚）

| 票 | 覆盖 D-xxx | 做什么 | 主要触点 | 验收锚 |
|---|---|---|---|---|
| **T1** | D-001 局部 | docs-g0007 出处一行修：`eval-looks.json` 中 provenance.ref 指 `.scratch/grill-round-59/q3-prompt.md`（未跟踪）→ 指向已跟踪文件（票内裁决目标，候选：相关 ADR 段或 tracked 调研文档；若必须引用 scratch 文件则按 .gitignore 白名单惯例补录该文件） | `eval-looks.json`、可能 `.gitignore` | `node packages/store/test/eval-docs-golden.test.ts` provenance 断言绿；check-build CI 腿转绿 |
| **T2** | D-004 | install-smoke 离线腿重设计：`packages/retriever/src/providers/anysearch.ts` 接线 `ANYSEARCH_ENDPOINT` env 覆盖（构造器已收 endpoint 参数）；offline 腿指死端口（如 http://127.0.0.1:9）；断言改锚 `--json` 结构化字段 `abstain:true && providersFailed∋anysearch && results.length===0`；删 exit1/Results:0 旧断言 | `anysearch.ts`、`scripts/install-smoke.mjs`、相关测试 | install-smoke offline 腿双 OS 绿且零外网依赖；断言只锚 stdout 结构字段 |
| **T3** | D-002 | embedding 降可选：`packages/embedding` 移 optionalDependencies；`store/src/session-store.ts:23` 与 `consolidate.ts:10` 静态 import 改守卫式 `await import`（缺席 embedText≡null、cosineSimilarity ~11 行内联）；`apps/cli` tsup external 加 `@anysearch/embedding`；install-smoke 断言净机 node_modules 无 onnxruntime-node；doctor 显示向量臂缺席遥测；ADR-0033 D2 标 revised 补子条款（消费安装闭包中 onnxruntime-node 必须可选缺席，整篇不 Supersede） | `packages/embedding/package.json`、`store` 两文件、`apps/cli/tsup.config.ts`、`install-smoke.mjs`、doctor、ADR-0033 | 净机安装闭包无 onnxruntime-node（断言进 CI）；向量臂缺席走 fail-open FTS-only 不 throw；tsc/test 全绿 |
| **T4** | D-003 + D-007 | F1 teardown 有界修 + macOS 探针臂同票：①命令路径 return 前显式 `store.close()`/`observation.close()`（或 index.ts 改 `process.exitCode+drain+unref` 兜底）；②ship-gate.yml macos 腿改 continue-on-error 最小探针（install+build+只跑 eval-gate/abstain 复现路径），job 名 `experiment (F-16 spillover probe, non-blocking)`，崩溃签名（libc++abi vs SIGSEGV exit139）进 step summary，先 `node -v`+`new Database(":memory:")` 冒烟排除 #1514；③无条件文档动作（审计报告"exit code 不受影响"定性改正——落 T9） | `apps/cli/src/index.ts`、`commands/search.ts` 等退出路径、`.github/workflows/ship-gate.yml` | 全量 ship-gate + abstain live arm 连跑 ≥5 次零崩溃；探针 ≥5 连绿→升正式矩阵腿+评估 onnxruntime≥1.24.1（ADR-0059 D4③）；仍崩→剪矩阵+H3 台账续期+README 照实 |
| **T5** | D-005 | ship-gate 静态断言四件（golden-cases 断言点 `ship-gate.mjs:458-460` 同构，stdlib ~10 行）：①OFFLINE_EXCLUDED_GROUPS 存在性 ②白名单精确匹配字面恰为 `["semantic"]` ③离线覆盖下界 offlineCases()/GOLDEN_CASES≥0.75 ④断言 ci.yml 存在 test-online job 且含 test:online 步 | `scripts/ship-gate.mjs`、`.github/workflows/ci.yml` | 断言存在且当前绿；把白名单改 `["semantic","x"]` 应撞红（验证后即还原） |
| **T6** | D-006 | golden 双层执行器：①schema 加 `scope:stub|live|both`（answer&&mustHit* 条目强制显式，无默认兜底），g0013 标 stub 闭 F5；②离线层=store 新测试复用 kernel mockProvider 缝，夹具独立于 expected 取 badcase observed 现场，断言引擎产出 expected.verdict/abstain 结构/mustHit 结构处理；③在线层=`test/online/` 新文件对 scope:live 条目跑真 provider 硬断言 verdict/mustHitHosts/mustHitUrls/minResults，挂 ci.yml test-online job；④flaky 走 eval-quarantine.json（ADR-0027 D8） | `eval-looks.json`(schema+entries)、`eval-docs-golden.test.ts` 或新测试、kernel mockProvider、`test/online/`、ci.yml | golden.expected 被 runner 真跑（F4 闭）；g0013 scope 标记落盘（F5 闭）；离线层全离线可跑；在线层只在 test-online 腿跑 |
| **T7** | D-011 | F3 span 透传（内核运行时层）：`PiAgentRuntimeOptions` 增可选 `span?:RetrievalObservationSink`（或 getSpan），`createSearchTool` 构造 Query 透传 `span:opts.span`；MCP 侧 `ans-chat.tool.ts:38` 的 observeTool callback 改 `async (span) =>` 接入 PiAgentRuntimeOptions（一行） | `packages/kernel/src/pi-runtime.ts`、`apps/mcp/src/tools/ans-chat.tool.ts` | `observability_spans` 中 ans_chat 路径 span 的 events_json 出现同源 `retrieval.domain_filter.pre/post` 且属性含 `anysearch.policy_version`/`anysearch.outcome`（同构 domain-filter.test.ts:77-87 离线断言） |
| **T8** | D-008 | tavily 探针回填判据5：key 在用户环境变量 `1`（程序化读取 `[Environment]::GetEnvironmentVariable("1","User")` 或 `process.env["1"]`，**禁 echo/落盘/进 git/进报告明文**）；跑 `TAVILY_API_KEY=<env> node scripts/probe-tavily-domains.mjs`（D 臂加 `PROBE_TAVILY_RESEARCH=1`）回填 `.scratch/grill-round-62/tavily-probe-ledger.*`；CI 腿要绿需 repo secret `TAVILY_API_KEY`——`gh secret set` 把 key 推上 GitHub 属外部副作用，**执行前必须用户当场点头** | `scripts/probe-tavily-domains.mjs`、tavily-probe-ledger、ci.yml secrets 引用 | 探针四臂实跑非 SKIPPED；账本回填；判据5 终审关闭（filter 硬模式不泄漏的 live 证据） |
| **T9** | D-001/D-002/D-003/D-004/D-005/D-007/D-009 收口面 | 文档收口：①Round-62 ADR（编号 0063）：主题、逐 D 决策、收口判据（D-009 全绿定义）、与 R61 D-003 契约替换关系（abstain exit 0 取代 exit1）、ADR-0033 D2 revised、回落/探针结果记录、绿色 run URL 证据栏；②README Known Limitations（macOS/exit-code 缺陷、判据5 状态照实）；③handoff 模板加"绿色 run URL"必填栏；④due-chores 捆绑按 ADR-0029 走独立 refactor 提交：ship-gate step1a "pin to 0.0.1" 硬断言、--fail-on-abstain 进 --help、outcome 维度措辞、handoff 首行 hash 时滞标注、根 JSON 双 schema 清理 | `docs/adr/0063-*.md`、README、handoff 模板、ship-gate.mjs、CLI help | ADR 含全部 revised/errata；handoff 模板有 URL 栏；chores 各自独立 commit；`gen-adr-index --check` 绿 |

**票序纪律（D-010）**：T1 先行（一行灭全 OS 共同红）；T3/T4 不并行（同碰退出路径）；T9 殿后；每票独立验收锚，发现账外问题呈报不 silent-fix。

## 2. 终局（非票）：npm 0.0.1 go/no-go

D-001/D-009：Actions 全绿证据落地后向用户呈报终审表——含判据5 验证状态、macOS 探针结局、F1 修复证据、安装闭包断言读数。**不做预设裁决。**

## 3. 全局负向约束速查（细节见账本各条）

key 不明文（D-008）；零新 npm 依赖；不动 better-sqlite3 pin/allowBuilds=false；禁 site: query 改写；abstain 是成功非错误（exit 0 默认）；断言锚结构化字段不锚 exit code 与 regex；禁按 expected 造 stub 输入；live 层不进 ship-gate --offline；探针臂 TTL+显式标注；不重开 F-16 五闸探测链；ADR-0029 范围纪律。

## 4. Suggested skills

| 场景 | 调用 |
|---|---|
| 执行每张票 | `$implement`（带 tdd 接缝） |
| 版本控制全部操作 | `$but`（GitButler skill——分支/commit/栈，禁裸 git 写） |
| 票内遇到设计分歧或外部先例不清 | atomcode-research 深调研（经 ctx_batch_execute 串行） |
| 票收尾前 | `$code-review` |
| 会话压缩/交棒前 | `$handoff`（先确认账本落盘最新） |
| 新词/裁决落文档时 | `$domain-modeling`（CONTEXT.md 词表纪律：只进术语不进实现） |
| 收尾整理 | `$neat-freak` |

## 5. 环境注意

- shell：Git Bash 优先；写文件用 node.js（防嵌套断连）；PowerShell 读注册表 env 时 `$` 需转义。
- TAVILY_API_KEY：用户环境变量 `1`（User scope，len 57）。子进程用 `env TAVILY_API_KEY=$("powershell"...)` 或 node 读取后注入——任何环节禁明文落盘/输出。
- r61 栈未落 main——T1-T9 基于 main tip 还是 r61 栈顶：以 GitButler 栈现状为准（票内先 `but status` 确认基点）。
