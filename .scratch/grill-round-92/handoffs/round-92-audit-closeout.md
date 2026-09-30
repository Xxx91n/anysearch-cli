# Round 92 审计收口交接 — Featherless 自定义上游 T2 复跑与售后收口轮（LOOP1–LOOP2 全记录）

**日期**: 2026-09-30 | **编制**: 独立审计窗口（r92-audit lane）
**上游工件**（按路径引用，不重复其内容）：LOOP1 审计 .scratch/grill-round-92/reports/2026-09-30-audit.md；LOOP2 复核 .scratch/grill-round-92/reports/2026-09-30-audit-loop2.md；轮报 .scratch/grill-round-92/reports/2026-09-30-report.md；收口档 .scratch/grill-round-92/handoffs/round-92-closeout.md；任务书（终态已戳）.scratch/grill-round-92/handoffs/next-round.md；账本 .scratch/grill-round-92/decision-ledger.md（D-001~D-003）；ADR-0093（docs/adr/0093-*，票序节已按落笔时值口径修正）；返修提交 qqu（git b0b7304d，r92-grill 链顶）。

## 审计两轮 LOOP 全记录

- **LOOP1**（reports/2026-09-30-audit.md）：六腿硬验收独立复跑全绿（check/test/pack/测活/ship-gate 65×0/凭证三面零命中）；双轴评审（Standards 无硬违规 5 判定项/Spec 合规面+4 发现）；D-001~D-003 逐条核对；呈报 P1~P5+Minor×4+过程违规四项；handoff 扣发待返修。
- **LOOP2**（reports/2026-09-30-audit-loop2.md）：qqu 返修实物核销确认（P1 双锚落笔时值口径+landed 现值/P2 CONTEXT 7 词归属更正/P3 T7 行对齐/P4 探针底账调和/P5 fail-closed 闭环+反例 4/4；Minor×4 核销）；六腿同一套重跑全绿。**审计通过，handoff 解除扣发签发本件。**

## 锚定纪律（下轮必读）

- but-id 为唯一稳定锚：wst/xww/ynl/vwo/kuw/smr（r92 票序）+ osy（LOOP1 审计件，amended）/qqu（返修件）。
- 文内 sha 均为落笔时值；land 后以 main git log 为准。R92 三文书已改口径；**ADR-0092 L162 与 R91 三文书仍带「sha 锚已统一对齐」病句**，列 R93 立法项。

## 关键终态

- 判词维持 F-bug（分支 C）：Featherless 上游 Qwen/Qwen3-32B tool-calling 服务故障（4096 max-tokens + server_error: no_response，无 tool_calls）；机制面 L3a established 经 dump-config 两轮独立复证（r92-smoke profile 在用户级 dsh home）。
- 六腿硬验收两轮全绿；T3/TC 条件票未启不留痕；readme-token-pin 检查器 fail-closed 已闭环（shadow 非阻塞 + MISMATCH 如实打印）。
- 凭证卫生：全链仅变量名/len=67/特许前缀 64a88ea6，零密钥材料。

## 挂账与 R93 主轴建议

1. defer-r92-t2-featherless-upstream-f-bug：上游 tool-calling 异常排查 + 备选模型源评测（Kimi-K2 家族候选；先以裸 preflight 探针验证 upstream 侧 tool_call 真返再入宿主）。
2. defer-r92-readme-token-pin-machine-leg：专属机器腿首跑（P5 fail-closed 已闭环，条件就绪）。
3. npm deprecate 6 版本枚举待用户具备发包权限账号亲触核销（备准命令 .scratch/grill-round-92/evidence/t5-deprecate.md §2）。
4. 垂域死刑复核开庭候选（r88-candidate，已连续多轮排期）。
5. 锚定纪律立法固化：收口模板「sha 已对齐」病句改「落笔时值」口径（ADR-0092 L162 + R91 三文书）。
6. 常驻债词汇归一：goal.md ×5 枚举、CHANGELOG「其余 3 项」与 registry 条目命名对齐。
7. 待用户裁定：CI-only 强制令（2026-09-04）与本机门禁证据效力口径（R92 审计呈报项 1）。

## Suggested skills

- gitbutler（but）：版本控制；but-id 锚定与落笔时值纪律见上。
- grilling / to-spec / implement：R93 主轴标准流程。
- diagnosing-bugs：Featherless 上游异常排查（LOOP2 §5 建议先裸探针归因）。
- code-review：轮末双轴复核；handoff：轮末交接。
- context-mode（ctx_*）：取证与文件读取首选面；atomcode-research：外部模型源调研。

本文件签发于 land 之前；land 后各 sha 以 main git log 为准（but-id 锚不变）。凭证纪律：全文无任何密钥材料，仅含立法特许的 SHA-256 前缀。
