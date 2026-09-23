# Round-80 任务书 — 「发布就绪轮」实施

Date: 2026-09-23. 账本 `.scratch/grill-round-80/decision-ledger.md`（D-001~D-005 全 current，唯一权威数据源——任何实测与账本冲突→标 revised 呈报用户，禁止静默改向）；调研存档 `q1-atomcode.md`（发布就绪收窄/共享放行事件）、`q2-atomcode.md`（票序+γ 阻塞+例外五要件）、`q3-atomcode.md`（预首发/TP 边界）、`q4-atomcode.md`（新鲜度腿 gate-the-merge）、`q5-atomcode.md`（收口判据/棘轮表述/例外 register）。Stack 约定：`r80-grill`（本文档）← 实施栈叠其上（GitButler 分支，与其他栈并行互不写）。

## 状态快照（接手即知）

- main tip=`599b70ac`（R79 全栈落地核销），工作区干净；registry 12 条 open 债。
- **发布机械面现态**：`.github/workflows/release.yml` pre-tag dispatch（OF peek+账本回写+自派发 ci/ship-gate 等绿）→tag push→OIDC trusted publishing（无 NPM_TOKEN）；**pack 清单硬编码 `packages/embedding apps/cli apps/mcp apps/plugin`——dsh-plugin 不在发布路径**。`docs/publishing.md` 有 0.0.3 手动首发先例记档（「The package must exist already (published manually at 0.0.3)」）。
- **dsh-plugin 现态**：`apps/dsh-plugin`=`@anysearch-cli/dsh-plugin@0.0.7`，`private: true` 无 publishConfig；files=lib+cordis.patch.yml+AGENTS.md；keywords 含 dsh-plugin（发后即入官方目录）。R72 已端到端验证发布形状（pack→`dsh plugin add`→dump-config）。
- **版本面**：全仓 9 包钉 0.0.7；公开集 4 包 access:public。
- **ship-gate 现态**（`scripts/ship-gate.mjs`）：step 1b=ADR index freshness（`gen-adr-index.mjs --check`）、governed-json canonical、1g=closeout handoff 必填字段、1h README parity、1i pathlint——新鲜度腿是扩覆盖面非造新闸；R79-F1 已证闸会正确翻红。
- **E6 实证缺口**：`pnpm-workspace.yaml` `minimumReleaseAge: 2880`+`IgnoreMissingTime: false`（R78 已落）；`trustLockfile` 未设=默认 false；frozen/fetch 回放绕过龄期闸实证在案（registry `defer-r79-lockfile-agegate-replay`）；pnpm 11.3+ trustLockfile 验证腿在钉版 11.24.0 覆盖度未实测=本票核心。
- **上游哨戒**：`0.1.5-rc.3`/`0.1.7-alpha.1` ≈2026-09-24 05:39/06:04Z 出闸窗口已过=复核义务到期；`#1764` OPEN 趋僵（gh 前次网络未通，不通则如实记「未验」）；transformers `4.3.0`。
- **flake watch**：kernel `llm-init.test.ts` SSE stub 并行竞态（R79 复审观测项）——复现即升级非静默。
- **外部前提（用户动作，非票内）**：手动 `npm publish @anysearch-cli/dsh-plugin@0.0.7` 首发+npmjs TP 配置（repo/workflow/environment+allowed actions 勾 `npm publish`）——v0.0.8 tag 前置；未就绪→顺延不拆清单。

## T0 — ride-along 上游取证（覆盖 D-001 腿 4+D-005(i)；纯证据零代码）

1. **L0**：`npm view @deepseek-ai/dsh-agent time version dist-tags --json` 快照落档；rc.3/alpha.1 出闸态对表复核（09-24 ≈05:39/06:04Z 窗口前后实录）；
2. **#1764 哨**：`gh pr view 1764 --repo huggingface/transformers.js --json state,mergedAt,updatedAt,title`——网络不通如实记「未验」；
3. **格式化结论行**（零发现也须显式+观测窗口截至戳）：形如 `watch @ <ISO ts>: rc.3=<gate-state>, alpha.1=<gate-state>, #1764=<state|unverified>, action=none|escalate`；
4. 归档 `evidence/t0-watch-rc3-alpha1.md`（+json 快照）；纯证据零代码不动依赖面；意外（rc 线突携特征锚=事件重命名双锚候选）如实呈报。
- **验收**：transcript+格式化结论行+观测窗口时间戳三件套齐；`git status --porcelain` 依赖面零脏。

## T1 — E6 闸内执法（覆盖 D-001 腿 2+D-002 γ 语义+五要件；实验+决策记档）

1. **实测矩阵**（钉版 pnpm 11.24.0，transcript 全归档 `evidence/e6-matrix.md`）：frozen lockfile 回放 bypass 复现 / fetch 回放变体 / `verifyDepsBeforeRun` 变体 / **trustLockfile 验证腿覆盖度优先实测**（pnpm 11.3+ 文档声明 vs 本仓 E6 证伪张力裁决——若天然覆盖，放行依据升级为「上游机器腿闭合」，例外记档降级为 CI 断言依赖声明）；
2. **三选一决策记档**（产出落 T4 ADR-0081）：a) 自建护栏→R81 独轮立项；b) 引用上游（trustLockfile/上游修复版本）→记档核销；c) 显式接受→registry 转 time-bound exception 记档态；
3. **γ 阻塞判定**（可核验触发条件三件）：lockfile 在册已含闸内未成熟版本 / 回放可投毒构建产物 / trustLockfile 验证腿实测不覆盖——命中任一→阻塞 0.0.8 呈报用户；未命中→例外放行记档（五要件：policy 引用+justification+已验证补偿控制「lockfile review 纪律」+具名 acceptor+到期日≤90 天+复验触发事件「pnpm 上游修复/lockfile 变更/新 GHSA」+续期须新轮立项+例外 ADR↔transcript 双链）。
- **验收**：变体矩阵逐格输出+格式化结论行+观测窗口截至戳+决策三选一明确落档；阻塞判定引用可核验条件非裁量。

## T2 — 产品备货（覆盖 D-001 腿 1+D-003；机械部分可与 T0 并行启动）

1. `apps/dsh-plugin/package.json`：private→false+publishConfig `{access:"public", provenance:true}`（对照公开集 4 包同构字段）；
2. `.github/workflows/release.yml` pack 清单接入 `apps/dsh-plugin`（按现有四包形态最小 diff：pack 步/job 矩阵/发布步）；
3. **pack 实物复验**：`pnpm pack` 拆包核对 files 面+`dsh plugin add` 对本地 tarball 复验（R72 同款路径）；
4. **0.0.8 全仓 sync-bump**（9 包同批）+CHANGELOG r80 轮次条目；
5. `docs/publishing.md` 扩「新包首发」节：预首发四步（手发→TP 四字段 repo/workflow/environment/allowed actions 勾 `npm publish`→tag 后 OIDC+provenance）+**provenance 边界声明**（证明 origin 非 integrity——Miasma 教训）+no-go 分支（首发/TP 未就绪→顺延不拆清单）。
- **验收**：pack 拆验文件面与声明一致；dsh plugin add 复验通过；release.yml diff 评审；无版本碰撞路径；`pnpm install` 无脏。
- **红线**：不建幂等跳过；不发占位包；TP 未就绪不拆清单不代发。

## T3 — 派生件新鲜度腿（覆盖 D-004；工程 commit）

1. ship-gate step 1 家族扩面（新子步 1j/9 或并入 1g 家族，粒度自决但 fail-closed 与 1b/1g 同构）：
   - **CHANGELOG 当前轮条目在场断言**（fail）+豁免字段 `no-changelog-entry: <理由>`（结构化可解析，豁免需理由非空）；
   - **可机验声明注册面**：closeout-coverage 信号注册扩展——计数类（有推导命令）/符号·路径存在性（文档提及脚本·闸名实物存在）/日期·轮次号在场——声明与推导命令同一次 diff 变更；
   - **分档强度**：客观可修=fail；叙述一致性代理信号=warn 起步下轮升 fail；
2. **红向实测**：陈旧 fixture（轮次条目缺位/计数失真/无豁免字段）造红留证，复绿；
3. **dogfooding**：本轮自身收口过新闸——发现 issue 处置记档（产证据非仅通过）。
- **验收**：新子步绿树绿/陈旧 fixture 红；豁免字段解析测试；注册面信号重推导与文档声明一致；ship-gate 全程绿。
- **红线**：不重复造已覆盖面（adr-index/governed-json/handoff 字段）；叙述断言不直接 fail。

## T4 — 文书收口（覆盖 D-001 范围外+D-005(iii)；docs-only）

1. **ADR-0081**：发布就绪轮主题+四腿+γ 阻塞语义+五要件例外形态+预首发路径+新鲜度腿设计+E6 三选一裁决+**rejected alternatives**（B 时序倒置/C 杂物筐/D 第五轮治理+β 无条件阻塞+幂等跳过+非闸化自律+冻结措辞）+**provenance 边界注记**（origin 非 integrity）+先例层级如实标注（「声明重推导」=fitness function+executable docs 组合推断级）；
2. **registry**（canonical normalize 全程）：`defer-r72-dsh-plugin-npm-publish` 更态（就绪待用户扳机）+`defer-r79-lockfile-agegate-replay` 记裁决（例外则五要件+到期+双链）+10 债 carried_log r80；
3. **handoff**（R81 候选序：自建护栏若触发>L2 双锚>#1764 哨>flake watch 升级线）+**判据↔证据映射表**+**度量单行**（闸新增断言数/例外到期日/发布面包数 4→5）；
4. **pathlint 棘轮表述宣告**（ADR-0081 内）：豁免域基线只减不增+新豁免走 ADR 修订路径+回归击穿=stop-everything——禁「冻结」措辞；
5. **审计红 commit 工序例外注记**引 ADR-0074 rewrite-map 为处置预案；
6. **用户动作清单**：手发 dsh-plugin@0.0.7→npmjs TP 配置（勾 npm publish allowed action）→推 v0.0.8 tag→外发两份 draft（#1764 comment+外发闸件）；
7. `.gitignore` round-80 白名单已随本 commit 落；but 干净收尾。

## 红线

- 实测与账本冲突→对应 D-xxx 标 revised+新 D 呈报用户拍板，禁静默改向；
- 票间禁跨改（T1 不动产品面/T2 不动闸面/T3 不动发布面）；
- dogfooding 发现问题不静默修复——先记档再修（修=另 commit）；
- 豁免域动任何条款=新 ADR+红绿成对（棘轮表述生效中）；
- 用户外部动作未就绪→顺延不拆清单，禁代理代发；
- gh/npm 外部实况不可达→记「未验」非静默跳过。

## Suggested skills

`$implement`（票流驱动）· `$but`（版本控制）· `$atomcode-research`（E6 实测口径/trustLockfile 上游深查预备）· `$handoff`（收口）· tdd/diagnosing-bugs（model-invoked：fixture 红绿纪律与判定器调试）· writing-for-agents（publishing.md 首发节文体）。
