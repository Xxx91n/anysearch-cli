# R70 Goal

状态：已落地收口（2026-09-18 T3）。grill finalized→四票串行实施完毕→账本落地对账通过。

## 主题

验证层时序语义硬化（D-001）：主线=F-S4 assert-checks-green 严格两段式；次级=store integration 抖动 Spike-Gated 处置。

## 裁决摘要（详见 `D:\Aworker\anysearch-cli\.scratch\grill-round-70\decision-ledger.md`）

- D-001 主题定界：F-S4 主线+jitter 次级；三线+deferred 池显式范围外
- D-002 F-S4 设计：严格两段式+全程锚+phase 错误拆分+ADR-0071 三件必录
- D-003 票序：T0 落地→T1 jitter spike→T2 文书→T3 收口
- D-004 收口：四段机器可复验判据

## 显式范围外

真 release 摘 partial 帽（烧 OF look）/ agy ans-MCP P7 真链（需起 ans server）/ PR-mode required-checks 治理 / deferred 大项池（cursor/F-01a/npm provider/projectIndex/TUI/embedding/cross-OS/plugin/watch）。

## 落地摘要（T3 追加）

- T0 F-S4：assert-checks-green.mjs 严格两段式+头注；ESM 夹具 7 腿先红后绿证据对；真 SHA --once GREEN exit0；land 72495cb3 三 workflow 全绿。
- T1 jitter：spike 复现签名=spawnSync 子进程 CPU 饿死（裸 .mjs 不受 --test-timeout 约束）；处置=4 件测试内层 spawnSync 显式 timeout+ETIMEDOUT 签名；同载转绿；land 3b78b835 全绿。
- T2 文书：ADR-0071 三件必录（stub-registration 不变量/C 升格触发器/167 check-runs 分位数含 ship-gate-win p99=740s>600s 尾部侵蚀呈报）+CONTEXT SpawnSync-Starvation-Bound 词块+CHANGELOG r70 条目+adr index regen 71。
- T3 收口：install-smoke 26/26+ship-gate --quick 57x[pass] 亲测 transcript；found/fixed/deferred 闭环；land 6736aaae。
