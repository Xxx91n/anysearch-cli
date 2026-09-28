# Round 88 收口 — 搜索面卫生轮（search-surface-hygiene）

Stack: r88-hygiene @ r88-grill（GitButler 栈，未 land）→ main @ 5895145d

## 绿色 run URL（本轮祖先线上的实证）

- 基座 tip 5895145d（本轮起点）：ci https://github.com/Xxx91n/anysearch-cli/actions/runs/36378762763 success；ship-gate https://github.com/Xxx91n/anysearch-cli/actions/runs/36378762918 success；native-smoke https://github.com/Xxx91n/anysearch-cli/actions/runs/36378762746 success
- 本轮提交未外发（无 push/publish/tag——纪律内），本地门禁全绿见 reports/2026-09-28-report.md

## 票序终态

| 票 | 结果 | 实证 |
|---|---|---|
| T0 哨戒+基线 | ✅ | baseline-2026-09-28.md：dsh watch（next→0.2.0-rc.1 今日首目击落档）；CI 三跑绿；check/test 绿；ship-gate 仅 freshness 红（预期中态） |
| T1 a08 | ✅ refactor | search-web 删 dead maxResults 解构；kernel 33 asserts 含 maxResults 拒收 |
| T2 a03 | ✅ fix | 位置化旗值消费；e2e 吞词回归先红（query 塌为 q）后绿（21/21） |
| T3 a06 | ✅ refactor | buildVerticalSpec/verticalSpecReject 归 retriever/contract.ts；verticalSpecProps 片段；三站接线；golden 断言归并前后同绿=byte-identical；4 包 tsc 绿 |
| T4 F-6 | ✅ refactor | env 读 POSIX 空串≈未设一致化+sanitize 对称遮（endpoint/key 同形占位）+PROBE_VERSION 钉根包+CHANGELOG r81–r85 旧段归位；探针实测输出行 byte-identical |
| T5 收口件批 | ✅ docs | ADR-0089（reason 枚举+文案映射+判据+熔断/新债条款）+CONTEXT 词块+CHANGELOG r88 段+registry 四票 closed+closeout-claims 12 项+任务书终态戳 |
| T6 门禁+审计 | 见轮报 | reports/2026-09-28-report.md 末节回填为准 |

## 已核验的关键事实

- 三 surface 错误文案 byte-identical：CLI stderr 「ans search: --vertical-sub-domain/--vertical-params require --vertical-domain」；search_web/research_web 各携具名前缀同款文案——golden 断言精确串，非 regex 窗。
- a03 修复面=仅消费位置语义；其余旗路径（requires-a-value / flag-as-value / empty / non-Record / JSON-object 报错序）全部保持——e2e 既有断言零改动通过。
- 探针语义不变：同一 env 端点下新旧版输出行逐字节一致（initialize 阶段 httpStatus 400 本机观测面）；libuv 句柄断言为 Windows/Node24 平台存量噪声，新旧版同现。

## 挂账（下轮/观察项）

- dsh 哨戒移交：next=0.2.0-rc.1（2026-09-28T12:14Z 首落）为候选事实；钉版 rc.1 在役不变，repin 裁决在哨戒域外。
- 垂域方向重议候审：prefer-capable 具名重开条件仍未达，候选不复活（承 R87）。
- 观察项登记（不就地扩票）：探针退出期 libuv 断言为平台存量噪声；provider 探针 ANS_PROBE_QUERY 仍为 ?? 读法（与本探针 POSIX || 存在残余不对称，票据范围外）。

## 下一次 grill 方向（候选，未立项）

1. R88 四票核销后搜索面债务清零——候选转向评测面 / 上游 dsh 0.2.0 线跟踪。
