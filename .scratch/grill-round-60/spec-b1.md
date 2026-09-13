# B1 Spec — docs 域 walking skeleton（Round-60 / T1）

**覆盖**: D-002 / D-004 / D-005 ｜ **来源**: decision-ledger current + ADR-0061 D1–D5 ｜ **日期**: 2026-09-14 ｜ **作者**: fixer 子代理

## 0. 前提勘误（D-002 已记录失实修正）

任务语境中"repo 已有 cc-persona 域"不成立：`domains/` 仅有 `default.toml` 与 `research.toml`（q2-atomcode 本地 glob 证伪）。cc-persona 是 ADR-0002/0004/0005 的 schema 移植来源（domain-schema.ts 注释 "transplanted from cc-persona"），不是现成域。本 spec 以此为修正前提，不引 cc-persona 为既有域。

## 1. "正文行"归类定义（D-003 约束 3，B1 spec 显式声明）

| 归类 | 范围 |
|---|---|
| **正文行** | 域产品代码（`domains/docs.toml`、域目录解析链/回退、`ans domain` 持久化生效、doctor 域段）、golden 数据（`eval-looks.json` 的 `golden[]`、`eval-looks.coverage.json`）、以及对应单元/e2e 测试 |
| **治理行** | ADR/ledger/spec/report/handoff 流程文档、`.github/workflows/*`、ship-gate/release-gate/check-* 门禁脚本与断言变更 |

- C1 不申报豁免：B2/C1 中 CI 工作流与 ship-gate 接线改动按上表归治理行，不占用也不豁免（D-003 约束 2）。
- G1 票 diff 全量豁免行数对比（ADR-0061 D3 已载 sunset：Round-61 不得自动沿用）。

## 2. eval-looks@2 schema 兼容核对（任务书障碍预警项）

实测源码核对结论：

- `apps/plugin/test/golden.test.ts` **不消费** eval-looks.json——它是 ADR-0056 的 hook→server→SQLite trace 往返金案例。任务书锚点文件名失准，真实兼容面为：`packages/store/src/eval/looks-ledger.ts`、`eval/cli.ts`、`scripts/release-gate.mjs`、`eval-release-layering.test.ts`、release.yml 的 commit-back。
- 真实冲突：`writeLooksLedger` 与 `eval --calibrate` 重写只保留 `{schema, looks, compaction}`——非账本顶层字段会被**静默销毁**；`readLooksLedger` 对未知顶层键宽容。
- **处置**（守 D-002 字面"落在 eval-looks.json"，不另造账本外数据集文件）：顶层新增 `golden[]` 集合并行化打补丁——`readLooksLedger` 读出、`writeLooksLedger` 与 calibrate 重置路径回写保透传；schema 标签维持 `anysearch/eval-looks@2`（looks[] 账本语义不变，golden 为附加集合）。新模块 `packages/store/src/eval/docs-golden.ts` 承载条目类型 + 校验器 + 覆盖清单校验；新测试 `eval-docs-golden.test.ts` 锁闭环（含 round-trip 保留断言）。

## 3. 首批语料 URL 附表（D-004：首批实例化 A，规则的当前输出）

| urlAllowlist 裸主机名 | 一手页面 | freshness class |
|---|---|---|
| modelcontextprotocol.io | https://modelcontextprotocol.io/specification/2025-06-18/basic/transports | spec-major（90d） |
| www.typescriptlang.org | https://www.typescriptlang.org/tsconfig | reference-stable（180d） |
| pnpm.io | https://pnpm.io/settings | reference-active（90d） |

三源 2026-09-14 当日实 fetch 验证可达（ctx_fetch_and_index 三取三成）。语义提醒：`urlAllowlist` 是 URL **消费**闸门（policy/HITL/内容信任边界），不约束 search 结果排序。

## 4. 产品缺口与修复（walking skeleton 实走暴露，全部属正文行）

1. **域不可送达**：`loadDomainByName` 仅 CWD 相对且 `domains/` 不在任何包 `files` 内 → 干净装后 `ANS_DOMAIN=docs` 静默 full-fanout（Domain-not-found 被吞）。修：域目录解析链 = `ANS_DOMAINS_DIR` env → `cwd/domains` → 内建 `<pkg>/domains`（@anysearch/cli 打包 `files+domains` + build 期 `scripts/sync-cli-domains.mjs` 从仓根同步）→ dev 兜底仓根 `domains`。`createEngine` 增 `opts.domainsDirs`；Domain-not-found 沿链逐一尝试，其余错误语义不变（sources.weights 仍 fail-fast，其余仍 fail-open fanout）。
2. **域持久化 write-only**：`ans domain <name>` 写 `~/.anysearch/config.env` 但仅 runDomain 自读，search/chat 等不生效。修：cli 入口在 `process.env.ANS_DOMAIN === undefined` 时从 config.env rehydrate（`??=` 语义；显式空串与已有 env 不被覆盖，保 `verify-observation.mjs` 的 env-scrub 语义）。config.env 读写移入 `apps/cli/src/config-env.ts` 共享。
3. **五端联动 doctor 不可见**：doctor 只校验内联 fixture，不读真实 `domains/*.toml`。修：doctor 新增 `[5] Domains` 段——按解析链列出发现目录与逐 TOML 校验结果；对活动域显示五下游层（sources.enabled / skills.active / hooks.toolWhitelist / prompts / rag.adapter），缺域时显式 FAIL 而非静默。
4. **policy 路径同病**：`domainTomlPath()`（url-policy.ts:107，plugin server / hitl / chat / ans-chat 共用）同改走解析链，保持与 loader 一致。

## 5. golden 首批清单（11 条：8 internal-dogfood + 3 external-community，provenance 逐条可回访）

| id | 提问（逐字/实录） | intent | 语言 | 期望锚点 | provenance.ref |
|---|---|---|---|---|---|
| docs-g0001 | MCP 的 session id 在 Streamable HTTP transport 里怎么传播？ | reference | zh | modelcontextprotocol.io transports（Mcp-Session-Id 头机制） | ADR-0056 session-id-propagation（本仓实证：propagation.test.ts） |
| docs-g0002 | pnpm-workspace.yaml 的 pmOnFail 和 package.json 的 devEngines.packageManager 怎么配合钉死 pnpm 版本？ | howto | zh | pnpm.io settings | ADR-0026 + 本仓 pnpm-workspace.yaml/package.json 实证 |
| docs-g0003 | better-sqlite3 不想跑 node-gyp，pnpm 怎么只放行它的 prebuild、不跑安装脚本？ | troubleshoot | zh | pnpm.io settings（allowBuilds/onlyBuiltDependencies） | AGENTS.md platform note + pnpm-workspace.yaml 实证 |
| docs-g0004 | tsconfig 的 moduleResolution "bundler" 和 "nodenext" 区别是什么？ | comparison | zh | typescriptlang.org/tsconfig | 本仓 8 个 tsconfig 全用 Bundler + paths 实证 |
| docs-g0005 | MCP 规范里 HTTP+SSE transport 是不是已经被 Streamable HTTP 取代了？ | factoid | zh | modelcontextprotocol.io（spec 2025-03-26 起废弃，backwards-compatibility 段） | 本仓 test/conformance mcp-2026-07-28-spec-source.json + ADR-0018 实证 |
| docs-g0006 | Where does tsc write the .tsbuildinfo file when incremental is true? | reference | en | typescriptlang.org/tsconfig（tsBuildInfoFile） | 本仓 .gitignore *.tsbuildinfo + turbo monorepo 实证 |
| docs-g0007 | tokio::JoinSet 怎么给检索 fanout 做结构化并发？ | howto | zh | **期望弃答**（tokio 文档不在 allowlist） | .scratch/grill-round-59/q3-prompt.md（CONTEXT.md:9 宣称被本地取证证伪的真实提问） |
| docs-g0008 | pnpm monorepo 里子包 tsconfig 用 paths 指到 workspace 包源码时，moduleResolution 该配什么？ | howto | zh | pnpm.io + typescriptlang.org（双源 multi-hop） | apps/cli/tsconfig.json paths→../../packages/*/src + pnpm-workspace.yaml 实证 |
| docs-g0009 | Option 'baseUrl' is deprecated and will stop functioning in TypeScript 7 — How can I fix this error? | troubleshoot | en | typescriptlang.org/tsconfig（ignoreDeprecations/baseUrl 迁移） | stackoverflow.com/questions/79923194（score 23，SO API 逐字） |
| docs-g0010 | Mark SSE transport as deprecated | reference | en | modelcontextprotocol.io（deprecated HTTP+SSE transport 段） | github.com/modelcontextprotocol/python-sdk/issues/2278（逐字标题+正文） |
| docs-g0011 | npm→pnpm migration: silent breakage when pnpm.onlyBuiltDependencies allowlist is removed (native modules like better-sqlite3 stop building without warning) | troubleshoot | en | pnpm.io settings | github.com/pnpm/pnpm/issues/12749（逐字标题） |

## 6. 八维切片词汇（本仓首次定义，落 eval-looks.coverage.json）

闭集词汇：
- `intent` 五类：factoid / howto / troubleshoot / comparison / reference
- `source-tier`：spec / reference / settings（首批全 first-party，按来源角色分级）
- `freshness`：stable / active / supersede-event
- `lang`：zh / en
- `attribution`：claim（claim 级 URL 归因）/ domain
- `hops`：single / multi
- `negative`：abstain（弃答负例）
- `adversarial`：injection（注入负例）

**Coverage manifest** `eval-looks.coverage.json`（schema `anysearch/eval-looks-coverage@1`）：每维 `{dimension, status: covered|deferred, count?, entryTrigger?, owner?}`；deferred 必带 entryTrigger + owner=B4；连续两轮收不到 → ADR documented deferral，禁止转合成（D-005）。

首批覆盖声明：intent（五类全）/ source-tier / freshness / lang / attribution / hops / negative:abstain = **covered**；adversarial:injection = **deferred**（历史中无真实注入尝试可收割；entryTrigger="docs 域真实流量中首次注入尝试 / B4 回灌"，owner=B4）。

## 7. 验收映射（任务书 T1 行逐项）

| 判据 | 落点 |
|---|---|
| 五端联动 doctor 可见 | §4.3 doctor [5] Domains 段 |
| pack→干净装→doctor→search 实跑 | §4.1 解析链 + §4.2 rehydrate + files 打包；本机 EXA_API_KEY 已设 → docs 域 enabled 含 exa → 真联网实跑 |
| spec 修正 cc-persona 失实前提 | §0 |
| golden 全带 provenance（internal-dogfood / external-community） | §5 |
| manifest 每维度 covered\|deferred 且 deferred 带入账触发 | §6 + eval-docs-golden.test.ts 机械断言 |
| eval-looks@2 × golden.test.ts 兼容核对 | §2（锚点失实已更正，真实兼容面已处理） |
