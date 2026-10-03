# Handoff — Grill Round 97 审计窗 → R98（审计结论 + 下一轮 grill 方向指示）

Stack（未 push、未 land；审计窗只出报告，未改任何实现文件）：
  r97-selfcheckable → upo (`b67ddbc8`) → pnq (`f923be49`) → spu (`5280704f`) → vrt (`7b28eca7`) → xvw (`fe87e8a4`) → lop (`fb312b97`) → lsz (`f2776a0f`) → krl (`1aedaee3`) → sqp (`a6c22612`)
  另注：仓库 HEAD `91f5b173` = GitButler 工作区合并 commit（5 parents），非 R97 实现面。审计新增未跟踪文件 `.scratch/grill-round-97/reports/2026-10-03-audit-report.md`（+ `.scratch/audit-r97/*.log` 证据），**未提交**——提交与否待 owner。

<!-- state: unlanded stack @ 2026-10-03 -->

## 审计结论（详见 2026-10-03-audit-report.md）

**验收电池全绿属实，零虚报**。15 条硬声明逐条亲自重跑：check 8/8、build 5/5、test 13/13、真值表 357/0、E2E 270/0、8 包 tgz、ship-gate `REAL_GATE_EXIT=0` + `ship gate green`、claims verbatim 2/2、handoff-lint 1 GREEN/2 PENDING、CLI pref 测活、MCP stdio search_web、5 面适配器断言、memory-eval 126/126。

**但「D-001~D-006 全覆盖」应降格**为「T1~T6 主干覆盖，T0/T7 有账本偏离，T3/T6 有装饰化弱化」。

### 须打回原修复窗口返工（7 项，附重跑清单）

| 编号 | 问题 | 修复要求 |
|---|---|---|
| P-1 | T7 轮回版未落；轮报称「R98 草案全文见附录A」但报告无附录A | 补齐 next-round.md 轮回版 **或** 修正轮报表述使其与实物一致 |
| P-6 | T3 ratchet 是装饰（`reauthored` 仅整数校验，无 recount/无比对/无上表面） | 补 recount 比对与上表面，否则 T3「ratchet」声明降格 |
| P-2 | 收口清算义务「栈空 ∨ deferred 在册」只落散文，D-002 要求可机检 | 补码，或把 D-002「可机检」降格为「流程条款」 |
| S-1 | **假绿方向**：报告级全量扫对未采集分支出 GREEN | 未采集分支应 env-PENDING，非 GREEN |
| S-2 | 裸词扫描的代码 span/fence 豁免零断言 | 补断言（next-round.md:37 明确要求） |
| P-8 | 裸词英文枚举双源（`STATE_BARE_RES` vs `STATE_PREDICATES`） | 单源化，否则扩表漏改即漏扫，违背 fail-closed 自指收敛 |
| P-9 | `reuse` 指针纯装饰（全仓零消费） | 加机器保障，否则 D-004「触发器变更须走扩表流程」无强制 |

**返工后必须重跑同一套验收**：check 8/8、build 5/5、test 13/13、真值表 357/0、E2E 270/0、8 包 tgz、ship-gate `REAL_GATE_EXIT=0`+green、CLI/MCP 测活、5 面适配器断言、memory-eval 126/126。

### 待 owner 批准后修（6 项）

P-7（N5 放宽后误降级 fail-open）、P-3（形态二 PENDING 挂接无码，ADR-0098 D5 与实现不符）、P-5（CHANGELOG 未 feat/fix/docs 分行）、P-4（T0 land 未先行）、P-10（两速扫未真正分权）、§4-3（平台断言口径：报告「1/0」是文件计数，实测断言数 claude 10 / codex 11 / antigravity 13 / codebuddy 18）。

### 明确无需修

B 轨未执行（已申报，无授权不执行合规）、收口件双声明 land/push 后失效（纪律正确，当前自洽）、5 栈待重裁（`91f5b173` 5-parent 合并实测印证多栈，`but land --whole-stack` 只收单栈）。

### 未合并分支全账（已写入 R98 任务书 §3）

owner 授权 push 后实测：`git branch --merged origin/main` 仅返回 `main` + `gitbutler/target` —— **R95/R96/R97/R98 无任何分支已合并进 main**，故「已合并可安全删除」集合**为空**。全部 14 个分支均已 push 且 IN-SYNC，未合并 commit 并集 **43** 个。完整台账（每分支 SHA / 独有数 / 落后数 / 被谁包含）、5 栈结构、三类处置分类（A 冗余不可安全删 r95-rework、B 审计叶 4 支、C 实现栈必 land 4 支）、以及 land 唯一路径与 land 后声明再失效纪律，均已落入 `next-round.md` §3（6 个子节）。

## 下一轮 grill 方向指示（R98）

**建议正题：「门禁自指收敛的机器兑现」**——本轮最大的结构性发现是**立法与实现的落差可机检化**：注册表常量（S-5）、`reuse` 指针（P-9）、裸词双源（P-8）、ratchet 计数（P-6）四者形态同型——**都在 ADR 里被写成机器约束，实现层却是装饰件**。这是「自造失效声明」的**同族第五形态：自造机检声明**（宣称有机器保障，实则散文）。建议 R98 把「声明某约束被机器兑现」本身立法为可机检类别（例如：注册表条目必须有消费方，否则 RED）。

**次题候选**：① 报告级全量扫的真分权（独立报告面，不复用门禁 snapshot）；② 绿/黄/红三态的「GREEN 真兑现」路径（自 R95 起长期无真实施跑证据）。

## Suggested skills

- `gitbutler`（版本控制；B 轨 land 需 owner 授权）
- `code-review`（双轴复审返工结果）
- `domain-modeling`（R98 正题的类别立法）
- `tdd`（成对 fixture；返工项补断言）
- `handoff`（下轮交接）

## 关键路径

- 审计报告：`.scratch/grill-round-97/reports/2026-10-03-audit-report.md`
- 审计原始日志：`.scratch/audit-r97/{check,build,test2,gate2}.log`
- 被审轮报：`.scratch/grill-round-97/reports/2026-10-03-report.md`
- 账本：`.scratch/grill-round-97/decision-ledger.md`（D-001~D-006）
- 收口件：`.scratch/grill-round-97/handoffs/round-97-closeout.md`