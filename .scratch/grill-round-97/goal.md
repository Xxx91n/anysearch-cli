# Goal — Grill Round 97

- 正题：自造失效声明可机检类别（统一类别立法 + 形态一/三实现 + 形态二先立规则）。
- 唯一事实源：`.scratch/grill-round-97/decision-ledger.md`（D-001~D-006 全 current）。
- 并行处置轨 B：未合并分支清算（全栈 land + r95-rework 回收，owner 授权窗执行）。

## 范围外（抄 next-round §2，不扩展）

- 不重开评测矩阵修订（vert-f1105 家族不外溢）、不动 r88 formally-declined、不追写 <R97 已冻结 claims、不做发布/tag。
- 活体谓词 `no-pr`/`unpublished` 仅登记扩表示范票，不实现。
- `docs/adr` 权威档不入状态标记 lint 靶位（形态二地盘，防双重管辖）。
- `r95-rework` 不裸删远端指针。
- gitbutler 技能文档缺口回写（`but land`/`but absorb`/`but forge review` 未收录）=仓外 user 级文件，轮外 chore，须 owner 单独授权。

## T0 执行窗状态

- land 前置：`but land r96-audit-loop2 --whole-stack`（ff）→ 核验 origin/main → `but pull` 回收。未获 owner 授权前不执行（本子 Agent 仅预检）。
- 预检实测（2026-10-03）：`zz` clean；`origin/main`=3642d494（自基点 0 新增）；当前 96 栈顶 r96-audit-loop2，r95-rework 残留预期 land 后回收。
