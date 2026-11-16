# #267 验收记录：包装上了，能不能真用

这张票是 #255 那十二张票里的最后一张。它的任务是回答一个问题：**打好的包装到机器上以后，人能不能真的拿它干活。** 结论和证据都在下面。

顺便说清一件事：这页只写这次真跑过的，和真没跑的。没跑的不会被写成"覆盖了"。

**用的包是哪来的。** 下面说的 v0.1.2 包，是 main 上 `51f3aec7` 那次 CI 打出来的。这张票往上只加了一个脚本、一个 CI 步骤和几份文档，没动产品代码。所以下面看到的行为，就是 main 发出去的那份代码的行为。

---

## 一、规格里的十四条决定（D1—D14）

| 决定 | 要的是什么 | 这次拿到的证据 | 结论 |
|---|---|---|---|
| D1 完整 PI 1.5.1 + ESM | 装的 CLI 和 MCP 走真 SDK 入口，版本钉死 | 装好的 `ans 0.1.2` 和装好的 MCP 都能起来、能回话（车道 A、B）。走不了真入口根本起不来。1.5.1 这个号写在三个 `package.json` 和锁文件里，**但没有任何门禁去查它**——ship-gate 只查工作区包是不是 0.1.2。 | 入口验过；1.5.1 这个号只是读到了，没门禁断言 |
| D2 真窗口 + 两种摘要 | 声明多大就用多大；配错了要报错 | 手工试过：`ANS_LLM_CONTEXT_WINDOW=1048000` 出来 `window=1048000`；填 `1e3` 退出码 3，报"必须是正整数"。车道只断言"报了个大于 0 的窗口"，没设 1048000。 | 手工验过，CI 没覆盖 |
| D3 记忆接线 | 内部搜到的东西进库，别的会话能召回 | 车道 E：假模型真调了一次 `search`，库里长出记录，另一个会话用 `query_knowledge` 把其中一条捞回来。另外有 `memory-archive-recall.test.ts`。 | 验过（没搜索 key 时这条会跳） |
| D4 缓存/用量/预算记账 | 主运行、压缩、摘要、整理、重判、额外合并各自记调用和 token；费用四种口径；搜索次数单列 | 车道 B 查主运行的用量和费用来源；车道 D 查整理的用量和调用次数。两边都要求"没价目表的端点不能报成服务端给的价"，并且必须点名缺了哪项。 | **没覆盖**：按活动拆开的那份明细没断言（见下面说明），费用四种口径里只有两种能由假端点触发 |
| D5 显式整理 + 范围 | 没范围就拒绝；memoryIds 就是全部范围；dryRun 不落库 | 车道 D（MCP）和车道 A（CLI 退出码 2），另有 `consolidate-scope.test.ts`、`scoped-consolidate.test.ts`。 | 验过 |
| D6 单证据纠错 + 疑点 | 一条材料只能改已有知识；拒绝时把证据交回来 | 新车道没走这条（它走批量）。覆盖靠 `single-evidence-correction.test.ts` 和真实模型脚本 `correction-a1-a4.online.ts`（A1、A4 通过，A2、A3 拒绝）。 | 有单测，本窗没重跑 |
| D7 关系判断 + 最终内容检查 | 两道检查都跑；不许写死 0.85，不许绕过 | 只有既有测试：`concurrent-correction.test.ts`、`consolidation-correction-seams.test.ts`。新车道没碰这条。 | 本窗没重跑 |
| D8 版本关系、部分事实、可追溯 | 被替代的行关掉、指向前一版；没被改的事实还能搜到 | `single-evidence-correction.test.ts`、`knowledge-fts.test.ts`、`knowledge-ranking-recall.test.ts`。 | 本窗没重跑 |
| D9 摘要来源 + 任务要求 | 摘要记下读过什么；受影响的先停、再按当前资料重建 | `summary-rebuild.test.ts`、`summary-sources.test.ts`、`summary-rebuild-mcp.test.ts`（#264 M1—M4）。 | 本窗没重跑 |
| D10 旧摘要按需补来源 | 需要时才重建；找不到就标不完整，不许编 | `legacy-summary.test.ts`、`summary-rebuild-mcp.test.ts` 里的 A—D 旧格式用例、PR #290。 | 本窗没重跑 |
| D11 并发：最多重判一次、按最新版合并 | 同会话排队、不同会话并行；最多重判一次；不许静默覆盖 | 重判次数和按最新版重合并看 `concurrent-correction.test.ts`（逐个用例断言调用次数）和 `consolidate-race-processes.test.ts`。同会话排队看 `session-lock-recovery.test.ts` 的 C1—C3（#266）——那三条测的是活任务不被抢、被杀后恢复、等待上限，**不是**重判次数。 | 本窗没重跑；真实模型的重试分支仍未覆盖 |
| D12 会话锁、崩溃恢复、空库启动 | 活任务不许被抢；确认进程死了就尽快恢复；新库别随机丢进程 | 车道 C2：两个进程同时开一个全新库，各自都能出五个工具，库里每一层的代表表都在（`sessions`、`messages`、`retrieval_results`、`resume_anchors`、`budget_ledger`、`semantic_memories`、`summary_sources`、`summary_suspensions`、`legacy_summary_states`、`legacy_summary_attempts`、`entities`、`edges`）。另有 `session-lock.test.ts`、`coldstart-locks.test.ts`、`session-lock-recovery.test.ts`。 | 部分——C2 只验了"并发开新库"这一项；会话锁和崩溃恢复没在安装产物上重跑，只有 `session-lock-recovery.test.ts` 的记录 |
| D13 数据结构、发布链、标准检查 | 迁移能重复跑；装出来的东西是真的；标准门禁照原样跑 | 车道 F：旧一点的库能打开、能迁移、原来的行还在、再开一次不报错，装好的 MCP 也能读它。标准门禁不在本机跑，看远端 CI（见第四节）。 | 部分——迁移验过，门禁在远端 |
| D14 论文数据边界 | 不碰 r19 和正式实验数据 | 车道里每个库都建在临时目录、跑完删掉，每次调用都通过 `ANS_DB_PATH`、`USERPROFILE`、`HOME` 指进沙箱——`doctor` 会自己解析并创建库目录，不隔离就会碰到你自己的 `~/.anysearch`。本窗有一次手工探针（验 D2 那次）用了真实 HOME，但 `ANS_DB_PATH` 指到临时目录、搜索源是空的，没读写任何实验库。 | 守住了 |

**D4 为什么没做那项断言。** 规格要的是"主运行、压缩、记忆摘要、整理、重判、额外合并各自记多少"。我试着加，但装出来的产品返回结构里**没有这份明细**——只有主运行和整理两块总数。要在车道里断言一份不存在的字段，等于编一个数据出来。所以我把它标成没覆盖，而不是造一个假的通过。

## 二、规格里的六个测试入口（T1—T6）

| 入口 | 要的是什么 | 这次拿到的 | 结论 |
|---|---|---|---|
| T1 真实 MCP 主入口 | 真 MCP 调 chat 和 consolidate；会话续接；入库和共享召回；范围报错；窗口、缓存、用量；预算；取消；工具白名单；网址检查 | 车道 B/C（对话 + 续接、用量、窗口）、C2（冷启动）、D（范围报错、dry-run、apply、用量）。**这条车道没做**：取消、预算拒绝、工具白名单、网址策略——这些在 `ans-chat-cancellation.test.ts`、`cancellation.test.ts`、`vertical-guard.test.ts`、`content-trust.test.ts` 里。 | 部分（列出来的几项靠单测，没在安装产物上重跑） |
| T2 真实 CLI | 真命令、退出码、范围、dryRun、费用和冲突明细 | 车道 A（装好的 `ans`）、车道 F（装好的 `ans` 读旧库）。冲突明细只在 `consolidate-scope.test.ts` 里。 | 部分 |
| T3 多进程 + 持久状态 | 两个 MCP 进程；同会话串行、不同会话并行；长任务保护；被杀后恢复；冷启动 | 车道 C2 覆盖"同时开新库"。长任务保护和 SIGKILL 后恢复在 #266 里测过（C1—C3），这次没重复。 | 部分 |
| T4 整理接口 + 受控回答 | 能稳定触发版本竞争、B2 冲突、重新合并、合并失败、最终内容不受支持 | `concurrent-correction.test.ts`、`consolidate-race-processes.test.ts`、`scoped-consolidate.test.ts`、`single-evidence-correction.test.ts`。不在这条车道里。 | 单测覆盖 |
| T5 真实模型 + 已确认输入 | 用确认过的样例让真模型判断，记下模型、参数、开销 | `correction-a1-a4.online.ts`（不在默认测试里，要手动跑）。PR #273 记了结果：A1—A4 单次跑通过，不声称准确率；同一个 PR 还记了一次真实波动——第二次跑时 A1 撞上 `merge-empty`。B2 的真实模型重试分支一直没覆盖。这次没重跑。 | 没重跑，沿用旧结果 |
| T6 打包、安装、标准检查、数据兼容 | 五道门禁 + 真的打包→安装→启动→调用；旧数据能读；迁移能重复 | 车道覆盖了打包→安装→启动→调用（对话、续接、冷启动、整理、召回、旧库）。五道门禁在 PR #291 的远端 CI 上全过。**旧数据兼容没证**：那条"旧库"是当前版本建好再把后加的表删掉，只能证明迁移语句能重复跑，证明不了旧版本写出来的文件能正确读。 | 部分——门禁在远端跑过，旧数据兼容没证 |

## 三、票里点名的那几条路，一条一行

放在这里是为了防止一种误读：把"以前有单测"当成"这次在安装产物上验过了"。

| 哪条路 | 这条车道断言了吗 | 在哪覆盖 | 状态 |
|---|---|---|---|
| 检索入库 + 共享召回 | 是 | 车道 E（要搜索 key） | 这次验过 |
| 范围隔离 | 是 | 车道 A（CLI 退出码 2）；车道 D：没范围时报错、回显的范围类型是 `memory`、同一会话里另塞三条范围外的材料在 apply 后仍然有效、只写出一条知识行。把 `memoryIds` 换成 `sessionId` 会立刻报红 | 这次验过 |
| 可靠纠错 + 保住其他有效事实 | 否 | `single-evidence-correction.test.ts`、`knowledge-fts.test.ts` | 没跑，只有单测 |
| 并发按最新版合并 | 否 | `concurrent-correction.test.ts`、`consolidate-race-processes.test.ts` | 没跑，只有单测 |
| 摘要来源 + 任务要求 | 否 | `summary-rebuild.test.ts`、`summary-sources.test.ts`、`summary-rebuild-mcp.test.ts` | 没跑，只有单测 |
| 旧摘要处理 | 否 | `legacy-summary.test.ts`、`summary-rebuild-mcp.test.ts`（A—D） | 没跑，只有单测 |
| 长任务 / 崩溃恢复 | 否 | `session-lock-recovery.test.ts` C1—C3（#266） | 没跑，沿用之前的记录 |
| 取消 / 预算拒绝 / 工具白名单 / 网址策略 | 否 | `ans-chat-cancellation.test.ts`、`cancellation.test.ts`、`vertical-guard.test.ts`、`content-trust.test.ts` | 没跑，只有单测 |
| 费用四种口径 | 部分 | 车道 B 查主运行是 `estimated`；车道 D 查整理是 `unknown`；两边都要求零值只是占位、并且点名缺了哪项 | 四种里验了两种，另两种假端点触发不了 |

## 四、哪些话不成立

- **标准门禁没在本机跑，跑在远端 CI。** 这个窗口的要求是只走远端，所以 `pnpm -r check`、`pnpm -r test`、`pnpm -r build`、离线记忆评测、`ship-gate` 都是 CI 给的结论，不是这台机器。
  门禁列表是一张快照。拿它对着后来的提交读，就会把还在跑的东西写成绿的。所以这份文件写清"读过哪几次提交"，不写"这个 PR 绿了"；任何一次提交的真实状态，看 PR 的 checks 页。
  18 个检查是：`check-build`（两个系统）、`install-smoke`（两个系统）、`ship-gate`（三个系统）、`memory-eval`、`test:online`、`test:online anysearch`（非阻塞）、`coverage`、`native smoke`（四条腿）、`macos-spillover-probe`（非阻塞）、`semgrep`。
  - `38abcdb5`、`224dc364`、`75fb18f9`、`ede9b72b`、`6772393e`、`b705b992`、`217ba781`、`5792f45d`：各自那次跑，18 个全绿。
  - `da02d626`（最后一版）：17 项 CI 全绿；CodeRabbit 那次是 `skipped`（当月额度用完），不是通过也不是失败。
  - `dd600357`：17 绿，`ship-gate (windows-latest)` 第一次是红的（跟本票无关的 `coldstart-race` 超时，下面单独记）。定点重跑才绿。第一次的红留着，没抹。
  新车道自己的结论：两条腿的 `install-smoke` 里都打出「过了 76 项，挂了 0 项，跳了 0 项」。
  本机跑过的只有：`node --check`、`node scripts/check-workflows.mjs`（8 个文件，退出码 0）、`git diff --check`（退出码 0），以及拿 CI 产物跑这条车道。
- **有一次门禁红跟本票无关，重跑才绿。** `dd600357` 上第一次 `ship-gate (windows-latest)` 挂在 `pnpm turbo run test`：`apps/mcp/test/coldstart-race.test.ts` 超时 71.8 秒（`duration_ms 84556`）。那个文件属于 #257（空库同时启动），这次 diff 里只有一个脚本、一个 CI 步骤和三份文档，没碰它。同分支另外四条腿都绿，定点重跑（`gh run rerun --failed`，run 43803814296）回来是 `success`。按"2 路并发 + Windows 慢盘下的时序抖动"记下来，**不**当成"这个测试健康"——超时是真的，没有断言失败，但它再红一次就该去看 #257 的时间预算了。
- **车道的模型是假的。** 它证明传输、请求形状、记忆入库、记账路径。它不证明真实模型的判断力、真实账单、真实缓存命中率。
- **"旧库"是拼出来的。** 当前版本建一个库，再把后加的表删掉。它证明迁移语句能重复跑、行不会丢；它不证明旧版本写出来的每种数据形状都能处理（那部分在 `legacy-summary.test.ts` 和 `summary-rebuild-mcp.test.ts`）。
- **真实模型和多进程的证据没重做。** T5 是 #273 记下的结果；#266 的锁证据是当时的运行记录，不是这次新跑的。

## 五、怎么自己再跑一遍

```text
# 用 CI 打好的产物跑（本地不用编译）
gh run download <run-id> --repo Xxx91n/anysearch-cli -n tarballs-windows-latest
ANS_ACC_TARBALLS=<那个目录> node scripts/installed-acceptance.mjs

# 在 CI 里，作为 install-smoke 的两步
node scripts/installed-acceptance.mjs
node scripts/installed-acceptance.mjs --self-test-parser   # 不需要 key，几秒跑完

# 把沙箱挪到指定目录（比如路径里带 & 的目录），验证脚本自己扛得住
ANS_ACC_TMPDIR='C:\Temp\acc&test' node scripts/installed-acceptance.mjs
```

车道 E（内部搜索入库 → 另一个会话召回）需要 `EXA_API_KEY` 或 `TAVILY_API_KEY`。一个都没有时它会打 SKIPPED，整轮按"部分完成"报，不会装成通过。
