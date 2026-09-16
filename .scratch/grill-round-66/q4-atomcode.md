# atomcode 调研存档（ctx_batch_execute 输出原文，含索引节重排）

研究问题=Q4 探针矩阵跨宿主移植口径

---

Executed 1 commands (117 lines, 16.4KB). Indexed 9 sections. Searched 5 queries.

## Commands

- atomcode-q4-probe-matrix-port: `atomcode -p "调研任务：跨宿主移植验证探针矩阵的工业界方法论。背景：产品是一个 npm 分发的三件套 agent 工具（CLI + MCP stdio server 5 工具 + hooks 层 PreToolUse/PostToolUse/SessionStart 适配器 + 本地 HTTP server）。上一轮在宿主 CodeBuddy 上用 headless 探针矩阵 P1-P9 完成真宿主验证：P1 MCP tools/list、P2 域内检索、P3 域外拒答、P4 LLM chat 走通、P5 记忆写入召回往返、P6 hooks 三事件注入实证、P7 server 断连 fail-open、P8 多轮 research 加已知 stub 实录、P9 同题有无工具效果对照。现在要移植到第二个真宿主 Claude Code（headless print 加 stream-json 已实测可用，模型走本地代理）。已知两宿主协议差：Claude 需 verbose 才出 stream-json、hooks 输出信封契约差异、模板 schema 差异。问题：1）工业界把一…`

## Indexed Sections

- atomcode-q4-probe-matrix-port (1.4KB)
- 跨宿主移植验证探针矩阵的方法论调研报告 (0.6KB)
- 跨宿主移植验证探针矩阵的方法论调研报告 > 1) 执行摘要（Tl;dr） (1.1KB)
- 跨宿主移植验证探针矩阵的方法论调研报告 > 2) 对比矩阵：四大参考体系如何处理「移植到新宿主/新实现」 (2.5KB)
- 跨宿主移植验证探针矩阵的方法论调研报告 > 3) 分点结论 (1) (3.7KB)
- 跨宿主移植验证探针矩阵的方法论调研报告 > 3) 分点结论 (2) (2.6KB)
- 跨宿主移植验证探针矩阵的方法论调研报告 > 4) 推荐（回答问题 5） (1.2KB)
- 跨宿主移植验证探针矩阵的方法论调研报告 > 5) 完整来源清单 (2.4KB)
- 跨宿主移植验证探针矩阵的方法论调研报告 > 6) 信息缺口 (0.8KB)

## conformance

### 跨宿主移植验证探针矩阵的方法论调研报告 > 2) 对比矩阵：四大参考体系如何处理「移植到新宿主/新实现」
## 2) 对比矩阵：四大参考体系如何处理「移植到新宿主/新实现」

| 参考体系 | 移植时跑什么 | 宿主变量怎么处理 | known-bug 机制 | 出处 |
|---|---|---|---|---|
| MCP conformance（SEP-2484 + tiering） | **全量**，且分 spec 版本各自全跑（"67/67 spans every revision, each at its own wire version"） | extension / added-after-release → **not scored**：照跑、报告、但不计入 tier；exclusion 必须文档化 | not-scored ≠ not-measured：跑不了 = 调用坏了，不算 SDK 的锅 | modelcontextprotocol.io/seps/2484；github.com/modelcontextprotocol/conformance |
| Pact 契约测试 | 全量 verify，结果上 broker | 新契约→pending（验证但不 fail build）；未集成契约→WIP（不挡门） | build 只在「破坏了之前承诺过的契约」时才红 | docs.pact.io/pending_pacts |
| pytest xfail 惯例 | 全量 | 条件化 xfail（`xfail(sys.platform=="win32", reason=...)`）| strict xfail：XPASS = 失败，逼你摘掉标记，修复自带回归测试 | docs.pytest.org；blog.ganssle.io |
| SQL/NIST 符合性 + LSP 生态 | 全语料跑，按 conformance level / feature 支持度报告 | 不支持特性记「未实现」而非删除条目 | NIST 套件按 Entry/Transitional/Intermediate/Full 分级计分 | nvlpubs.nist.gov（NISTIR 5998） |

**共性法则（四源交叉一致）**：① 测试集是**规范的可执行断言**，跨宿主移植时全集照跑；② 宿主/实现差异用**声明式状态标注**（not-scored / pending / xfail / skip-with-reason），不用物理删除；③ 每个非通过状态必须引用一条编号化的理由（MCP 叫 divergence ledger，Omnist conformance runner 移植指南强制 skip reason 引用编号条目）。

**「照跑 vs 只跑变量」的取舍依据**（回答问题 1）：裁剪的正当理由只有两个——(a) 测试依赖宿主**不存在**的表面（如 plugin 骨架在无 plugin 系统的宿主上物理不可跑）→ skip-with-reason；(b) 测试成本与宿主风险不成比例且该风险已被其它探针覆盖。除此之外全跑：一是 conformance 语义下「省掉的测试=失去发现规范分歧的机会」（SEP-2484 明说 conformance test 的价值在于"when they reveal that two compliant SDKs disagree, the disagreement surfaces an ambiguity in the spec itself"）；二是 P2/P5/P9 这类宿主变量探针**恰恰是移植验证的主要信息增益**——你已经知道不变量会过，跑它们是为了确认变量项差异在可接受范围。

### 跨宿主移植验证探针矩阵的方法论调研报告 > 5) 完整来源清单
## 5) 完整来源清单

| # | 标题 | URL | 角度 | 日期 | 贡献 |
|---|---|---|---|---|---|
| 1 | SEP-2484: Require Conformance Tests for Standards Track SEPs | https://modelcontextprotocol.io/seps/2484-conformance-tests-required-for-final-seps | Official | 2026-03-27 | conformance 全量语义、traceability file、documented exclusion、not-scored 语义 |
| 2 | modelcontextprotocol/conformance 仓库 README | https://github.com/modelcontextprotocol/conformance | Official | 2026（活跃） | required/not-scored/not-measured 三态 + exit code 规则 + 每 spec 版本独立全跑 |
| 3 | MCPJam Cross-client testing | https://www.mcpjam.com/features/cross-client-testing | Comparative/Community | 2026 | per-host eval 判决是商业化惯例的直接证据 |
| 4 | How and why I use pytest's xfail（pganssle） | https://blog.ganssle.io/articles/2021/11/pytest-xfail.html | Official/Criticism | 2021-11 | skip vs xfail 分界教义、strict xfail 哨兵机制 |
| 5 | pytest skipping 文档 | https://docs.pytest.org/en/stable/how-to/skipping.html | Official | 持续 | 条件化 xfail（按平台/宿主）官方范式 |
| 6 | How to Test MCP Servers: A Complete Guide（Signadot） | https://www.signadot.com/testing-mcp-servers/ | Official/Comparative | 2026-08-31 | 四层模型；字节级协议一致≠agent 结果一致 |
| 7 | Pending pacts | https://docs.pact.io/pact_broker/advanced_topics/pending_pacts | Official | 2023-07 | 契约豁免的 build 门禁语义（只在破坏已承诺契约时红） |
| 8 | MCP transports 规范 2025-06-18（知识库索引） | https://modelcontextprotocol.io/specification/2025-06-18/basic/transports | Official | 2025-06 | stdio/streamable HTTP 语义跨宿主统一的规范依据 |
| 9 | Claude Code hooks/plugin 调研（知识库 batch:atomcode-q3） | code.claude.com/docs/en/hooks, plugins-reference + issue #16116 | Official/Criticism | 2026-09 | P6 信封契约差异、Windows 变量替换 bug 链 |
| 10 | 协议转换中间件验证方法对比矩阵（知识库 batch:atomcode-Q2） | 内部调研 | 综合 | 2026-09-05 | 一致性语料库/差分/快照方法成本与失败模式全景 |
| 11 | quarantine 台账裁决（知识库 grill-round-64） | 内部调研 | 综合 | 2026-09-16 | 「隔离是临时队列非坟场」工业共识 |
| 12 | Trustworthy benchmarks（Berkeley RDI） | https://rdi.berkeley.edu/blog/trustworthy-benchmarks-cont | Criticism | 2026 | null-agent 基线检验 P9 类对照有效性 |

### 跨宿主移植验证探针矩阵的方法论调研报告 > 6) 信息缺口
## 6) 信息缺口

- LSP 生态的 conformance 现状靠知识库旧调研支撑，本轮未直接核验 LSP 测试套件原文（tvsauce/treesitter 类项目对 per-server 条件化处理的具体实践未读到一手文档）。
- SQL/NIST 套件只有 1996 年文档摘要级证据（NISTIR 5998 存在、四级 conformance 分级确认），现代实现如 MySQL/PG 如何 report 未实现 feature 未深挖。
- P9「有无工具对照」的**学术**消融规范（重复次数、显著性标准）只拿到 benchmark 实践侧证据，未见专门方法学论文；若要正式化 P9 结论建议后续查 agent eval 统计功效文献。
[warning] 正在以管理员权限运行 — 模型可能可以访问系统文件。

继续此会话，运行：atomcode -p "…" --resume ade56d55-9de7-41c3-a3da-88a6b15699de

## 契约测试

### 跨宿主移植验证探针矩阵的方法论调研报告 > 2) 对比矩阵：四大参考体系如何处理「移植到新宿主/新实现」
## 2) 对比矩阵：四大参考体系如何处理「移植到新宿主/新实现」

| 参考体系 | 移植时跑什么 | 宿主变量怎么处理 | known-bug 机制 | 出处 |
|---|---|---|---|---|
| MCP conformance（SEP-2484 + tiering） | **全量**，且分 spec 版本各自全跑（"67/67 spans every revision, each at its own wire version"） | extension / added-after-release → **not scored**：照跑、报告、但不计入 tier；exclusion 必须文档化 | not-scored ≠ not-measured：跑不了 = 调用坏了，不算 SDK 的锅 | modelcontextprotocol.io/seps/2484；github.com/modelcontextprotocol/conformance |
| Pact 契约测试 | 全量 verify，结果上 broker | 新契约→pending（验证但不 fail build）；未集成契约→WIP（不挡门） | build 只在「破坏了之前承诺过的契约」时才红 | docs.pact.io/pending_pacts |
| pytest xfail 惯例 | 全量 | 条件化 xfail（`xfail(sys.platform=="win32", reason=...)`）| strict xfail：XPASS = 失败，逼你摘掉标记，修复自带回归测试 | docs.pytest.org；blog.ganssle.io |
| SQL/NIST 符合性 + LSP 生态 | 全语料跑，按 conformance level / feature 支持度报告 | 不支持特性记「未实现」而非删除条目 | NIST 套件按 Entry/Transitional/Intermediate/Full 分级计分 | nvlpubs.nist.gov（NISTIR 5998） |

**共性法则（四源交叉一致）**：① 测试集是**规范的可执行断言**，跨宿主移植时全集照跑；② 宿主/实现差异用**声明式状态标注**（not-scored / pending / xfail / skip-with-reason），不用物理删除；③ 每个非通过状态必须引用一条编号化的理由（MCP 叫 divergence ledger，Omnist conformance runner 移植指南强制 skip reason 引用编号条目）。

**「照跑 vs 只跑变量」的取舍依据**（回答问题 1）：裁剪的正当理由只有两个——(a) 测试依赖宿主**不存在**的表面（如 plugin 骨架在无 plugin 系统的宿主上物理不可跑）→ skip-with-reason；(b) 测试成本与宿主风险不成比例且该风险已被其它探针覆盖。除此之外全跑：一是 conformance 语义下「省掉的测试=失去发现规范分歧的机会」（SEP-2484 明说 conformance test 的价值在于"when they reveal that two compliant SDKs disagree, the disagreement surfaces an ambiguity in the spec itself"）；二是 P2/P5/P9 这类宿主变量探针**恰恰是移植验证的主要信息增益**——你已经知道不变量会过，跑它们是为了确认变量项差异在可接受范围。

### atomcode-q4-probe-matrix-port
# atomcode-q4-probe-matrix-port

$ atomcode -p "调研任务：跨宿主移植验证探针矩阵的工业界方法论。背景：产品是一个 npm 分发的三件套 agent 工具（CLI + MCP stdio server 5 工具 + hooks 层 PreToolUse/PostToolUse/SessionStart 适配器 + 本地 HTTP server）。上一轮在宿主 CodeBuddy 上用 headless 探针矩阵 P1-P9 完成真宿主验证：P1 MCP tools/list、P2 域内检索、P3 域外拒答、P4 LLM chat 走通、P5 记忆写入召回往返、P6 hooks 三事件注入实证、P7 server 断连 fail-open、P8 多轮 research 加已知 stub 实录、P9 同题有无工具效果对照。现在要移植到第二个真宿主 Claude Code（headless print 加 stream-json 已实测可用，模型走本地代理）。已知两宿主协议差：Claude 需 verbose 才出 stream-json、hooks 输出信封契约差异、模板 schema 差异。问题：1）工业界把一…

我先召回知识库，再启动三引擎多角度检索。知识库命中大量前序调研。先深挖知识库相关板块，再决定联网补强范围。知识库已命中大量前序调研（协议一致性方法论对比矩阵、hooks schema、quarantine 台账教义）。现在联网补强三大缺口：一致性套件移植方法论、expected-failure 分类学、工具有无对照评测惯例。继续补两个角度：A/B 消融评测惯例、契约测试的 known-issue 分级（Pact pending/WIP 机制）。配额已达成，综合输出。

## expected failure

### 跨宿主移植验证探针矩阵的方法论调研报告 > 3) 分点结论 (1)
## 3) 分点结论

**3.1 九条探针的不变量/变量分类（回答问题 2）**【依据：MCP spec transports 规范 + Signadot 四层模型 + Claude Code hooks 官方文档，High】

| 探针 | 分类 | 依据 |
|---|---|---|
| P1 tools/list | **不变量** | MCP JSON-RPC 语义跨宿主统一，stdio transport 由协议规定 |
| P3 域外拒答 | **不变量** | 你自己的产品承诺（拒答策略），不依赖宿主 |
| P4 LLM chat 走通 | **不变量**（弱） | 走通与否取决于你的本地代理配置，宿主只是通道；但失败模式（超时/重试）是宿主相关的，判据应写成「端到端成功」而非「字节一致」 |
| P6 hooks 三事件注入 | **不变量 + 变量双层** | 事件语义是承诺（三事件必须发生、注入必须生效）；但**输出信封契约、command schema、Windows 路径展开是宿主变量**——知识库已实证 Claude 的 `${CLAUDE_PLUGIN_ROOT}` 在 Windows 反斜杠展开 bug（issue #16116）。assert 分层：语义层照跑，信封层按宿主参数化 |
| P7 断连 fail-open | **不变量** | 这是你的降级行为承诺，宿主断 MCP 连接后你的行为应一致 |
| P2 域内检索 | **变量** | 检索面暴露方式、上下文预算因宿主而异；照跑，但预期值应按宿主重定基线，不做跨宿主等值断言 |
| P5 记忆写入召回 | **变量** | 依赖 hooks 注入路径与 SessionStart 语义差异，跨宿主结果可能合理地不同；照跑 + 记录差异 |
| P8 多轮 research 实录 | **变量** | 依赖宿主 harness 的多轮编排行为；照跑作为实录性证据，不断言跨宿主一致 |
| P9 有无工具对照 | **变量（评测类）** | 见 3.2 |

**裁剪是否成立：不成立。** 按上述框架，真正的裁剪对象应该是「零信息增益」的测试，即宿主变量为空且已被不变量覆盖的冗余——你的九条里没有这种（每条要么测不变量要么测有真实差异的变量）。正确动作是把每条探针拆成 **不变量子断言**（跨宿主必须全绿，任何红 = 移植缺陷）与 **变量子断言**（照跑、记录、按宿主建立独立基线），而不是删除整条。

**3.2 效果对照（P9）跨宿主重跑：惯例，且是关键项**（回答问题 3）【High，双引擎+双信源】
- MCPJam 的 cross-client testing 产品页明确把「同 server、同 cases、在 Claude/ChatGPT/Cursor/Copilot/Codex 各宿主下跑真实模型 eval、给 per-host 判决（p50 延迟、token、通过率）」作为核心能力——即「效果对照跨宿主重跑」已是商业化的行业惯例。
- Signadot 的 MCP 测试指南第四层（agent evals）同样强调：两个协议字节级一致的 server 在不同宿主下 agent 结果可以截然不同，"Two servers can be byte-for-byte protocol-compliant and still produce wildly different agent outcomes"——宿主 harness 是效果的一等变量，不重跑等于假设它在两个宿主等价。
- 方法学上这属于 **A/B 消融（ablation）+ 宿主作为 treatment 变量**：评测文献（Berkeley CAR-bench 的 "null agent" 检验）也支持跑一个无工具基线来验证评测本身有效。注意两点防坑：(a) 同题双跑在无工具端测的是模型裸能力，受宿主 system prompt 影响大，结论应表述为「该宿主下工具有效性增量」，不做跨宿主绝对值比较；(b) 一次双跑是抽样不是断言，多次重复或至少记录方差，避免 P9 结论被单次噪声污染。

**3.3 expected-failure 分类学（回答问题 4 前半）**【High，pytest 官方 + Pact 文档 + 知识库台账先例三源一致】

推荐用四态分类账（每条引用编号 issue + failure_class 注记）：

### atomcode-q4-probe-matrix-port
# atomcode-q4-probe-matrix-port

$ atomcode -p "调研任务：跨宿主移植验证探针矩阵的工业界方法论。背景：产品是一个 npm 分发的三件套 agent 工具（CLI + MCP stdio server 5 工具 + hooks 层 PreToolUse/PostToolUse/SessionStart 适配器 + 本地 HTTP server）。上一轮在宿主 CodeBuddy 上用 headless 探针矩阵 P1-P9 完成真宿主验证：P1 MCP tools/list、P2 域内检索、P3 域外拒答、P4 LLM chat 走通、P5 记忆写入召回往返、P6 hooks 三事件注入实证、P7 server 断连 fail-open、P8 多轮 research 加已知 stub 实录、P9 同题有无工具效果对照。现在要移植到第二个真宿主 Claude Code（headless print 加 stream-json 已实测可用，模型走本地代理）。已知两宿主协议差：Claude 需 verbose 才出 stream-json、hooks 输出信封契约差异、模板 schema 差异。问题：1）工业界把一…

我先召回知识库，再启动三引擎多角度检索。知识库命中大量前序调研。先深挖知识库相关板块，再决定联网补强范围。知识库已命中大量前序调研（协议一致性方法论对比矩阵、hooks schema、quarantine 台账教义）。现在联网补强三大缺口：一致性套件移植方法论、expected-failure 分类学、工具有无对照评测惯例。继续补两个角度：A/B 消融评测惯例、契约测试的 known-issue 分级（Pact pending/WIP 机制）。配额已达成，综合输出。

### 跨宿主移植验证探针矩阵的方法论调研报告 > 4) 推荐（回答问题 5）
## 4) 推荐（回答问题 5）

**全移植 + 增补，反对裁剪。** 理由：

1. **九条没有可安全删除项**：不变量（P1/P3/P4/P6/P7）是移植正确性的门禁；变量（P2/P5/P8/P9）是移植的主要信息增益。裁剪宿主变量探针等于把「确认差异可接受」换成「假设差异不存在」——这正是 SEP-2484 批评 reference-implementation-only 的同一个错误。
2. **成本论证不成立**：headless 探针矩阵的边际成本低（知识库对比矩阵：一致性语料库类方法「单用例边际成本低」），而漏测跨宿主语义分歧（尤其 hooks 信封、SessionStart 差异）的代价高。
3. **全量跑自动产出跨宿主差异台账**，这是第三个宿主（以及后续每个宿主）的移植成本递减资产——Omnist 三个移植端口的经验（"a fourth doesn't have to rediscover it from scratch"）是直接先例。
4. **增补三项宿主专属探针进同一矩阵**，用 tag 分层管理门禁语义（core 必绿 / host-variable 记录 / host-specific 条件化 / experimental 不挡门），配四态 xfail/skip 分类账（每条编号 reason + failure_class），并在宿主修复已知 bug 后由 strict xfail 的 XPASS 自动触发摘标记转正。

## 推荐

### 跨宿主移植验证探针矩阵的方法论调研报告 > 4) 推荐（回答问题 5）
## 4) 推荐（回答问题 5）

**全移植 + 增补，反对裁剪。** 理由：

1. **九条没有可安全删除项**：不变量（P1/P3/P4/P6/P7）是移植正确性的门禁；变量（P2/P5/P8/P9）是移植的主要信息增益。裁剪宿主变量探针等于把「确认差异可接受」换成「假设差异不存在」——这正是 SEP-2484 批评 reference-implementation-only 的同一个错误。
2. **成本论证不成立**：headless 探针矩阵的边际成本低（知识库对比矩阵：一致性语料库类方法「单用例边际成本低」），而漏测跨宿主语义分歧（尤其 hooks 信封、SessionStart 差异）的代价高。
3. **全量跑自动产出跨宿主差异台账**，这是第三个宿主（以及后续每个宿主）的移植成本递减资产——Omnist 三个移植端口的经验（"a fourth doesn't have to rediscover it from scratch"）是直接先例。
4. **增补三项宿主专属探针进同一矩阵**，用 tag 分层管理门禁语义（core 必绿 / host-variable 记录 / host-specific 条件化 / experimental 不挡门），配四态 xfail/skip 分类账（每条编号 reason + failure_class），并在宿主修复已知 bug 后由 strict xfail 的 XPASS 自动触发摘标记转正。

## 宿主变量

### 跨宿主移植验证探针矩阵的方法论调研报告 > 3) 分点结论 (2)
| 状态 | 语义 | 工业对应 | 处置 |
|---|---|---|---|
| **skip（宿主不支持）** | 被测面在宿主上物理不存在 | pytest conditional skip；MCP "not measured" 照跑失败=调用坏 | skip reason 必须引用编号理由；宿主获得该表面后自动转正 |
| **xfail strict（宿主 known-bug，承诺面内）** | 应该工作但宿主有 bug | pytest `xfail(strict=True, reason="issue#…")`；Omnist divergence ledger | XPASS 视为失败→强制摘标记，修复自动转回归测试；台账是队列不是坟场（知识库 grill-round-64 结论：「quarantine is temporary」，无主流工具提供永久隔离出口） |
| **not-scored / informational（宿主变量，非承诺面）** | 照跑、报告、不计入门禁 | MCP conformance 的 `extension`/`added-after-release`；exit code 只看 required | 失败是信息不是 blocker；定期评审是否升级为承诺面 |
| **known-failing-but-acceptable（契约豁免）** | 上游明确不改 | Pact pending/WIP：build 只在破坏已承诺契约时红 | 必须有书面豁免理由 + 复查期限，否则退化成账本黑洞 |

关键教义（ganssle）：**skip vs xfail 的分界是「这行为该不该工作」**——不该工作的（宿主根本没有该表面）用 skip，该工作但有 bug 的用 strict xfail。把宿主 bug 标成 skip 会丢失「宿主修复后自动报警」的哨兵价值。

**3.4 宿主专属新探针该不该进同一矩阵：该，但分层**（回答问题 4 后半）
- **输出信封对照**：进，且必须进——它正是「不变量+变量双层」的典型：注入语义是不变量（跨宿主断言），信封 schema 是变量（按宿主参数化 fixture）。SEP-2484 的 traceability 思想直接适用：每条 normative 断言一行，差异写 documented exclusion。
- **http 型 hooks 可行性**：进，标 `experimental`/not-scored——Claude Code plugin hooks 支持 `http` 类型（知识库官方文档确认），但它是宿主专属扩展面，失败不挡门，成功则是产品增量证据。
- **plugin 骨架加载验证**：进，标 skip-with-reason 或宿主条件化——仅在支持 plugin 系统的宿主可跑（对应 pytest 的条件 skip 范式）；知识库中 `.claude-plugin/plugin.json` vs Agent Plugins 1.0.0 双 manifest 的调研直接提示这也是跨宿主兼容的已知漂移面，值得单列探针。
- 分层建议：矩阵加一维 tag（`core-invariant` / `host-variable` / `host-specific` / `experimental`），门禁只看第一类，报告全量呈现——这完全复刻 MCP conformance 的 required/not-scored/not-measured 结构。

### 跨宿主移植验证探针矩阵的方法论调研报告 > 1) 执行摘要（Tl;dr）
## 1) 执行摘要（Tl;dr）

工业界的成熟答案是**「全量移植 + 显式记账 + 增补宿主专属」**，而不是裁剪：MCP 官方 conformance 套件（SEP-2484）要求每条 MUST/MUST NOT 都映射到一条可执行检查或**文档化的 exclusion**——裁剪不是删测试，而是把宿主变量测试**保留并显式标注**（skip-with-reason / xfail），这样每次移植都自动产出一份跨宿主差异台账【SEP-2484, High】。九条探针中 P1/P3/P4/P6/P7 是宿主不变量（协议/契约语义），P2/P5/P8/P9 是宿主变量（检索面、注入路径、效果对照依赖宿主 harness 行为），裁剪不成立、降级标注才成立【High】。效果对照（P9）跨宿主重跑**是惯例不是过度**：MCPJam 等商业产品把「同 server 在 Claude/ChatGPT/Cursor/Codex 下的 per-host eval 判决」作为核心卖点，宿主 harness 本身就是被测变量【High】。最终推荐：**全移植 + 增补（宿主专属探针进同一矩阵、独立 tag 分层），差异用 pytest 式 xfail/skip 双轨分类账管理**。

### 跨宿主移植验证探针矩阵的方法论调研报告 > 2) 对比矩阵：四大参考体系如何处理「移植到新宿主/新实现」
## 2) 对比矩阵：四大参考体系如何处理「移植到新宿主/新实现」

| 参考体系 | 移植时跑什么 | 宿主变量怎么处理 | known-bug 机制 | 出处 |
|---|---|---|---|---|
| MCP conformance（SEP-2484 + tiering） | **全量**，且分 spec 版本各自全跑（"67/67 spans every revision, each at its own wire version"） | extension / added-after-release → **not scored**：照跑、报告、但不计入 tier；exclusion 必须文档化 | not-scored ≠ not-measured：跑不了 = 调用坏了，不算 SDK 的锅 | modelcontextprotocol.io/seps/2484；github.com/modelcontextprotocol/conformance |
| Pact 契约测试 | 全量 verify，结果上 broker | 新契约→pending（验证但不 fail build）；未集成契约→WIP（不挡门） | build 只在「破坏了之前承诺过的契约」时才红 | docs.pact.io/pending_pacts |
| pytest xfail 惯例 | 全量 | 条件化 xfail（`xfail(sys.platform=="win32", reason=...)`）| strict xfail：XPASS = 失败，逼你摘掉标记，修复自带回归测试 | docs.pytest.org；blog.ganssle.io |
| SQL/NIST 符合性 + LSP 生态 | 全语料跑，按 conformance level / feature 支持度报告 | 不支持特性记「未实现」而非删除条目 | NIST 套件按 Entry/Transitional/Intermediate/Full 分级计分 | nvlpubs.nist.gov（NISTIR 5998） |

**共性法则（四源交叉一致）**：① 测试集是**规范的可执行断言**，跨宿主移植时全集照跑；② 宿主/实现差异用**声明式状态标注**（not-scored / pending / xfail / skip-with-reason），不用物理删除；③ 每个非通过状态必须引用一条编号化的理由（MCP 叫 divergence ledger，Omnist conformance runner 移植指南强制 skip reason 引用编号条目）。

**「照跑 vs 只跑变量」的取舍依据**（回答问题 1）：裁剪的正当理由只有两个——(a) 测试依赖宿主**不存在**的表面（如 plugin 骨架在无 plugin 系统的宿主上物理不可跑）→ skip-with-reason；(b) 测试成本与宿主风险不成比例且该风险已被其它探针覆盖。除此之外全跑：一是 conformance 语义下「省掉的测试=失去发现规范分歧的机会」（SEP-2484 明说 conformance test 的价值在于"when they reveal that two compliant SDKs disagree, the disagreement surfaces an ambiguity in the spec itself"）；二是 P2/P5/P9 这类宿主变量探针**恰恰是移植验证的主要信息增益**——你已经知道不变量会过，跑它们是为了确认变量项差异在可接受范围。


> **Tip:** Results are scoped to this batch only. To search across all indexed sources, use `ctx_search(queries: [...])` or call ctx_batch_execute with `query_scope: "global"`.

Searchable terms for follow-up: pending_pacts, failure_class, expected-failure, 协议转换中间件验证方法对比矩阵, added-after-release, grill-round-64, traceability, experimental, host-variable, host-specific, sessionstart, cross-client, modelcontextprotocol, skip-with-reason, not-measured, comparative, divergence, transports, 只在破坏已承诺契约时红, documented, fail-open, criticism, community, known-bug, extension, atomcode, headless, research, official, berkeley, required, harness, chatgpt, feature, windows, testing, servers, cursor, nistir, ledger