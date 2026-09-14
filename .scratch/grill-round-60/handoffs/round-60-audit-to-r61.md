# Round-60 审计收口 → Round-61 起票面（含 grill 方向指示）

## 审计结论

通过（带呈报项）。硬验收全部由审计窗口亲跑复绿：turbo check/build/test --force、gen-adr-index --check、check-workflows、validate-domains 3/3、ship-gate --skip-matrix 9 步全过、install-smoke 15/15（真实 pack→干净装→doctor/domain/search，online allowlist 硬断言命中）、doctor 22/2/0 exit 0。报告逐票声明零伪造；行数纪律 1272 正文 > 899 治理（最坏口径 1272>1012）；D-001..D-006 逐条有据。
全量对照表与发现见 `reports/2026-09-14-audit.md`（F1–F5）。

## R61 grill 方向指示（候选票，按优先级）

**审计发现 F1/F2/F3/F5 已在 `grill-60-fix` 修复落地**（见 CHANGELOG「审计修复」节）：域解析链 env→cwd 链头单一化到 `defaultDomainsDirs`/`domainTomlPath`，cli 面（chat/hitl/pref/domain/doctor）全走 `domainSearchDirs` 四链；policy 层 ANS_DOMAINS_DIR 生效；manifest 算术改正 + classes 校验补洞；`--new` 禁分类编造；台账原子写；uniqueUrls 口径统一；顺带真 bug——`ans pref` 此前 `:memory:` 从不落盘已改 durable。**残留说明**：mcp/plugin 面打包不随 cli 的 domains/，其上限仍是 ANS_DOMAINS_DIR + cwd（env 链已由本次修复覆盖；包内域对 mcp/plugin 本不存在）。

1. **docs 域外 abstain 缺口（bc0001 遗留，升级为正票）**：docs 域对域外提问无 abstain 纪律——engine 返回 10 条非 allowlist 结果而非拒答。解析链单一化已由 audit-fix 扫清入口面，本轮可直接在 engine/policy 层落域外 abstain / 非 allowlist 标记纪律。
2. **离线 golden 执行器决策（审计 F4）**：golden.expected（mustHitUrls/abstain）当前是只记录无执行器的死数据——要么实现快照 fixture 回放（原 T2 判据），要么按 D-002「首轮只记录不设阈」正式 documented deferral 入 ADR。
3. **adversarial 维入圈触发**：B4 回灌见到首个注入型 badcase 时执行（既有 deferred entryTrigger）。
4. **macOS CI lane**：真实 macOS 问题报告时加矩阵项（既有 documented limitation）。
5. 残留微瑕（F5 未修部分）：urlAllowlist 裸域 `typescriptlang.org` 归类裁决（留或收，spec 附表 3 源→实际 4）。

## 恢复上下文顺序

1. 本文件 → 2. `reports/2026-09-14-audit.md`（F1–F5 明细+证据行号）→ 3. `decision-ledger.md`（D-001..D-006）→ 4. `docs/adr/0061-*.md` → 5. 需要时 `handoffs/round-60-closeout.md`（fixer 视角）。

## suggested skills

- 起票前：`grill-with-docs`（F1/F2/F3 定级若需拍板走新 grill 轮）；`ask-matt` 路由不定项。
- 规格化：`to-spec` → `to-tickets` → `implement`；修复期 `tdd` 在验收接缝驱动（解析链单一化 + abstain 纪律适合先写败北测试）。
- 实现后：`code-review`（双轴）+ 本审计同款验收清单重跑（命令序列见 `.scratch/audit-r60-*.log` 与审计报告 §1）。
- 调研不定项：atomcode 深调研（`.codex-tmp/` 放 prompt）。

## 已知边界（沿用 closeout）

- tavily provider 不转发 AbortSignal（SDK 限制，账本已载）——grace abort 对其无效但 cancelled 上报仍真。
- eval-looks.json 双职责：OF look 账本 + golden 顶层集，appendLook/压实透传已验证。
- ship-gate step1a「pin to 0.0.1」为提示文案非硬断言（下轮再 bump 时注意）。
