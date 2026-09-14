# Round-60 收口交接 → Round-61 起票面（含 grill 方向指示）

## 最终状态（2026-09-14）

Round-60 全栈已落地主干：**`origin/main` tip = `3321ace`**（13 提交：docs → t1..t6 → closeout → audit → fix，两次 `but land --whole-stack` 完成），本地/远端 `grill-60-*` 分支已全部随 land 删除，工作区干净。

- 审计：`reports/2026-09-14-audit.md`——通过（带呈报项），F1–F5 逐条证据；亲跑验收日志 `.scratch/audit-r60-*.log`。
- 修复：`3321ace fix(r60-audit)`——F1/F2/F3+F5 子集已修（CHANGELOG「审计修复」节）；修后同套验收重跑全绿，日志 `.scratch/audit-r60fix-*.log`。

## 修复落地明细（F1/F2/F3 + F5）

- 域解析链链头单一化：`defaultDomainsDirs`（env→cwd）为共享契约，`domainSearchDirs` 追加 CLI 包内/仓库尾链；`domainTomlPath` 同序读 `ANS_DOMAINS_DIR`——cli 面（chat/hitl/pref/domain/doctor）+ policy 面（plugin/hitl/ans-chat）全部入口一致。
- 顺带真 bug：`ans pref` 此前 `createEngine` 默认 `:memory:` 从不落盘 → 已换 `createPersistentEngine` durable。
- coverage manifest 算术改正（reference 3→4、stable 6→5）+ `crossCheckDocsGolden` 补 classes↔entries 直方校验 + backfill 重算同步 classes。
- `badcase-backfill --new` 禁分类编造（badcase 须自带 intent/questionLang/dimensions）；三台账写改 tmp+rename 原子写；engine 早停 uniqueUrls 统一 normalizeUrl 口径；域列表共享 `listDomainTomls`；doctor 死 import 清理。
- **残留说明**：mcp/plugin 面打包不随 cli 的 domains/，上限仍是 ANS_DOMAINS_DIR + cwd（包内域对其本不存在，非缺陷）。

## R61 grill 方向指示（候选票，按优先级）

1. **docs 域外 abstain 缺口（bc0001 遗留，升级为正票）**：docs 域对域外提问无 abstain 纪律——engine 返回 10 条非 allowlist 结果而非拒答。解析链单一化已扫清入口面，本轮可直接在 engine/policy 层落域外 abstain / 非 allowlist 标记纪律；`ans search 'tokio::JoinSet 怎么给检索 fanout 做结构化并发'` 为复跑探针。
2. **离线 golden 执行器决策（审计 F4）**：golden.expected（mustHitUrls/abstain）当前是只记录无执行器的死数据——要么实现快照 fixture 回放（原 T2 判据），要么按 D-002「首轮只记录不设阈」正式 documented deferral 入 ADR。
3. **adversarial 维入圈触发**：B4 回灌见到首个注入型 badcase 时执行（既有 deferred entryTrigger）。
4. **macOS CI lane**：真实 macOS 问题报告时加矩阵项（既有 documented limitation）。
5. 残留微瑕（F5 未修部分）：urlAllowlist 裸域 `typescriptlang.org` 归类裁决（留或收，spec 附表 3 源→实际 4）。

## 恢复上下文顺序

1. 本文件 → 2. `reports/2026-09-14-audit.md`（F1–F5 明细+证据行号+§7 修复确认）→ 3. `decision-ledger.md`（D-001..D-006）→ 4. `docs/adr/0061-*.md` → 5. 需要时 `handoffs/round-60-closeout.md`（fixer 视角）。

## suggested skills

- 起票前：`grill-with-docs`（bc0001 abstain 纪律 / F4 deferral 定级若需拍板走新 grill 轮）；`ask-matt` 路由不定项。
- 规格化：`to-spec` → `to-tickets` → `implement`；修复期 `tdd` 在验收接缝驱动（域外 abstain 纪律适合先写败北测试）。
- 实现后：`code-review`（双轴）+ 本审计同款验收清单重跑（命令序列见 `.scratch/audit-r60fix-*.log` 与审计报告 §1）。
- 调研不定项：atomcode 深调研（`.codex-tmp/` 放 prompt）。
- 会话交接：本 `$handoff` 规约产物即本文件；版本控制走 `$but`（栈顶 land → `but clean`）。

## 已知边界（沿用 closeout）

- tavily provider 不转发 AbortSignal（SDK 限制，账本已载）——grace abort 对其无效但 cancelled 上报仍真。
- eval-looks.json 双职责：OF look 账本 + golden 顶层集，appendLook/压实透传已验证。
- ship-gate step1a「pin to 0.0.1」为提示文案非硬断言（下轮再 bump 时注意）。
- ship-gate step0 有 clean-tree 不变量（ADR-0059 D5b）——验收前先提交，勿带脏树跑。
