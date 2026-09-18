# R71 Goal

状态：**已落地收口**（2026-09-19）。0.0.6 真发布经双层门完成：pre-tag#2 GREEN run 35386495456（look 5 入账 `6c289397`）→ post-tag assert+publish GREEN run 35387286412 → npm registry `0.0.6 ×4` 实证。首个真客暴露并修复 release-gate GITHUB_TOKEN cascade 结构性断点（自 dispatch temp ref）。收口件：ADR-0072 + closeout handoff + 四段证据。

## 主题

「上架首航」（D-001）：门禁地基+embedding 产品增量+0.0.6 真发布。

## 裁决摘要（详见 decision-ledger.md）

- D-001 主题：T0 地基（timeout bump+路径 lint+教义精化）/T1 embedding spike-gated/T2 0.0.6 发布/T3 文书收口
- D-002 路径类修法：用途三分教义+fail-closed lint 腿+声明标记治理+历史机械扫+Temp 入库+先扫后启
- D-003 embedding 范围：双臂 spike 四断言+EBADDEVENGINES 剥离即修+落地择一+不阻塞发布
- D-004 收口：四段机器可复验（地基/产品/发布/文书，收口文档 dogfood 新教义）

## 显式范围外

1g 覆盖缺口 / macos-spillover-probe 三连红 / provider 服务端排查 / deferred 大项池（cursor/F-01a/npm provider/projectIndex/TUI/cross-OS/plugin/watch）。
