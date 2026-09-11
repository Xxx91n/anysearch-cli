# Grill Round 57 — Decision Ledger

数据源纪律：本账本是本轮整理的唯一数据源。

## D-001 — Round 57 主题

- **原问题**: Round 57 grill 主题（A. 测试真相化与 CI 取信 / 其他）
- **用户原回答原文**: "A"
- **规范化需求**: Round 57 一题一轮做「测试真相化与 CI 取信」：清除测试内硬编码本机路径（domain-loader.test.ts 的 D:/Aworker 硬编码）；store 50 个测试文件的 && 串链改为真正的 test runner（node:test 级别即可，断链致后续文件全不跑的机制必须消除）；CI（ci.yml + ship-gate.yml）覆盖全包测试并保持全绿；embedding 测试的网络依赖密封（不联网环境不红）；README 宣称不入库的 .scratch/ 入库漂移清理。锐评处方第 1 条为期石。锐评第 2~6 刀（engine 死配置/grace window 落地、resolveDbPath mkdir、doctor 版本、plugin server CORS+token、api.anysearch.com 归属、eval 治理层冻结）显式排除在本轮之外，各自另立轮次。
- **显式约束/负向需求**: 不做新特性；不做锐评第 2~6 刀；grill 阶段不动手修源码；版本控制用 GitButler 独立分支，与 main 并行互不干扰。
- **状态**: revised（修订于 D-004/D-005：a=resolveDbPath mkdir 纳入 Phase 0 前置；c=embedding 网络密封改为注桩+tags 拆分，不再整体轮内）
- **来源**: 锐评报告第一刀 + 处方第 1 条 + ADR-0056 push 报告 AC5 PARTIAL（CI 预存损坏）

## D-002 — 测试执行机制：node:test + tsx + turbo per-package

- **原问题**: Q2 测试执行机制选型（A. node:test 官方 runner / B. vitest / C. 保留手写只修串链）
- **用户原回答原文**: "接受"（对 atomcode 调研推荐的路线 A）
- **规范化需求**: 全仓测试执行机制迁移到 node:test 官方 runner。落地三要素：
  1. 每包 package.json test 脚本统一为 `node --import tsx --test "test/**/*.test.ts" "test/**/*.test.mjs" --test-timeout=30000`，删除全部 && 串链；第一步零测试代码改动（runner 按退出码判定），后续增量把 `let passed=0` 手写计数改写为 describe/it + node:assert/strict；
  2. turbo.json 的 test 任务改为 `{ "dependsOn": ["^test"], "cache": false }`（先保守不缓存，稳定后再按包开缓存）；
  3. CI 显式 `--test-reporter=spec`（规避 Node 22 非 TTY 默认 TAP）。
  vitest 被显式拒绝：整棵 Vite 依赖树与 ADR-0017/0026 零依赖克制纪律相冲，甜点区（Vite 管线/组件/快照）本项目全不占。
- **显式约束/负向需求**: 零新增依赖；不引入 vitest；手写计数器是增量改造目标而非第一步硬门槛；风险项必须落地时实测——store 文件级并发共享 sqlite 临时目录（可能需 --test-concurrency=1）、Node 22 --test-timeout 默认值语义、spawn 型测试并行端口冲突。
- **实证基线**（调研本次发现，作为验收对比基准）: 全仓 73 个测试文件；store 链 52 段 vs 目录 56 文件；eval-switch-state-fixes.test.ts 串链遗漏从不执行；CI 只跑 kernel 14 文件（59/73 未覆盖）；turbo.json test 为 {} 空配置。
- **状态**: current
- **来源**: atomcode 深度调研（13 来源：Node.js 官方 test runner 文档 v26.8.2、Vitest 官方 comparisons、Turborepo 官方指南、PkgPulse 2026、vitest#4631、tsx#410、Gleb Bahmutov 实测等）+ 本地代码实证

## D-003 — 红测试处置：B+ 混合策略（expectations 清单模型）

- **原问题**: Q3 CI 收录形态与验收门槛（A. 最小替换一起修完 / B. 显式盘点 skip-todo 挂 issue / C. 全量一口气）
- **用户原回答原文**: "接受"（对 atomcode 调研推荐的 B+ 混合策略）
- **规范化需求**: 红测试处置走工业界 expectations 清单模型（Chromium TestExpectations / WebKit TestExpectations + lint 强制 bug id / WPT metadata / Mozilla manifestparser 自动报 bug / pytest strict_xfail），落地三阶段：
  - Phase 0（纯机制 PR）：全部包 test 脚本改 node:test 自动发现，删全部 && 串链；CI 改为 `turbo run test --continue=dependencies-successful`（Turbo 2.5 旗标：单包红不挡其它包执行，收集全量真相）；73/73 文件在 CI 执行是硬判据。
  - Phase 1（红测试三分类）：修（可修的吃掉）/ 标（`{ todo: '<issue 链接>' }`——照跑不红，执行证据留存，每条强制挂 tracked issue）/ 删（过时的逐 commit 说明删除依据）。
  - Phase 2（防腐烂台账）：复用 .ship-gate/skip-ledger.json 与 ADR-0020 conformance expected-failures 先例；CI 守卫——todo/skip 必须带 issue 链接、台账计数只降不升、每轮 grill 盘点。
- **显式约束/负向需求**: 禁止无条件 skip（死代码）；禁止静默不修；「所有测试通过」不是门槛；「CI 绿」也不是终点；Node 22 上 expectFailure 不可用（需 >=24.14），本轮用 todo 起步，Node 升级后批量迁 expectFailure（strict 语义）。
- **验收判据**: CI 全包执行 + 零未登记红 + 每个标记可归因 + 排除机制结构性消失（链式成员资格死亡）。
- **状态**: current
- **来源**: atomcode 深度调研（15 来源：Chromium/WebKit/WPT/Mozilla/pytest/node:test/turbo 官方文档全文实读 + ganssle/glebbahmutov 社区实测）+ 本地核查（conformance.expected-failures、skip-ledger 先例已存在）

## D-004 — 范围修正：resolveDbPath mkdir 纳入 Phase 0 前置（修订 D-001）

- **原问题**: Q4 三项相邻修复的轮内范围裁决，其中 a=resolveDbPath 不建目录
- **用户原回答原文**: "接受"（接受 atomcode B 推荐 + 修订呈报）
- **规范化需求**: apps/mcp/src/server.ts:25（实际缺口位置，非 store）的 resolveDbPath 调用处加 mkdirSync 兜底，一行修复 + 一个对应回归测试（/test/server.test.ts Test 4 已有现成断言形势可挂）。纳入理由：enabling change——不修则 Phase 0 验收判据"73 测试文件全执行"在 apps/mcp 必红，ci.yml smoke 步骤已现在红着，不修等于不治。
- **显式约束/负向需求**: 仅此一行级别修复，连带 doctor.ts（v0.0.0）与修复端 api.anysearch.com 归属确认仍显式排除在 Round 57 之外，另立轮次。
- **状态**: current
- **来源**: atomcode 调研本地实证（apps/mcp/src/server.ts:25 vs apps/cli/src/db.ts:9 差异）；Google Small CLs / SWE-book CI 章『Don't Break the Build』丶『presubmit 只跑 fast & reliable』惯例

## D-005 — embedding 测试网络密封：注桩默认 + tags 拆 online（修订 D-001 c 子项）

- **原问题**: Q4 c 子项——embedding 测试网络依赖密封方案（纯注桩单文件 / 拆 offline-online 两脚本 / 折中）
- **用户原回答原文**: "接受"（接受 atomcode 折中推荐）
- **规范化需求**: embedding.test.ts 重构为两层：默认套件全部注桩走 __setExtractorForTest（role 前缀拼接、normalize、熔断、telemetry、fail-open——这些是 wrapper 逻辑）；真实模型网络路径拆为显式 online 测试，用 node:test 原生 test tags + --test-tag-filter 拆成 test:online 脚本，默认不进 CI（或进独立 job 带模型缓存预热）。工业先例：SWE-book ch23 hermetic 默认、Sopel --offline / vcrpy @pytest.mark.online、Fowler ContractTest 分层。
- **显式约束/负向需求**: 禁纯注桩单文件（真实模型零覆盖 = 断言循环论证，与『测试真相化』主题相悖）；零新增依赖；Node 22 上 test tags 若为实验性需实测，退路为独立 test:online 脚本 + env gate（同样零新增依赖）。
- **状态**: current
- **来源**: atomcode 调研（SWE-book ch23 / pytest-test-categories / Sopel / vcrpy / Fowler ContractTest / Rainsberger）+ 本地实证（embedding.test.ts 测试 1-3 无注桩直接走真实 getExtractor()）

## D-006 — ADR 残账继承：AC5 显式承接（Round 57 ADR 声明关闭 ADR-0056 AC5）

- **原问题**: Q5 ADR-0056 AC5 残账在 Round 57 的处理（A. 显式继承 / B. 显式切割）
- **用户原回答原文**: "ok"（接受 atomcode 推荐的工业界组合形态）
- **规范化需求**: 按工业界 ADR 惯例的"组合形态"四步落地，同 PR 原子提交：
  1. Round 57 新 ADR 增独立小节「Carried-over Acceptance Criteria Closure」：声明「Closes ADR-0056 AC5: pnpm -r check/test/build clean + ship-gate passes (CI 全绿)」，附证据（CI run 链接 + ship-gate log + 全包测试执行记录）；与本轮新判据分区书写互不污染。
  2. ADR-0056 仅动一行状态/指针：「AC5: CLOSED by ADR-XXXX (日期)」，Decision 与正文一字不改。
  3. 两处指针同 PR 原子提交（杜绝单向指针——MADR/KEP/WhyChose 共同惯例）。
  4. deferred-registry 补录一条 AC5 残账记录，标 closed-by: ADR-XXXX（机器可查，同构于本仓已有 defer-XXXX 与 skip-ledger 纪律）。
- **显式约束/负向需求**: 永不重写旧 ADR 正文；禁止 reopen 语义（AC5 不是反转是关闭）；本轮 ADR 若不声明承接则产生追踪空洞——ADR-0058 曾 Amends 多条却漏点名 AC5，是既有教训。
- **状态**: current
- **来源**: atomcode 调研（Nygard 2011 原文 / AWS Prescriptive Guidance / MS Well-Architected / Fowler / MADR / KEP-0000 / GEP probationary / WhyChose supersession pattern，6+ 独立信源一致）+ 本地实读（ADR-0056 无 AC5 PARTIAL 标记、ADR-0058 无承接声明）

## D-007 — Round 57 验收判据清单（最终落盘）

- **原问题**: Q6 Round 57 验收判据完整形态（逐条锚定 D-xxx 的 7 条清单 + 显式排除）
- **用户原回答原文**: "将 Q6 的 7 条验收判据写入账本（D-007），让我此刻落盘判据清单（含显式排除锐评剩余刀口），之后再整理"
- **规范化需求**（7 条判据，每一条锚定既有 D-xxx，来源为其规范化需求+负向需求的交集）：
  1. **机制达成**（锚 D-002）：73 个测试文件 100% 进入 CI 执行（ubuntu+windows 双矩阵），与每个 store 包 52 段 && 串链的链式「成员资格」排除机制结构性消失；
  2. **零未登记红**（锚 D-003）：每个红测试三分类处置完毕（修/带 issue 的 todo/删），无静默 skip；
  3. **全包绿的 CI**（锚 D-002/D-003）：ci.yml 与 ship-gate.yml 双绿，`turbo run test --continue=dependencies-successful`；
  4. **网络密封**（锚 D-005）：embedding 默认套件全部注桩，`test:online` 显式 gate，断网环境 `turbo test` 全绿；
  5. **前置修复**（锚 D-004）：apps/mcp resolveDbPath mkdir 修复带回归测试（apps/mcp/test/server.test.ts Test 4）；
  6. **AC5 承接**（锚 D-006）：Round 57 ADR 显式声明「Closes ADR-0056 AC5」+ ADR-0056 指针行 + deferred-registry 补录；
  7. **文档-现实漂移**（锚 D-001）：.scratch/ 漂移入库清理，README 所宣称不被 git 追踪的路径与实际一致。
- **显式排除（本轮范围外，各自立轮次）**：
  - 锐评第2刀：engine 死配置（AbortController .abort()、graceWindow、deepMode）
  - 锐评第3刀：doctor 版本号 v0.0.0
  - 锐评第4刀：plugin server CORS * 且默认无 token
  - 锐评第5刀：api.anysearch.com 归属与默认上游身份
  - 锐评第6刀：eval 治理层（6562 行）冻结与 0 输入错配
- **状态**: current
- **来源**: 账本 D-002/D-003/D-004/D-005/D-006 全部结论的合并 + Q6 提问原文 + 用户确认「写入账本」拍板
