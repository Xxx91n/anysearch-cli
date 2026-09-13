# /goal — Round-60 fixer 轮（防止目标丢失）

**日期:** 2026-09-14
**身份:** 修复子 Agent（fixer）
**目标:** 完整执行 `.scratch/grill-round-60/handoffs/next-round.md` 的 fixer 任务表：T1(B1 docs 域 walking skeleton + golden 首批 + coverage manifest) → T2(B2 装到用链路 CI 实测) → T3(B4 badcase 回灌闭环) → T4(B3 doctor 自服务增强) → T5(C1 release-lines 对真实产物实跑，版本 0.0.1) → T6(G1 graceWindow/deepMode 治理小票)。逐票独立验收，每票一 but 分支、票号中文 commit，覆盖账本 D-001..D-006。
**验收标准（用户原文）:** 编译通过、打包通过、启动并测活软件进程；每个平台都要有 test 闭环，避免只引入却没做到。
**验收总闸（任务书逐票判据）:** T1 五端联动 doctor 可见 + pack→干净装→doctor→search 实跑 + golden 全 provenance + manifest 每维 covered|deferred 带入账触发；T2 离线 golden CI 绿（快照 fixture）+ online URL 硬断言 + A3/A4 复用 + macOS documented limitation；T3 badcase→eval-looks→回归捕获闭环可复现、禁合成；T4 覆盖 T1/T2 实测缺口逐条点名 + exit code/stderr 合 clig.dev；T5 对 B2 真实 pack 实跑非 mock、版本 0.0.1；T6 用 B1-B4 使用证据裁决，允许 documented deferral。
**硬约束:** 新代码行 > 治理行；G1 diff 豁免行数对比（sunset：Round-61 不自动沿用）；golden 只收真实提问禁合成；无真实流量不扩 Golden；账本冲突不改向——标 revised + 新 D-xxx 呈报用户。
**偏好:** atomcode-research 联网调研（工业级成熟轮子优先，不自研）；codegraph cli 探索；Ponytail full 模式（remove-or-implement）。
**版本控制:** WORKFLOW.md §4.2——GitButler 虚拟分支、每票一独立分支、禁裸 git 写命令、不 push 不 PR、commit 中文带票号、哈希以 git log 实物为准；动栈前快照 .scratch（§4.4/§7.5）。
**交付:** 报告 `.scratch/grill-round-60/reports/2026-09-14-report.md`（每条声明附可复跑证据）+ handoff。
**已读:** next-round.md / decision-ledger.md(D-001..D-006) / ADR-0061 / WORKFLOW.md 范本 §4.2/4.3/4.4/5/7 / skills(implement,but,handoff,atomcode-research)。
**已完成:** （待填）
**未解决/待 brain 决策:** 本仓无 WORKFLOW.md 文件——按最新权威范本（photo-snapshots 2026-09-14 重建版）执行；B1 spec 须核对 eval-looks@2 × golden.test.ts schema 兼容（q3/q5 已警示）。
