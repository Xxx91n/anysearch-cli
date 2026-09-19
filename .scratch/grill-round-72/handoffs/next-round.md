# Grill Round 72 — 下轮任务书：DeepSeek Harness 宿主适配

> 常驻任务书：任意子 Agent 可零记忆接手。唯一裁决源=`.scratch/grill-round-72/decision-ledger.md`（D-001~D-004 current，无断号）；调研存档=`q1/q2/q3-atomcode.md`（同目）。
> 路径纪律（ADR-0072 现役）：本文件 Stack/定位器行可绝对路径；库内内容引用一律 repo-relative。

**Stack**：repo `D:\Aworker\anysearch-cli`（Git Bash；写文件用 node.js 防嵌套断连）；branch `r72-grill`（GitButler 新建，与 r71-audit 等栈并行互不写）；base main tip `c4ced36a`（R71 后 ci/native-smoke/ship-gate 三绿）；环境实证 Node v24.11.0 / pnpm 11.24.0 / `@deepseek-ai/dsh@0.1.5-rc.2` npm 可达。

**北极星**：verified-hosts 表第 6 行=DeepSeek Harness——首个 in-process 事件 waterfall 宿主。工具面走官方 MCP 桥（`mcp__anysearch__*`），hooks 层走薄 Cordis bundle（事件挂载、业务逻辑全留 127.0.0.1:33333 HTTP IPC）。

---

## T0 — 契约发现 spike（Spike-Gated Ticket）｜覆盖 D-001/D-003

**产出**：`.scratch/grill-round-72/reports/spike-report.md`——9 项逐项 PASS/FAIL/RESHAPE（RESHAPE 带重形机制名）+证据 transcript+Phase-2 go/no-go 判定。**#8 为 blocking 项**；RESHAPE 项必须回流 T1 票文才准开 T1。

**探针清单**（pin `@deepseek-ai/dsh@0.1.5-rc.2`，`npx` headless 实跑，`$DSH_HOME` 用隔离临时目）：
1. waterfall 异步序列化：`tools/pre-execute` listener 内 async await IPC 后调 next() 是否被正确序列化（决定 URL-policy deny 用 waterfall 还是 guard——dispatch 表标 Not awaited 是文档空白）。
2. `agent.inject()` 语义：注入是否落 durable session event（持久写用户 session log→注入量约束）；是否进入下一个 admitted request。
3. `ctx.systemPrompt` section 注册 API 形状（记忆注入的一等面）。
4. headless profile 激活路径：`dsh --profile headless` 一次性 runner 怎么喂 prompt、事件是否全发、启动税实测。
5. pnpm-profile 安装面：`dsh plugin add <path|tgz>` 在 Windows 行为、profile 内 pnpm 版本交互（本机 11.24.0）、pendingBuilds 零触发实证（零依赖包应无审批）。
6. `mcp__anysearch__*` 命名形态实证（桥注册后工具名、64 字符规范化、ans_* 匹配器兼容）。
7. `dsh --dump-config` 免启动实读插件树/层序。
8. **【BLOCKING】**bundle patch 配 mcp-client 行可行性：我们的 `dsh.bundle` patch 声明 `dsh-mcp-client` 行（serverName anysearch→ans-mcp stdio）是否生效=一步装存亡。
9. patch 整行替换语义：我方 patch 替换 mcp-client 行是否清掉 dsh 自带默认 keys（`--dump-config` 前后对比）。

**验收锚**：报告实物+transcript 存档 `.scratch/grill-round-72/evidence/`；go/no-go 明文。

**Suggested skills**：$diagnosing-bugs（契约探测的未知面）、$research（dsh 文档再核对）、domain-modeling（RESHAPE 项的词汇定型）。

---

## T1 — 双件落地｜覆盖 D-001/D-002/D-003

**Phase-2 go 时**：
- `apps/dsh-plugin` 新包（`@anysearch-cli/dsh-plugin`，**private:true**，零运行时 deps）：
  - `package.json`：`dsh.bundle`→`./cordis.patch.yml`（patch 内含 mcp-client 行 `serverName: anysearch`→`ans-mcp` stdio，**整行复述全部所需 keys**）；`files`/`type:module`/`name` 过预发布 lint；keywords 含 `dsh-plugin`。
  - cordis 入口：`export const inject`+`apply(ctx)`——四件事：`agent/created`+`agent.inject()`/systemPrompt section（记忆注入，做小节流——注入落持久日志）、`tools/pre-execute`（preheat fire-and-forget+URL-policy deny，spike 第 1 项定 waterfall/guard）、`tools/post-execute`+`tools/result`（蒸馏/索引）；全部经 `fetch(127.0.0.1:33333)` IPC，fail-open。
  - cordis/dsh 类型**仅 devDeps**（编译期 churn 报警器）；adapter 复用现有 IPC fetch 面（参考 `apps/plugin/src/hooks/core.ts`）。
  - 单测：mock ctx 断言四事件挂载+IPC 调用面+fail-open——**本票出口=单测绿+Phase-1 配置行写好**；集成绿归 T2。
- Phase-1 基线：cordis.patch.yml MCP 桥行写入 `docs/deepseek-harness-integration.md` 草案（一步装说明+用户覆盖方向+升级 diff 指引）。

**spike 红时**：本票降档=Phase-1 文档行+fallback 附录（散件挂法）+限制记档+**具名重返票**（什么改变重启 Phase-2）——不阻塞 T2。

**验收锚**：包 diff+单测绿 transcript+集成文档草案。

**Suggested skills**：$implement+$tdd（mock ctx 先红后绿）、domain-modeling（新包词汇对齐 CONTEXT R72 词块）。

---

## T2 — 真宿主验证｜覆盖 D-001/D-002/D-003/D-004(iii)

**探针矩阵三桶**（票文必须写明分类）：
- **宿主不变量**：5 工具可见+可调（search/recall/ans_chat/research/knowledge）、server down fail-open、with/without-bundle 对照。
- **宿主变量**（同声明新机制）：inject 注入 transcript 实证、preheat 标记、URL deny 端到端、distill 索引落 store、启动税实测。
- **宿主新增**：`dsh plugin add`→verify 行在→`remove`→行不在→re-add 幂等；patch 层组合正确性；HMR reload（我们的行走 live reload 还是 startup-only=未决事实须验）。

**另含**：tarball 安装验证（`pnpm pack`→`dsh plugin add <tgz>`→`--dump-config` 层核对+预发布 lint）·web profile **具名两探针**（inject 注入 transcript+preheat 标记，余标 untested）·doctor/install-smoke 腿（`dsh found@版本/行已挂/MCP 可达`，fail-open）·churn lint 控件（`@deepseek-ai/*` import 泄入新包 runtime 非 devDep 路径即 fail，先红后绿证据对）·升级 diff 演练记录（钉 0.1.5-rc.2+rc bump 重验清单）·verified-hosts 第 6 行（`README.md`：版本/日期/scope/status）·`docs/deepseek-harness-integration.md` 定稿·新包入 ship-gate/构建/测试清单+`scripts/ship-gate-pathlint.config.json` 扫面登记（round-72 目）。

**验收锚**：全量 transcript 存 `.scratch/grill-round-72/evidence/`；verified-hosts 行 diff；churn lint 红绿对。

**Suggested skills**：$implement、$diagnosing-bugs（探针红因）、$code-review（adapter 复审）、neat-freak（证据归位）。

---

## T3 — 文书+收口｜覆盖 D-004

- `docs/adr/0073-architecture-grill-round-72-deepseek-harness-host-contract.md`：两阶段 C 裁定+三桶分类法+churn 容器机制（devDep 类型耦合+lint 控件+升级 diff 演练）+5 工具原生注册演进条件+（若红）具名重返票引用+adr index regen。
- `CONTEXT.md` R72 词块已入库（8 条：Two-Phase Host Integration/Thin In-Process Adapter/Blocking Spike Item/Probe Three-Bucket Taxonomy/Compile-Time Churn Alarm/Whole-Row Patch Replacement/Publish-Shape Verification/Named Re-Entry Ticket）——实施新增词随票补。
- `CHANGELOG.md`+found/fixed/deferred 三元组逐条闭环。
- 收口文档自身过 path-lint（repo-relative 库内引用）；goal 收口态+round-72-closeout.md（模板沿用 R71）。
- `but` commit 后工作区干净。

**验收锚**：D-004 四段逐条机器可复验。

**Suggested skills**：$handoff（收口模板）、neat-freak（事实面六态收尾）、domain-modeling（ADR/词表）。

---

## 红线

- 业务逻辑不进 dsh 进程（薄 adapter 只做事件挂载+IPC fetch；密钥/DB/检索重逻辑一律进程外）。
- `@deepseek-ai/*` 类型仅 devDeps——泄入 runtime 即 churn lint fail。
- spike 未跑完不准开 T1；#8 blocking 项 FAIL=Phase-2 自动降档，不许硬闯。
- 不在本票做 5 工具原生 ctx.tools 注册、不发 npm、不做 web 全矩阵。
- verified-hosts 行不许写「live-verified」没有 transcript 实证的内容；web 腿余面如实标 untested。
- 文档库内引用一律 repo-relative（本票所有产出过 step 1i path-lint）。

## 显式范围外（handoff 承接，勿拉动）

- 5 工具原生注册 backlog（ADR 演进条件）；dsh-plugin npm 发布（release 道）；web 全矩阵。
- R71 遗留：ship-gate 1g 缺口（defer-r71-shipgate-1g-coverage，已连续两轮 deferred）/macos-spillover-probe 红因/transformers 上游 undeclared-dep 跟进（撤 scoped patch 挂起条件）/F3 inRepo() 机器相对 ADR 注记/r71-audit 栈（vxs+yut+tkv）合 main 决策。
