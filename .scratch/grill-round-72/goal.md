# Grill Round 72 — Goal（定稿）

**主题**：DeepSeek Harness（dsh）宿主适配——verified-hosts 表第 6 行，首个「进程内事件 waterfall 模型」宿主（前五家均为子进程 hooks 模型）。

**状态**：grill **定稿**（账本 4 条 current，D-001~D-004，无断号无 revised）。两题 atomcode 交叉（Q1 否证全量原生推断→两阶段 C；Q2/Q3 各带修正入决议）。

## 裁决摘要（指向账本，不复制）

- D-001：两阶段 C——Phase-1=文档化 cordis.patch.yml MCP 桥行（零产品代码）；Phase-2=薄 Cordis bundle 只做 hooks 层（注入/预热/URL deny/蒸馏），业务逻辑全走 127.0.0.1 HTTP IPC；spike 门控，红则 Phase-1-only+证据落档。
- D-002：`apps/dsh-plugin`（@anysearch-cli/dsh-plugin）零运行时依赖新包；dsh.bundle patch 整行复述 mcp-client keys 做一步装；cordis/dsh 类型仅 devDeps=编译期 churn 报警器；private:true 本轮，tarball 形态验证。
- D-003：四票串行 T0 spike（9 项，#8 blocking，PASS/FAIL/RESHAPE 回流 T1）→T1 双件（mock ctx 单测绿为出口，集成绿归 T2）→T2 三桶探针矩阵+web 具名两探针+HMR+幂等+doctor 腿+churn lint 控件+tarball 验证+verified-hosts 第 6 行→T3 文书收口（红则另出具名重返票）。
- D-004：四段收口判据（spike/落地/验证/文书，本票文档自身过 path-lint）。

## 显式范围外

- 5 工具原生 `ctx.tools` 注册——deferred backlog（ADR-0073 记演进条件：dsh API 稳定/桥接层不足如 KV-cache prefix 控制/guard 级策略）。
- `@anysearch-cli/dsh-plugin` npm 发布——deferred 至 release 道（下轮 publish=改一个字段非考古）。
- web profile 全探针矩阵——本轮仅具名两探针（inject 注入+preheat 标记）+HMR 检查，余标 untested。
- R71 handoff 遗留项（ship-gate 1g 缺口 / macos-spillover-probe 红因 / transformers 上游 undeclared-dep 跟进 / F3 inRepo() 注记 / r71-audit 栈合 main 决策）——续 deferred，handoff 承接。

## 现场

- Branch：`r72-grill`（GitButler，与 r71-audit 等栈并行互不写）；base：main tip `c4ced36a`（R71 后三绿）。
- 账本：`.scratch/grill-round-72/decision-ledger.md`；调研存档：`q1-atomcode.md`/`q2-atomcode.md`/`q3-atomcode.md`。
- 任务书：`.scratch/grill-round-72/handoffs/next-round.md`——下一棒零记忆接手。
- 环境就绪实证：Node v24.11.0（dsh 要求 22.19+/24+ ✓）、pnpm 11.24.0、`@deepseek-ai/dsh@0.1.5-rc.2` 在 npm 可达。

## 路径教义自证

本目全部文档遵循 ADR-0072 Reference-Purpose Path Discipline：Stack 定位器可绝对路径，库内内容引用一律 repo-relative，库外目标须绝对路径+治理型标记。path-lint（ship-gate step 1i）对本目生效。
