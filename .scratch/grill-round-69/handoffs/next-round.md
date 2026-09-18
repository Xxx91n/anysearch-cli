# R69 任务书 — grill-round-69（GitHub 门面/README 双语化 + T0 火线修红）

生成时间：2026-09-18。数据源唯一源：D:\Aworker\anysearch-cli\.scratch\grill-round-69\decision-ledger.md（D-001/D-003~D-009，D-002 空号=Q2 跳号证据）。调研存档：D:\Aworker\anysearch-cli\.scratch\grill-round-69\q4-atomcode.md。

## 开局事实（勿重查）

- main tip ship-gate **红**：run https://github.com/Xxx91n/anysearch-cli/actions/runs/35305407630 在 e265667（docs(r69) 方向指示 commit）上 FAIL——ship-gate step 1g/9 handoff-lint 把 D:\Aworker\anysearch-cli\.scratch\grill-round-68\handoffs\round-69-direction.md 当收口件（isCloseout 命中 ^round-\d+），判缺「绿色 run URL」段+Stack 头+run URL 引用。
- 方向文档原文主张「双 land 远端三绿」但未引 URL——主张-引证教义违例成立；三绿 run=35302952077(ci)/35302952056(ship-gate)/35302952093(native-smoke)，head_sha=6acc53c 为 HEAD 祖先，补引证 liveness 腿可过。
- 现 README（D:\Aworker\anysearch-cli\README.md）312 行：Known limitations ~100 行+Architecture decisions ~76 行=56% 工程审计；verified hosts 表内嵌机器路径 D:/Aworker/... 泄漏；无徽章无双语。
- ADR index 是生成件：scripts\gen-adr-index.mjs --check 由 ship-gate step 1b/9 值守（ADR-0059 D6）——README 内嵌段迁出必须同步改靶，否则自红。
- 仓库元数据现状：description="anysearch-cli monorepo"、topics 空、homepage 空；LICENSE=Apache-2.0 全文但 GitHub 判 Other（licensee 未识别，顺手查）。
- R68 已核实的修复实物（勿重修）：looks-ledger.ts Tolerant Reader、eval-abstain excludeGroups、release.yml 双层 gate、ship-gate 1g handoff-lint、R67 closeout 回填。

## 串行票 T0→T7（一票一验，沿用 R67/R68 惯例）

### T0 — 火线修红（覆盖 D-006, D-001）

双修：(i) D:\Aworker\anysearch-cli\.scratch\grill-round-68\handoffs\round-69-direction.md 补「## 绿色 run URL」段+Stack 头行+引三条三绿 run URL（上列）；(ii) D:\Aworker\anysearch-cli\scripts\ship-gate.mjs isCloseout 收窄——要求 closeout|closure 关键词，^round-\d+ 裸前缀不再单独命中。

验收锚：双向验证——round-69-direction.md 脱靶（形状腿不再命中）AND round-67-closeout.md 仍命中（收窄未过度）；push 后 ci+ship-gate 真实双绿 run URL 入账。

Suggested skills: neat-freak, gitbutler, code-review。

红线：不改名绕 lint；不删 lint；收窄后必须跑一遍 ship-gate --quick 证明双向。

### T1 — 迁移地基（覆盖 D-004）

先于门面：(i) D:\Aworker\anysearch-cli\docs\limitations.md 立件——README Known limitations 全文迁入（保留全部条目，不改写事实）；(ii) D:\Aworker\anysearch-cli\docs\adr\index.md 生成——gen-adr-index.mjs 重指向新目标，保留 generate-and-diff 纪律；(iii) ship-gate step 1b 同步改靶（信息/文案同步更新）。

验收锚：docs/limitations.md 与 docs/adr/index.md 实物存在；node scripts/ship-gate.mjs --quick 全绿（1b 新靶通过）；README 尚留旧段时新旧双在属过渡态，T2 摘净。

Suggested skills: domain-modeling, neat-freak。

红线：迁移≠改写——limitations 条目逐字保留；index 生成逻辑不重写只换目标。

### T2 — README EN 重构（覆盖 D-003, D-004, D-005）

D:\Aworker\anysearch-cli\README.md 重写为登录页 IA：顶部 switcher+badges（npm version/ci/license——只放动态可验证端点，Evidence Integrity）→3 秒主张→Requirements→Quickstart→Domains & abstain 差异化（精简保留）→Provider matrix 精简→MCP server→Verified agent hosts 表（保留，Proof 区）→Known limitations top-3 摘要表+docs/limitations.md 指针→Design rationale 三句（垂直领域/abstain-first/fail-open）+docs/adr/ 指针→For contributors 浓缩+docs 指针。机器路径清零（改仓库相对路径或删）。

验收锚：旧 76 行 ADR 目录与 100 行 limitations 全文消失；grep 机器路径零命中；所有指针指向 T1 已立实物；徽章端点真实可达。

Suggested skills: beautify-github-readme, readme-crafter-skill-main, writing-for-agents。

红线：不砍 verified-hosts/Quickstart（Proof 区）；limitations top-3 必须忠实（top-3 选取进票内裁，诚实不粉饰）；不 hero 图不社交预览图（D-005）。

### T3 — README.zh-CN.md 伴生件（覆盖 D-003）

D:\Aworker\anysearch-cli\README.zh-CN.md 新建：与 README.md heading 结构 1:1、代码块/链接 byte-identical、仅 prose 翻译；顶部声明"翻译件，规范以 README.md 为准"+switcher；README.md 顶部同步补 switcher。垂直领域理念用母语讲透（非二等翻译）。

验收锚：heading 1:1+code/link byte-identical 机检通过；canonical/translation 双声明在；互链可达。

Suggested skills: readme-crafter-skill-main, writing-for-agents。

红线：只翻 prose；canonical 必须先稳定（T2 完成后才开工）。

### T4 — 值守检查（覆盖 D-007）

ship-gate 新增 standing fail-closed 步（step 1g 同族）：(i) 双语 parity——heading 1:1+code/link byte-identical；(ii) docs/limitations.md 存在且 README 指针可达。漂移持续=持续红。

验收锚：红→绿证据对——人为制造 drift（改 EN 不改 CN）触发红→修复转绿；正常态全绿；证据 transcript 入库。

Suggested skills: tdd, diagnosing-bugs。

红线：fail-closed 非 warn；不做仅当次 diff 命中的窄触发（漂移须持续红）。

### T5 — 元数据+顺手项（覆盖 D-005, D-001）

(i) gh repo edit：description 改产品向一句 EN（垂直领域信息专精 Agent CLI）+topics 加标签（进票内定清单）+记录命令进证据；(ii) LICENSE Other 识别查（licensee 未识别原因，处置或记 deferred）；(iii) 顺手项逐条处置：L-1（D:\Aworker\anysearch-cli\.scratch\grill-round-68\reports\2026-09-17-report.md L43 相对路径改绝对）、L-2（D:\Aworker\anysearch-cli\scripts\verify-observation.mjs step-8b 时序抖动——加等待/重试窗或显式 deferred 条目）、F-S4 残留语义（两段式 discovery/completion 截止——开票或记 deferred）、ship-gate.mjs gh issue create 双写回退注释清理。

验收锚：gh repo view --json description,repositoryTopics 返回新值；顺手项逐条 found/fixed/deferred 三元组入账无悬置。

Suggested skills: neat-freak。

红线：元数据=设置面变更，命令+前后 JSON 都进证据；不顺手扩 .github 基建。

### T6 — 文书（覆盖 D-001, D-003, D-004, D-005, D-007）

(i) ADR-0070 立件（D:\Aworker\anysearch-cli\docs\adr\0070-*.md）：主题+D-001/D-003~D-007 决策条目+Closure evidence（D-009 四段）；(ii) CONTEXT.md R69 词块已在账（8 词，若实施生新词再补）；(iii) CHANGELOG 更新；(iv) found/fixed/deferred 三元组——含 Q2 跳号过程违规自报、LICENSE Other 处置、顺手项逐条、方向指示三线 deferred 重申。

验收锚：ADR-0070 与账本 D-xxx 双向映射无裸记录；三元组每条有处置。

Suggested skills: domain-modeling, neat-freak。

红线：ADR 数据源=账本实物，不从对话回忆补结论。

### T7 — 收口（覆盖 D-009, D-008）

四段收口证据+goal 定稿+handoff：修红段（T0 双绿 run URL+收窄双向验证）；门面段（README 双件 diff+parity 机检证明+机器路径零命中+badges 端点+docs 实物+元数据 JSON）；值守段（T4 红→绿证据对+gen-adr-index 重指向证明）；文书段（ADR-0070+词块+CHANGELOG+三元组+handoff+账本对账）。

验收锚：四段齐+全绝对路径+Stack/绿色 run URL 必填栏齐（自身收口文档过 1g lint）；but 终态干净。

Suggested skills: handoff, neat-freak, gitbutler。

红线：CI 绿不算收口；账本约定无锚点不算数。

## 验收基线（修后重跑清单，R68 沿用）

pnpm build；pnpm -C packages/store test（62）；pnpm -C apps/plugin test（antigravity 13/codebuddy 18/claude 10/codex 11/propagation 41）；pack×7（ship-gate step4）；node apps/cli/dist/index.js --help；MCP initialize+fail-open boot（scrub env）；node scripts/ship-gate.mjs --quick 全绿+必须留 committed transcript（P-V2 范式）；assert-checks-green 夹具（stale→exit≠0，全 allowed→exit0）。

## 纪律

- deliverable 一律绝对路径（AGENTS.md 硬性规则）。
- 版本控制只走 but（commit/land/push/pull），不跑 git 写命令；改前备份（R67 Backup-Before-Mutation）。
- 防丢：每个被确认结论当场入 D:\Aworker\anysearch-cli\.scratch\grill-round-69\decision-ledger.md；压缩/handoff 前先确认账本最新。
- 本收口文档自身须过 1g lint（Stack+绿色 run URL+run 引用）。

## 显式范围外

- 真 release 摘 partial 帽 / agy P7 真链 / PR-mode 治理（外部前置，R68 方向指示沿用）
- deferred 池：cursor/F-01a/npm provider/projectIndex/TUI/embedding/cross-OS/plugin/watch
- .github 基建、图像资产（D-005 出界）
