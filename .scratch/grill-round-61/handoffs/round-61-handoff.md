# Round-61 → next-round 交接

## 已完成（栈：grill-61-docs → t1 d6ecece → t2 6e2ac93 → t3 d2c809e → t4 8344941 → t5 f1f002c）

- 双闸域过滤：能力协商 pre-filter（includeDomains/domainFilterSupported）+ kernel 权威 post-filter（shouldAllowUrl 语义，deny 优先，子域匹配，请求时 policy 解析不缓存）。
- 第一类 abstain：metadata.abstain {reason,domain,preFiltered,postFiltered,gate}；CLI 单行 + exit 0（--fail-on-abstain→3）+ --json 字段；MCP structuredContent.abstain + isError:false；双审计事件 retrieval.domain_filter.pre/post + anysearch.outcome 独立维度。
- Golden 判据 1-4 入账 eval-looks（g0012-g0014），coverage manifest 重计数，ship-gate 1n 块接线。
- README 用户向重写（实测命令、诚实限制、能力矩阵），ADR 索引保留。
- ship-gate 9/9 全绿（turbo check/test/build + pack + install verify + MCP initialize + fail-open）。

## 下一轮候选

1. **判据5 回填**：TAVILY_API_KEY 到位后跑 `TAVILY_API_KEY=tvly-... node scripts/probe-tavily-domains.mjs`（D 臂 `PROBE_TAVILY_RESEARCH=1`）→ 更新 `tavily-probe-ledger.md` + capability 表。
2. **npm 0.0.1 发布评估**：abstain 缺口已闭合（D-001 前置条件达成）；发布与否显式裁决，发布前建议先跑判据5。
3. **golden 离线执行器 F4**（ADR-0061 deferred）：eval-looks 条目已有结构化 verdict/判据锚，可在此基础上接执行臂。
4. Windows 进程退出尾部 libuv `UV_HANDLE_CLOSING` 断言噪声（pre-existing，exit code 不受影响）——可作小票。

## 工作约束沿用

GitButler 每票一分支、中文带票号、不 push/PR 除非明令；.scratch 快照先行；报告证据可复跑。

