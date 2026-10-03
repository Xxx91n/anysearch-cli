# Goal — Grill Round 98

- **正题：自造机检声明第五形态立法**——判据「ADR 宣称机器约束 ∧ 实现零消费 → RED」，封闭 enforcement-anchor 注册表 + 行为消费验证为主判定 + 5 锚首发（D-001(a)/D-002/D-003）。
- **前置义务轨：R97 审计返工 R1~R8/R10**——先修后检，先于一切新立法/新实现；修完重跑同一套验收电池，断言数只升不降（D-001(b)）。
- **B 轨：VC 清算逐栈 land**——owner 授权窗内执行（限 D-001(c) 登记序列与窗），实现期开工前完成（D-001(c)）。
- 唯一事实源：`.scratch/grill-round-98/decision-ledger.md`（D-001~D-004 全 current）。
- 单题性守恒：正题名义归第五形态立法；返工轨以「前置义务轨」名义入 goal，非平行正题（ADR-0029 同子系统 cohesive items 合规）。

## 范围外（抄 next-round §范围外，不扩展）

- 不重开评测矩阵修订、不动 r88 formally-declined、不追写已冻结 claims 工件、不做发布/tag。
- 活体谓词 `no-pr`/`unpublished` 仍只走 deferred 扩表示范票不实现；`docs/adr` 权威档不入状态标记靶位。
- 不裸删任何远端指针；通用死代码检测/ADR 文本自动发现/消费方登记契约/monkeypatch/复制源码双源均为已禁项。
- gitbutler 技能文档缺口回写（`but land`/`but absorb`/`but forge review` 未收录）=仓外 user 级文件，轮外 chore，须 owner 单独授权。

## 风险登记（三件）

1. **首次真实 CI run 可能首红**——land 到 main 首次触发 `ci.yml`/`ship-gate.yml` 真实 run（全仓 `on.push` 仅覆盖 `main`），特性分支从未跑过真 CI，首红为已登记风险。
2. **ff-land 后 run-URL 仍只能 PENDING**——ff-land 后 `origin/main..origin/<branch>` 为空 → 栈内 commit 集为空 → run-URL 字段仍只能 PENDING（ADR-0098 Known-Risk 5），GREEN 兑现待 PR 拓扑。
3. **land 绕过 review 检查**——`but land` 直落 target 跳过 PR review；替代保证 = 审计电池（15 条硬声明逐条亲跑复现的既定做法）+ 首次真实 CI run 观测。

no-changelog-entry: r98 簿记件随 T4 落地（CHANGELOG feat/fix/docs 分行=R10 合规自证），pre-land 闸门先于簿记

## T0 执行窗状态（2026-10-04 实测）

- 授权窗：owner 已授权 `but land`/`but push`，限 D-001(c) 登记序列，范围外不扩权。
- land 前置闸门：`node scripts/ship-gate.mjs` 复跑绿后才 land（已由裁量升为必做）。
- 栈态实测：`zz` clean；`origin/main`=`3642d494`；实现主车道栈顶 `r97-audit-reanchor`（vs main 37c，含 r95-rework→r95-exec→r96-handoff-lint→r97-selfcheckable→reanchor 全链）；grill-docs 栈顶 `r98-grill-ledger`（含本账本+任务书+本 goal）；审计栈 `r97-audit-ledger`(2c)、`r96-audit-loop2`(4c 含 r96-audit)、`r95-audit-loop2`(4c 含 r95-audit)。
- land 序列：`but land r97-audit-reanchor --whole-stack --yes` → `but pull` → `but land r98-grill-ledger --whole-stack --yes` → `but pull` → `but land r97-audit-ledger --whole-stack --yes` → `but pull` → `but land r96-audit-loop2 --whole-stack --yes` → `but pull` → `but land r95-audit-loop2 --whole-stack --yes`（含 r95-audit）→ `but pull`。
- 每次 land 使相关 `unlanded` 声明失效 → 按 R97 已立法重锚仪式改述（理由+审计+reauthored 计数）。
- 观测 land 触发的首次真实 CI run（`ci.yml`/`ship-gate.yml` on.push main），结果入轮报。
