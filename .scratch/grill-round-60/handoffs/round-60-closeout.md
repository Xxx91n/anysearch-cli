# Round-60 收口交接 → Round-61 起票面

## 本轮状态：六票全交付（fixer 实现，非文档化）

栈：grill-60-docs → t1(xzr) → t2(lqu) → t3(mpt) → t4(wym) → t5(otx,msv) → t6(rpq) → closeout。
报告：reports/2026-09-14-report.md（逐票 + 可复跑命令）。

## 各票一句话

- T1/B1：docs 域 walking skeleton——domains/docs.toml + golden 11 条（全 provenance，零合成）+ coverage manifest（7 covered / adversarial deferred 挂 B4 触发）+ 域解析链 + config.env 持久化 rehydrate + doctor[5] + 包内随发行 TOML。
- T2/B2：scripts/install-smoke.mjs + CI lane——pack→干净装→doctor→domain→search；online allowlist 硬断言 / offline 文档化断言；macOS limitation 已记录。
- T3/B4：eval-badcases.json + badcase-backfill.mjs（attach/create 双模式 + 禁合成护栏）；种子 bc0001（tokio 域外不 abstain）已 attach docs-g0007；回归段进 CI 测试。
- T4/B3：doctor 自服务——ANS_DOMAINS_DIR 可见化 + DB 可写探测 + enabled-provider key 覆盖（SKIP+修复指引）+ 域缺失点名修复 + 失败摘要走 stderr。
- T5/C1：0.0.1 版本线（7 包+根）+ gitignore-drift 修复 + ship-gate 9 步对真实 pack 全绿。
- T6/G1：remove-or-implement → implement。grace 早停真接线（pool≥maxResults→straggler grace 后 abort；deepMode 恒等）；哨兵翻正。

## 下一轮入口

1. docs-bc0001 留下的产品缺口：docs 域对域外提问无 abstain 纪律（engine 返回非 allowlist 结果而非拒答）——是真实质量缺口，可作为 R61 候选票。
2. coverage manifest adversarial 维 deferred 触发条件：B4 回灌见到首个注入型 badcase 时入圈。
3. macOS CI lane：真实 macOS 问题报告时加矩阵项。
4. 若再 bump 版本：注意 ship-gate step1a 信息串「pin to 0.0.1」为提示文案非硬断言。

## 已知边界

- tavily provider 不转发 AbortSignal（SDK 限制，账本已载）——grace abort 对它无效但 cancelled 上报仍真。
- eval-looks.json 双职责：OF look 账本 + golden 顶层集，appendLook/压实已保透传。
