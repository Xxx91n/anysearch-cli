# Changelog

All notable changes to this project are recorded here. Format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), versions follow
[SemVer](https://semver.org/).

## 0.0.5 — 2026-09-17 — ADR-0068 r67: Codex 0.142.5 真宿主契约对齐

### Added

- `apps/plugin` 新 bin `ans-hook-codex`（→ `dist/hooks/adapters/codex.cjs`）——Codex hooks 命令经 PATH 解析全局安装，与 claude 通路同构。
- `test/codex-contract.test.ts`（11 条）：官方 schema 校验、bin→entrypoint 解析、matcher 全匹配覆盖、SessionStart --envelope 断言、生成器漂移守卫（codex 配置纳入）、信封输出形状、hook_event_name 优先+legacy 兜底、fail-closed ask、非 ans 静默、畸形 stdin fail-open。
- `docs/codex-integration.md`：Codex 接线文档（config.toml 双配置层 + MCP + hooks + 实测宿主事实清单 + fail-open）。

### Fixed

- **configs/codex/hooks.json 是死文件（live 抓出）**：0.0.4 用 `{name,command,args}` 条目——Codex 严格态报 unknown-field、宽松态静默注册零 hooks。重写为官方 `{matcher,hooks:[{type:"command",command}]}` schema，纳入 `scripts/gen-claude-configs.mjs` 单源生成+漂移守卫。
- **codex 适配器裸输出被宿主丢弃（live 裁决）**：`adapters/codex.ts` PreToolUse/PostToolUse 原写顶层 `additionalContext`——codex 0.142.5 实测 ~80% 丢弃（合成桩 1/8、实物 1/3）。全部改入 `hookSpecificOutput{hookEventName,...}` 信封。
- **URL 策略 deny 在 Codex 上完全失效**：适配器原只发 additionalContext、丢弃 `decision.permission`——deny 决策零输出、工具照跑。现 `permissionDecision`/`permissionDecisionReason` 透传，真宿主端到端拦阻实测通过（router: `Tool call blocked by PreToolUse hook`）。
- **SessionStart 裸输出在 Codex 上不可靠**：shipped codex 配置改传 `--envelope`，路由卡经信封投递实测成功。
- **matcher 非全匹配**：`mcp__anysearch__` 不命中 `mcp__anysearch__search_web`（全匹配 regex）——shipped matcher 改后缀锚定 `.*(search_web|research_web|recall_memory|query_knowledge|ans_chat)$`，namespace 无关。

### Changed

- 宿主实测事实（钉入 ADR-0068/docs）：codex `-c` 无法表达 hooks（值按字符串解析）；hooks 须走 config 文件层（config.toml `[[hooks.*]]` 或项目 `.codex/hooks.json`）；required=true MCP 硬退出；hook trust=[hooks.state] sha256 持久化；PostToolUse ctx 注入为同 turn 边界可变量，索引副作用是持久价值。
- README Verified agent hosts：新增 Codex CLI 0.142.5 行；Known Limitations 补 0.0.4 Codex 三项缺口。

## 2026-09-17 — ADR-0067 r66: Claude Code 真宿主契约对齐（信封/schema/骨架）+ OIDC 发布通道

### Added

- `apps/plugin` 新 bin `ans-hook-claude` / `ans-hook-session-start`——hooks 命令经 PATH 解析全局安装，模板不再含绝对路径或 `${CLAUDE_PLUGIN_*}` 变量。
- Claude Code plugin 骨架：`.claude-plugin/plugin.json` + `hooks/hooks.json` + `.mcp.json`，由 `scripts/gen-claude-configs.mjs` 单源生成（settings 模板同出自它）；`claude plugin validate` 在已安装包上通过。标记 **experimental**（`CLAUDE_PLUGIN_ROOT` Windows 展开上游 bug #16116）。
- `test/claude-contract.test.ts`（10 条）：信封形状断言、官方 schema 校验、bin→entrypoint 解析、骨架存在性、生成器漂移守卫、fail-closed ask、全量/瘦身两种 tool_response 形态。
- `docs/claude-integration.md`：Claude Code 接线文档（settings 通路 + plugin 实验通路 + 实测宿主事实清单）。

### Fixed

- **Claude 决策键被宿主静默丢弃（live 抓出，ER-2）**：`adapters/claude.ts`/`session-start.ts` 原把 `additionalContext`/`updatedToolOutput`/`permissionDecision` 写顶层——Claude Code 2.1.251 哨兵实测：顶层 `permissionDecision` 不拦工具执行，信封 `hookSpecificOutput.permissionDecision:"deny"` 与 legacy `decision:"block"` 均拦。全部决策键改入 `hookSpecificOutput{hookEventName,...}`；PostToolUse 蒸馏摘要走 `additionalContext`（Claude 无输出改写字段）。
- **configs/claude/hooks.json 非官方 schema（live 抓出，ER-1）**：`{name,command,args}` 形状被静默接受但毒害整个事件列（混入的合法 sentinel 同被丢）。重写为 `{matcher,hooks:[{type:"command",command}]}`。
- **plugin 骨架缺失（ER-3）**：`claude plugin validate` 原报 "No manifest found"；骨架补齐后通过。

### Changed

- README Verified agent hosts：新增 Claude Code 2.1.251 行（settings 通路 live-verified；plugin 通路标 experimental）。Known Limitations 补两条 0.0.3 Claude 缺口口径。
- 宿主实测事实（钉入文档/测试）：Pre/PostToolUse 钩子 headless 下真跑但 stream-json 零事件（副作用观测）；输入校验失败先于钩子分发；`type:"http"` settings 钩子被静默丢弃；MCP 工具调用触发钩子正常。

## 2026-09-16 — ADR-0066 r65: 真实宿主部署开门轮（CodeBuddy 三件套 + hooks 契约对齐修复）

### Added

- `apps/plugin` 新适配器 `hooks/adapters/codebuddy.ts`：CodeBuddy Code 2.149.0 契约——stdin `hook_event_name`（兼容 `event` 兜底）、stdout 决策入 `hookSpecificOutput{permissionDecision|additionalContext|updatedToolOutput}` 信封、SessionStart 路由卡原文直出（CodeBuddy 把 stdout 原文注入上下文）；单入口内部按事件分发三事件。
- `apps/plugin` 新 bin `ans-plugin-server`（→ `dist/server/index.cjs`，server/index.ts 补 `#!/usr/bin/env node`）——0.0.3 陌生人手拉 server 的部署缺口闭合。
- `configs/codebuddy/hooks.json` 模板：`{matcher, hooks:[{type:"command",command}]}` schema，命令用 `$(npm root -g)` 解析全局安装路径（Git Bash 兼容）。
- `test/codebuddy-contract.test.ts`：16 条合成 stdin 契约测试（CodeBuddy 真实形状逐事件 + 数组 tool_response 实物形状 + legacy 兜底 + claude 回归）。
- `docs/codebuddy-integration.md`：陌生人面向的 CodeBuddy 接线文档（install/keys/server/mcp.json/settings.json/fail-open）。
- README 新增 Verified agent hosts 表（CodeBuddy=首个真宿主条目，含验证范围与状态列）。
- `apps/mcp` 新增 `scripts/sync-domains.mjs` + `files+domains`：domains/*.toml 随 mcp tarball 发布（镜像 cli 的 ADR-0061 B1 机制）。
- `packages/kernel` 导出 `mapAssistantMessageEvent` 纯函数（pi-ai AssistantMessageEvent→AgentEvent 文本映射，可测）。

### Fixed

- **hooks 假绿（潜伏缺陷）**：四个适配器 + session-start.ts 读 `stdin.event`，真实宿主注入 `hook_event_name` → 部署即静默 no-op。统一改 `hook_event_name ?? event`；合成 stdin 红绿证据对见 `.scratch/grill-round-65/evidence/`。
- **hooks 模板指向库文件**：configs/*/hooks.json 的 Pre/PostToolUse 原指 `dist/hooks/{preheat,distill}.cjs`（纯库无 main）——照模板接线永远静默 no-op；T3 修 claude/codex/antigravity + 新增 codebuddy，cursor 漏修由审计返工（F-A1）补齐，并加模板-target 可执行断言堵盲区。
- **`configs/` 不随包发布**：`files:["dist"]` 导致模板根本不在 npm tarball 里；`files` 补 `configs`，模板 0.0.4 起随包。
- **plugin server 无启动入口**：package.json 原无 bin；补 `ans-plugin-server`。
- **CodeBuddy tool_response 形状（live 抓出）**：真实宿主送数组 content blocks `[{type:"text",text:"<json>"}]`，适配器只认 string/{content:[]}/object → distill `resultCount:0` 假绿。新增 `core.unwrapToolResponse` 共享解包（codebuddy+claude 接入）。
- **ans-mcp 域向全灭（live 抓出）**：`domains/` 不在 mcp tarball 且 `createEngine` 未传 `domainsDirs` → 默认链只有 `<cwd>/domains`（宿主 cwd 永远没有）→ `ANS_DOMAIN` 在 MCP 路径静默无效。补包内域链回退。
- **ans_chat 上游不可达（live 抓出）**：MCP 工具只读 `ANS_LLM_PROVIDER/MODEL`，不线程化 `ANS_LLM_BASE_URL/API/API_KEY`（cli chat.ts 有此逻辑）→ v1/chat 自定义上游永远打不到。补齐 env 三件套。
- **ans_chat 永远空正文（live 抓出）**：pi-runtime 等 `assistantMessageEvent.type==="text"`——pi-ai union 无此类型（真实：`text_delta.delta`/`text_end.content`）→ 所有助手文本被静默丢弃，工具恒返回裸 "Agent completed"。修 `mapAssistantMessageEvent` + 6 断言。

### Changed

- README Known Limitations：删 stale「Not on npm yet」，补三条 0.0.3 部署缺口口径（server 手拉/模板指库/字段名假绿），各标修复落点 ADR-0066。
- README Verified agent hosts：CodeBuddy 2.151.0 状态从 contract-verified 翻正 **live-verified**（headless P1–P9 探针矩阵全绿，含 with/without-tool P9 对照）。实测要点：MCP 注册 `anysearch:connected` + 5 工具全列；域内检索 typescriptlang.org 实答 + PostToolUse 索引 +10；OOD 查询全落 modelcontextprotocol.io（与 `ans search` 直调一致）；ans_chat 走 v1/chat 上游出真实回答；recall_memory 10 条跨 3 sessionId；hooks 三事件全命中（SessionStart 卡入 context、Pre/Post exit0、信封合法）；杀 server 后 fail-open 正常；research_web 执行 + query_knowledge 诚实 `adapter=none`；P9 对照——无工具错引 `pnpm.io/npmrc#node-linker` → 有工具实检 `pnpm.io/settings/node-modules`。

## 2026-09-16 — ADR-0065 r64: 隔离金案例 TTL 裁决收口（mustHitPaths 页族断言 + evidence 模式 + 10 条全量 promote）

### Added

- `eval-looks.json` schema v1 additive fields：`mustHitPaths`（pathname 子串页族断言，mustHitHosts 内作用域）/`mustNotHitPaths`（负例写死）/`stability_class`/`failure_class`/`migration`（promote 留痕载体——promoteEntry 物理删账本条目）/`watch`（post-promote 观测标记）；根 `schema_version: 1` 哨兵。
- live runner `ANS_EVAL_EVIDENCE=1` 证据模式：隔离条目实跑不跳（quarantined-but-runnable）、EVIDENCE 四元组落 `ANS_EVAL_EVIDENCE_LOG`、仅隔离失败 exit 0 覆写（EVIDENCE-ONLY-FAILURES）、连续全红 RETIRE_CANDIDATE 喂 reviewDue()。
- `eval-looks-live-parity.test.ts`：runner 隔离分类==isActive()（longterm/expired/retired 组合台账）+ runner 源码无内联判定副本断言。
- ship-gate §1n R64 锚点：live mustHitUrls 持有者≥2 且限 controlled|frozen-spec、mustHitPaths 持有者≥1、迁移案例 migration 块存在性机器校验。

### Changed

- runner 隔离分类收编到账本 `activeIds()` 单一实现（原内联判定忽略 longterm flag——第二次判定漂移被拆除）。
- eval-looks 8 条路径漂移案例（g0001/2/3/4/5/6/9/11）迁 mustHitPaths 页族层；g0008 降格单宿主 pnpm.io（locale-clustering-suppressed-cross-host，hops:multi 保留为 dimensions 观察）；g0010 实测恢复 answer 并入路径簇（未走 abstain 改判）；3 条 frozen-spec 字节级腿（g0001→2026-07-28、g0005→2025-11-25、g0010→2024-11-05 dated MCP spec 快照，复现率 3/3·6/6·3/3 校准）。
- 10 条隔离案例全量 promoteEntry 裁决落账（9 轮 evidence 复跑记录 .scratch/grill-round-64/evidence/；flaky 三条 flip=0；watch:true 标 g0001/4/5/6/9），eval-quarantine.json 棘轮视野清空，TTL 2026-10-14 提前近月收口。
- README Known Limitations 页级断言条目改写为页族粒度现状。

## 2026-09-15 — npm scope 改名 + 0.0.3 重发（workspace:* peer 逃逸修复）

### Fixed

- npm scope @anysearch → @anysearch-cli（org anysearch 被空壳蹲占不可注册；用户建成 anysearch-cli org）。全仓 100 文件机械替换：包名/import/tsconfig/tsup/ship-gate+install-smoke 断言/workflows/docs。
- 真事故：npm publish <dir> 不做 pnpm workspace:* canonical 改写——0.0.1/0.0.2 的 cli/mcp/plugin manifest 携带 peerDependencies workspace:* 原文，npm install 报 EUNSUPPORTEDPROTOCOL 不可安装（embedding 无 peer 独活）。bin "invalid and removed" 警告实为 ./ 前缀归一化（bin 实存）。修复：发布通道改为 pnpm pack tarball + npm publish <tgz>（tarball manifest 已 canonical），ship-gate step5 增断言——packed manifest 任何 dep 字段残留 workspace: 即 fail。0.0.3 统一重发。

## 2026-09-15 — ADR-0064 r63: npm 0.0.1 发布形态与验证面（T2/T3/T5，D-005/D-003）

### Added

- **Apache-2.0 license**：根 LICENSE + 4 发布包目录各一份副本；4 包 manifest 补 license/repository/publishConfig.access:public。
- 发布管线断言：ship-gate step5 校验打包 manifest（dependencies 无 @anysearch-cli/* 死声明、peer-optional 在场、license/repo/access）+ dist 无裸 require 内部包（embedding 按设计豁免）；隔离集棘轮三断言（scripts/quarantine-ratchet.mjs + eval-quarantine.baseline.json 基线）。
- peer-optional 双装验证：install-smoke + ship-gate 4c 断言 npm i 双装后 @anysearch-cli/embedding 落共享 node_modules 根、从已装 cli 内解析可达、doctor vector arm 翻 present。
- docs/publishing.md 发布步骤文档（含 min-release-age=2 自验覆盖方式与 72h unpublish 窗）；docs/release-notes/0.0.1.md；ADR-0064。

### Changed

- bundled-CLI 发布形态：apps/{cli,mcp,plugin} 的 @anysearch-cli/{kernel,store,retriever,plugin} 从 dependencies 移 devDependencies（已 bundle 入 dist，如实声明 build-time）；@anysearch-cli/embedding 全部 optionalDependencies→peerDependencies+peerDependenciesMeta.optional:true（含真正 import 方 store；npm 自动安装重型 optional runtime 的炸弹回归被拆除）；embedding 移除 private 标记（可发布）+ tsup ESM 构建 + publishConfig.exports 改写（dev 仍解析 src/index.ts，tarball 指 dist/index.js）。
- install-smoke 改消费者真实形态：只装 3 个 app tarball，断言 bundled 内部包与 optional peer 均不在安装闭包内。
- quarantine-ledger 增 longterm 裁决出口（永久已知问题转换，QUARANTINE_MAX_LONGTERM=1 防续期后门）。

## 2026-09-15 — ADR-0064 r63: T1 con_add_then_noop 修复（D-002 Blocker）

### Fixed

- consolidate 去重在 embedding 缺席时曾整体失效：`decideOp` 只认 cosine>0.90，arm 缺席（FTS-only 安装/离线）下 bestCos 恒 0，重复记忆一律判 add——`con_add_then_noop` 在无网环境必红。现加降级分支：无 cosine 可算时 bestJac>θ_jac（0.80，golden 校准：相异 stub=0.000/同一 rerun=1.000/矛盾对上限=0.714）判 noop。行为变更：无-embedding 环境下近逐字重复记忆开始判 noop（有损降级，抓不到 paraphrase 级重复），降级决策计入 `ConsolidateReport.embeddingAbsent`（不再 silent，ADR-0060 D7）。

## 2026-09-14 — ADR-0061 r60: 审计修复（audit F1–F3 + F5，reports/2026-09-14-audit.md）

### Fixed

- 域解析链收口（F1/F2）：`domainTomlPath` 现读 `ANS_DOMAINS_DIR`（env → cwd → extras，与 `defaultDomainsDirs` 链头同序）；`ans chat`/`ans hitl` 走 `domainSearchDirs()` 四链；`ans pref` 改用 `createPersistentEngine`——顺带修复 `createEngine` 默认 `:memory:` 导致偏好从不落盘的存量 bug。
- coverage manifest 算术（F3）：`source-tier.reference` 3→4、`freshness.stable` 6→5；`crossCheckDocsGolden` 新增 classes↔entries 直方校验，`badcase-backfill` 重算时同步 classes。
- `badcase-backfill --new` 不再编造分类：badcase 记录须自带 intent/questionLang/dimensions（缺则拒），provenance.type 可由记录覆盖；三处台账写改原子写（tmp+rename）。
- `engine` 早停阈值按 `normalizeUrl` 计唯一 URL（与融合去重口径一致）；`ans domain`/doctor 域列表改共享 `listDomainTomls`；doctor 删 `fileURLToPath` 死 import。

## 2026-09-14 — ADR-0061 r60: graceWindow/deepMode 交付（T6/G1，remove-or-implement → implement）

### Changed

- `RetroaererdEngine.search` 真接线早停：fused pool 覆盖 `q.maxResults` 个唯一 URL 后，straggler 获 `graceWindowMs`（默认 1500）再触发 per-provider AbortController；`deepMode` 恒等全部。取消者进 `metadata.providersCancelled`（此前恒空）。
- 哨兵翻正：ship-gate step1c + t6-hostile-cuts 从「债注存活」断言改为「接线存活」断言；CONTEXT.md「尚未接线」措辞移除；ponytail-debt-ledger 移入 Resolved。
- engine.test.ts +5 断言：grace 取消上报/abort 实发、deepMode 不取消且慢 provider 结果到达、未达阈值全员等待。

## 2026-09-14 — ADR-0061 r60: doctor 自服务增强（T4/B3）

### Added

- doctor [4] 增补：ANS_DOMAINS_DIR 可见化、durable DB 路径 mkdir+可写探测。
- doctor [5] 增补：活动域 sources.enabled 逐 provider key 覆盖检查——未设 key 记 SKIP 并给双向修复路径（设 key 或移出 enabled）；域不在解析链/链上无 TOML 时点名具体修复命令。
- `ans domain` 解析失败时列出可用域 + ANS_DOMAINS_DIR 修复指引，并明示 silent full-fanout 语义。
- clig.dev 收口：doctor 失败摘要走 stderr（exit 0/1 不变）。

## 2026-09-14 — ADR-0061 r60: badcase→golden 回灌闭环（T3/B4）

### Added

- `eval-badcases.json`（schema `anysearch/eval-badcases@1`）：真实 badcase 记录面，种子条目 docs-bc0001 来自安装物实跑（tokio 域外提问应 abstain 实返 10 条非 allowlist 结果）。
- `scripts/badcase-backfill.mjs`：回灌两模式——`--into` attach 同问句既有 golden（回归证据），`--new` 生成下一条 docs-gNNNN 并自动重算 coverage manifest；无 observed/evidence.command 拒绝回灌（禁合成护栏）。
- eval-docs-golden.test.ts 扩 badcase 回归段：badcase schema、promotedTo→golden 可解、attach 问句逐字一致、open 态不得已入集。

## 2026-09-14 — ADR-0061 r60: 装到用链路 CI（T2/B2）

### Added

- `scripts/install-smoke.mjs`：真实安装到用链路——pack 全部 7 个 workspace 包 → npm 干净前缀安装 → 安装物 `ans` bin 走 --version/doctor/domain docs/doctor/search。online 有 key 时硬断言 ≥1 结果且命中 docs allowlist 主机；无 key 断言文档化离线行为（exit 1 / Results: 0），不造假覆盖。
- `.github/workflows/ci.yml` `install-smoke` job（ubuntu+windows 矩阵）：build 后跑 install-smoke；EXA/TAVILY key 走 secrets，缺失即离线断言路径。

## 2026-09-14 — ADR-0061 r60: docs 域 walking skeleton（T1/B1）

### Added

- `domains/docs.toml`：首个垂直域（技术文档检索）。语料一手 allowlist：modelcontextprotocol.io / typescriptlang.org / pnpm.io（D-004 首批实例化）。
- `eval-looks.json` 顶层 `golden` 集合（schema `anysearch/docs-golden@1`）：首批 11 条全真源提问（8 internal-dogfood + 3 external-community），逐条 provenance 可回访；OF 账本 looks[] 语义不变，读写路径保透传（looks-ledger.ts / eval cli calibrate）。
- `eval-looks.coverage.json`（schema `anysearch/eval-looks-coverage@1`）：八维切片 manifest，covered×7 + deferred×1（injection，entryTrigger 挂 B4）。
- `packages/store/src/eval/docs-golden.ts`：条目 schema + 八维词汇 + manifest/交叉校验器。
- `loadDomainByNameIn` + `defaultDomainsDirs`（domain-loader.ts）：多目录解析链；`createEngine` 新增 `opts.domainsDirs`；`domainTomlPath` 增可选附加目录。
- `apps/cli/src/config-env.ts`：config.env 共享读写 + 入口 rehydrate（`ans domain` 持久化从此对全命令生效，显式 env/空串不被覆盖）。
- `apps/cli/src/db.ts` `domainSearchDirs()`：ANS_DOMAINS_DIR → cwd/domains → 包内建 domains → 仓根 domains 的解析链。
- `ans doctor` 新增 `[5] Domains` 段：解析链逐目录发现 + 逐 TOML 校验 + 活动域五下游层（sources/skills/hooks/prompts/rag）可见。
- @anysearch-cli/cli 打包 domains/（files + build 期 sync-domains.mjs 从仓根同步）；测试：eval-docs-golden.test.ts（27 断言）、domain-loader.test.ts 链路用例、e2e doctor [5] 断言。

### Fixed

- 安装后 `ans` 因 shebang `#!/usr/bin/env tsx` 无法启动（tsx 非运行依赖）——walking skeleton 首次实装暴露；改 `#!/usr/bin/env node`。

## 2026-09-02 — ADR-0043 r42: consumed/synthetic switch governance implemented

### Added

- Switch state machine S0-S4 (ADR-0043 D2-D6): pre-registered readiness trigger (C1-C4 wall-clock, k_max=10), SESOI-band reconcile + McNemar diagnostic (packages/store/src/eval/switch-machine.ts, pure core), graded rollback with Inconclusive hold (promote streak 3 > rollback streak 2 hysteresis), integrity lineage fail-closed, evidence-driven reversible freeze.
- Pre-registered thresholds as data (version + hash): packages/store/fixtures/switch-registration.json; every verdict records registrationHash.
- skip-ledger schema @3: state block (phase, since, transitionId, evidenceHash) + actions log (actions never touch the 3-streak); lossless @1/@2 upcast; unknown versions fail loud.
- access_events chain switch events (stage-transition/rollback/freeze) with sentinel-row FK and chain-first ledger write order; ledger rebuild from chain fallback.
- ans switch-state [--verify] [--db PATH] [--out DIR] read-only query.
- ship-gate step 7 reports the current switch phase (exit semantics unchanged).

### Fixed

- bgnbd/obs-fixtures/switch-run no longer evaluate fileURLToPath(import.meta.url) at module init — the CJS CLI bundle crashed every ans command at boot once @anysearch-cli/store re-exported switch modules.
## [Unreleased]

### Added

- ADR-0059 D2 (T-1 / F-15, round 58): eval-grade layering. The merge gate (ship-gate step 7) now
  runs observational and never spends a preregistered OF look (ANS_EVAL_NO_LOOK=1); decision grade
  moved to a new `release` workflow (pre-tag dispatch = the only OF peek; post-tag asserts the
  recorded verdict is unexpired and spends nothing). The OF look ledger moved from the local
  `.ship-gate/eval-looks.json` to the git-committed repo-root `eval-looks.json`
  (`anysearch/eval-looks@2`, append-only with a 50-row compaction cap and a preserved
  pre-compaction SHA-256); a look is written only when ANS_EVAL_LOOKS_WRITE=1, so CI and local runs
  leave the tracked file untouched. ship-gate.yml Node 24 -> 22 to match ci.yml.
- ADR-0027 D8 / ADR-0059 D3 (T-2 / F-17, round 58): flaky-case quarantine ledger. A case that is
  environment-flaky is quarantined by POLICY MARK (`packages/store/eval-quarantine.json`,
  `anysearch/eval-quarantine@1`) — the golden set and the dataset fingerprint are untouched, so
  zero recalibration cost. The gate excludes ACTIVE quarantined cases from the passRate==1 hard
  assertion while disclosing them; 30-day TTL, weekly review, max 2 renewals, promote/retire
  paths. The eval CLI now names the failing cases on gate failure so a CI log identifies an
  environment flake without needing the report artifact.
- ADR-0059 D6 (T-5, round 58): the README ADR index is now a generated artifact.
  `scripts/gen-adr-index.mjs` (Node stdlib) owns the `BEGIN/END ADR-INDEX` block derived from
  `docs/adr/*.md`, and ship-gate step 1b runs it in `--check` mode (regenerate-and-diff) so the
  index can never silently lag again. The one-time catch-up replaces the stale "ADR-0001 through
  ADR-0046" claim with the real 0001-0059 range and the full 59-row index.
- ADR-0059 D7 (T-6, round 58): four hostile-review cuts.
  (1) engine dead config fixed BY DOCUMENTATION: CONTEXT.md no longer claims an implemented
  grace window, ADR-0005 gains an append-only r58 errata, and ship-gate step 1c asserts the honest
  engine debt note survives (ADR-0014). (2) `ans doctor` now prints the real version via the
  `__PACKAGE_VERSION__` tsup define instead of a runtime package.json read that resolved to the
  repo root after bundling. (3) plugin server trust boundary (highest priority): loopback Host
  whitelist, Origin check (no Origin = native client), auto-generated 256-bit token when
  ANS_SERVER_TOKEN is unset (persisted 0600 for the hooks), crypto.timingSafeEqual, 1MB body cap,
  and 403-before-401 ordering; wildcard CORS removed. (4) api.anysearch.com ownership deferred
  WITH deadline: named owner + quarterly review + CT/expiry monitoring in docs/deferred-registry.json
  and an annotation block in anysearch.ts.

### Removed

- due-chore (ADR-0029 channel, round 59): dropped the `t6-hostile-cuts.test.mjs` text-position assertion that `403` precedes `401` - it pinned source ordering, not behaviour; the behaviour is asserted end-to-end in `apps/plugin/test/plugin-security.test.mjs` (non-loopback Origin without token -> 403 before 401).
- due-chore (ADR-0029 channel, round 59): `apps/plugin/src/hooks/preheat.ts` comment no longer says the policy cache guards against a *tampered* drop-in (downgraded to a *damaged* drop-in - the sha256 self-check is a damage detector, not an adversary defence), and `canonicalVersion()` now names the store implementation as authoritative.
- ADR-0057 D-001/R1 (round 57): `.scratch/` is no longer tracked. The local-markdown
  issue tracker and round artifacts were tracked as 16 files while README.md:64 documents
  them as not committed to git; all 16 are now untracked (disk copies kept; `.gitignore`
  gained `.scratch/`). Commits `ykm` (first 8) + `rpz` (remaining 8, audit F-1).

### Fixed
- ADR-0042 r110 audit repair round (dual-axis review of the r109 implementation; all
  findings fixed in one round — SP-F-01..03 + SA-F-01..09):
  - SP-F-01/SA-F-05 (severe): the consumed track's AND-gate input was hardcoded zeros, fully
    disconnected from access_events, and the data-absent classifier only fired when NO events
    existed at all — so a healthy eval always logged gate-not-met and the 3-streak fired
    spuriously (ship-gate exit 1). Now the runner aggregates real unit-level stats
    (events/units/fittableUnits/access-time span) and D4 "structural data absence" covers
    "events exist but nothing is fit-eligible" — both empty-library and populated-but-
    immature forms record reasonCode=data-absent and never build the streak.
  - SA-F-01: non-finite PSI is fail-closed at the AND-gate (NaN can no longer slip past
    the >= comparison).
  - SA-F-02: skip-key identity excludes volatile numerics (normalized to '#') — the 3-streak
    now matches on WHICH gate clauses failed, so identical conditions across runs actually
    reach escalation.
  - SA-F-03: unknown/corrupt skip-ledgers are never silently cleared; reading fails loud
    (SkipLedgerError) and the eval CLI quarantines the file aside then restarts empty with a
    stderr notice.
  - SA-F-04: fixture definitionHash now pins generatorVersion + per-file SHA-256s (generator
    bumped to v2) — a generator-contract change flips the fingerprint (declared flip
    5be13f8abcfab1f9 -> re-baselined via --calibrate).
  - SA-F-05: the observational zone carries an explicit dataAbsent boolean; the report zone
    no longer presents structural absence as an unexplained gate-not-met.
  - SA-F-06: fixtureDefinitionHash is recorded in the observational zone (and thus in
    eval-baseline.json on calibration) — fingerprint flips are auditable from the artifact.
  - SA-F-07: tau-python.yml regenera guard triggers on day-buckets.ts, and the fixture loader
    hard-rejects a baselineHistogram whose keys drift from AGE_BUCKETS.
  - SA-F-08: skip-ledger writes are atomic (tmp + rename), so a concurrent/crashed eval
    cannot leave a half-written ledger.
  - SA-F-09: @2 entry-level validation (tier/track enums; green rows MUST omit reasonCode,
    warn/data-absent rows MUST carry one); @1 upcasts keep green rows reason-free.
  - SP-F-02/03 (nits): runtime SHA-256-vs-MANIFEST check now documented as an anti-miswire
    guard only (CI regenerate-and-diff is the tamper anchor); a missing MANIFEST yields the
    explicit "no-fixtures" marker in the report + a stderr warning instead of a silent
    fingerprint drift.
- r39 deferred items F-07 (staircase automation tests) and F-09 (report subject digest)
  remain deferred (tracked, r110 does not own them).

### Added
- ADR-0042 observational data feeding (r109 implementation): dual-track loader
  (consumed=real access_events preferred; synthetic=hash-pinned fixture fallback via
  `ANS_OBS_FIXTURE`, track marker enforced in-load so synthetic rows can never pose as
  consumed data) + pure-stdlib offline generator `scripts/tau/generate_fixtures.py`
  (mulberry32, byte-deterministic, --check exits 2 on drift) producing the four-fixture
  falsification matrix (`packages/store/fixtures/obs-feed/`: pass-stable / t1-fail 299 rows /
  t2-fail PSI>=0.25 / t3-fail 89d window) with SHA-256 MANIFEST + definition hash pinned in the
  eval baseline fingerprint — the initial flip 113be271869dbc54 -> re-baselined is the
  declared one-time ADR-0042 D6 fingerprint flip (definitionHash `f5c6c438f3696995` joined).
  skip-ledger schema @1 -> @2 (track + reason-code split; data-absent never builds the
  3-streak and resets an in-flight gate-not-met run; @1 ledgers upcast losslessly on read,
  closing r106 F-08; scripts/gain-ledger.mjs resolve tool accepts @2). Synthetic runs are
  labelled simulated-observation-window in the report. CI: regenerate-and-diff guard step in
  tau-python.yml. New test surface: obs-fixtures.test.ts (24 asserts, gate-ok -> ready-to-spawn
  via node stub) + eval-skip.test.ts ledger-semantics block.
- ADR-0040 access_events tamper-evidence layer (r102/r103 implementation): `prev_hash`
  SHA-256 hash chain (six-field canonical contract: fixed key order = RFC 8785 lexicographic for
  the closed ASCII scalar schema, NULL = JSON null, INTEGER/TEXT/NULL whitelist) + single-row
  `access_chain_anchor` sealing legacy history as a one-off digest snapshot (lazy IMMEDIATE
  constructor bootstrap, one defensive BUSY retry, busy/IO degrade = stderr WARN + telemetry bit)
  + independent zero-shared-code verifier `scripts/verify-access-events.mjs` (fork detection,
  legacy digest recompute, unknown schema_version = explicit error, exit 0/1/2) wired fail-closed
  into ship-gate step 1 (no-db -> explicit skip + `access-chain-skip-ledger.json`, 3-streak
  escalation) + alert-on-silence `eventWriteFailures` counter joined into the eval observational
  zone + `ans access-chain bootstrap [--dry-run default | --apply]`. Six zero-dependency test
  files (golden vectors 3+2 pinned, 4 tamper classes + seeded legacy, no-db exit 2, real-spawn
  dual-process concurrent bootstrap, telemetry/idempotency/legacy byte-stability, 100k-row perf
  smoke report-only + schema fwd/back + whitelist negatives). No dataset fingerprint flip —
  the chain never touches golden cases; baseline fp 113be271869dbc54 verified unchanged (ADR-0027 D9
  flip rule evaluated, not triggered).
- ADR-0039 tau observation layer (r100 implementation round): access_events append-only log
  joined into eval per-case observation; pre-registered day buckets (0-1/2-7/8-30/31-90/91+,
  [min,next-min) semantics + dayBucketFingerprint) folded into datasetFingerprint so any bucket
  change forces a recalibration; synthetic tau-scan (seeded mulberry32, kendall@2, shipped as
  node scripts/tau/tau-scan.mjs); BG/NBD out-of-process fit via scripts/tau/bgnbd_fit.py on the
  frozen lifetimes stack (numpy==1.26.4, autograd==1.7.0 pin below numpy 2 — see ADR-0039 r100
  amendment) reached through a hardened spawn wrapper (timeout SIGKILL, non-JSON/non-converged
  all map to explicit-skip); three-tier explicit-skip (gate-not-met / offline-deferred /
  infra-failure) with TAU_FIT_GATE T1+T2+T3 and a skip ledger (anysearch/gain-ledger@1 shape,
  resolve via gain-warn-resolve.mjs); eval report observational zone is a ship-gate contract.
  ADR-0038 r99 text errata physically applied (D2 full-sample rule failure is WARN not red;
  D6 single WARN ships with a ledger entry, three consecutive escalate).
- ADR-0038: relation-arm gain gate promoted to a three-tier GREEN/WARN/RED verdict — RED only on
  proven-negative evidence (BCa upper < 0 or harm-side sign-flip p below the look budget); unproven-
  positive is WARN, never RED. Dual-track holdout: 40-case frozen baseline slice (19 RoR pairs) with
  a second fingerprint plus a backflow slice family (inputHash dedup vs baseline, cross-slice,
  payload provenance). Preregistered Lan-DeMets OF alpha spending (0.025 per track, k_max=5,
  convergence clause past k_max) with a per-fingerprint look ledger (.ship-gate/eval-looks.json).
  ship-gate enforces the tier: RED hard-fails, GREEN passes, WARN is released but three consecutive
  WARNs force `node scripts/gain-warn-resolve.mjs`. Graded relevance labels (0-3) on 39 cases feed
  report-only nDCG@5/10/20 plus a dual-review record (relevance-review.json, kappa/AC1 = 1.0 on 610
  label pairs) as the judge-calibration baseline row.

- ADR-0037: `ans consolidate` and `ans memory forget --undo` CLI; durable maintenance DB
  via ANS_DB_PATH (default ~/.anysearch/anysearch.db); semantic_memories sixth RRF arm
  (serve, weight 0.5, conditional activation, fail-closed regression gate); three-protocol
  LLM endpoint config (ANS_LLM_BASE_URL + ANS_LLM_API=chat|messages|responses + ANS_LLM_API_KEY).

### Removed
- kernel llm-init residual env fallback (OPENAI_/ANTHROPIC_/GOOGLE_API_KEY): the kernel no longer
  reads provider env (ADR-0038 step 7); provider auth stays entirely inside pi-ai. r94-deferred
  hygiene, ships as its own refactor commit.

### Fixed
- r94 audit (ADR-0037, atomcode Spec-1): single-query searchMemory resolved the semantic arm
  through a byId map that was never populated with semantic hits — sixth arm silently dropped
  on that path (MCP recall_memory consumer). Fixed + regression test.
- r94 audit (ADR-0037, atomcode S1): kernel llm-init read ANS_LLM_API_KEY from the environment,
  violating its own "No env reads in kernel" contract; callers pass the key explicitly now.
- r94 audit (ADR-0037): applyArchive explicit-ids path now enforces pinned / closed /
  quarantined exclusions at the force point; LLM summarize moved out of the BEGIN IMMEDIATE
  write lock (plan/apply split; dry-run exact prediction unchanged); `ans consolidate`
  rejects unknown flags (exit 2).

## [0.1.0-rc.0] — 2026-08-22

### Fixed
- r90 audit (ADR-0036): D5 RoR delta sign convention corrected in ADR-0036 and CONTEXT.md
  (positive = relation arm pushed the memory earlier; sign was documented inverted while
  code/tests/baseline all used positive=helps — regression trap removed).
- r90 audit (ADR-0036 D6): backfill retry counter snapshot now also covers
  `relatedToWriteOnce` so a failed batch retry no longer double-counts that telemetry bit;
  busy-injection test now holds the foreign lock past busy_timeout (5200ms) so the
  exponential-backoff branch actually executes (a 150ms hold was absorbed by busy_timeout).

### Added
- ADR-0020 ship-gate pipeline: `scripts/ship-gate.mjs` (Node stdlib, single file)
  as the blocking Product Smoke Gate, plus a non-blocking
  `modelcontextprotocol/conformance` workflow as the Protocol Heartbeat.


### Added
- ADR-0030: fused freshness factor [0.3, 1.5] in store ranking — creation-age decay,
  `last_accessed` recency, and `access_count` frequency fused into ONE multiplicative band
  (`freshness_factor()` UDF replaces `time_decay()`). `access_count` column added via
  idempotent migration; every returned recall hit increments it exactly once, on both
  `searchMemory` and `searchMemoryMulti` paths.
- ADR-0030 D5: kernel `memory-pipeline.ts` now imports `isTimeSensitive`/`isEvergreen`
  from `@anysearch-cli/store` (inline regex copy deleted; the QDF regex itself no longer
  carries year literals).

### Removed
- ADR-0029 D6: dropped `--write-baseline` from `packages/store eval` (the one-round alias for `--calibrate`).
- ADR-0030 D2: retired the `w` interpolation weight (0.25/0.4) and the
  `1 - w·(1-decay)` fusion form. Ranking is a direct multiplicative scaling band now.

### Infrastructure
- 16 prior ADRs landed across rounds 1–17 (MCP Phase2, Kernel Engine
  composition, dual-era SDK v1+v2 bridge, TypeBox source-of-truth, plugin
  hooks layer, SessionStart routing, L0/L1 memory pipeline).

### Added
- ADR-0035 KG-lite relation arm (fifth RRF arm, weight 0.5): closed 8-predicate table
  (`works_on/depends_on/uses/part_of/member_of/located_at/authored_by/related_to`) with EN+CN alias map,
  rule-first extraction (verb frames + url<->handle bridge + 2-preKnown co-occurrence), single-call
  LLM seam behind a strict post-filter (JSON degrade parse, never blocks the write path), edges table
  with partial-unique active index and episode provenance, merge redirects edges within the combine
  transaction with snapshot-driven bounded unmerge restore, `pendingEdges` gauge + relationTel counters,
  golden `relations` group (12 cases: 8 predicate positives incl. CJK quoted, fail-closed supersede,
  observational no_edge + 1-hop hit-rate), ship-gate 1j static + relation-zone metric assertions.
- ADR-0035 D7: `ans relation list` + `ans relation backfill-relations` (dry-run default, keyset
  pagination, `--reprocess` supersedes stale rules_version rows, exit codes 0/1/2).

[0.1.0-rc.0]: https://github.com/anysearch/anysearch-cli/releases/tag/v0.1.0-rc.0

### Added
- ADR-0036 relation-arm gain observance (Phase-1): single-run counterfactual ablation for the
  relation arm — SqliteSessionStore captures arm provenance per searchMemory call; the eval runner
  drops the relation list and recomputes RRF, producing paired rank deltas for every expectRankOf
  golden op. Gate statistics: paired BCa 95% CI (seeded mulberry32 bootstrap + jackknife), one-sided
  sign-flip permutation p, Sakai sample-size lock (cap 80), chi-square upper sigma_d. Decision rule
  (BCa lo > 0 AND mean >= minGain AND signFlip p < 0.05) fails closed; under-powered / degenerate /
  missing-baseline downgrade to WARN. Golden relations group expanded 12 -> 78 (30 EN + 8 CN RoR
  pairs with 14-memory distractor corpus, 14 EN + 8 CN alias edges, 6 no_edge negatives); baseline
  recalibrated over 50 seeded runs (sigmaDU=0.102, lockedN=17). New test eval-relation-gain.test.ts.

### Changed

- ADR-0036 D6 (Phase-2): `ans relation backfill-relations --apply` now commits one IMMEDIATE
  transaction per batch (was a single whole-run transaction), retries SQLITE_BUSY with exponential
  backoff (50ms base, 5s cap, <=8 tries, aligned with busy_timeout=5000), fails fast on
  SQLITE_BUSY_SNAPSHOT, and runs a passive WAL checkpoint after each committed batch. The dry-run
  path keeps the single rolled-back transaction, so counters remain exact predictions (ADR-0035 r87).
  The "no concurrent MCP traffic during backfill" constraint is relaxed to recommended-not-required;
  CLI help and ADR-0035 D7 wording updated. Regression coverage: per-batch exact-parity and
  live-writer contention cases in relation-edges.test.ts.

