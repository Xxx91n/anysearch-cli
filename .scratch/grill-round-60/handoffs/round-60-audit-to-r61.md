# Round-60 审计收口 → Round-61 起票面（含 grill 方向指示）

## 审计结论

通过（带呈报项）。硬验收全部由审计窗口亲跑复绿：turbo check/build/test --force、gen-adr-index --check、check-workflows、validate-domains 3/3、ship-gate --skip-matrix 9 步全过、install-smoke 15/15（真实 pack→干净装→doctor/domain/search，online allowlist 硬断言命中）、doctor 22/2/0 exit 0。报告逐票声明零伪造；行数纪律 1272 正文 > 899 治理（最坏口径 1272>1012）；D-001..D-006 逐条有据。
全量对照表与发现见 `reports/2026-09-14-audit.md`（F1–F5）。

## R61 grill 方向指示（候选票，按优先级）

1. **docs 域外 abstain 缺口（bc0001 遗留，升级为正票）**：docs 域对域外提问无 abstain 纪律——engine 返回 10 条非 allowlist 结果而非拒答。**建议与审计 F1/F2 合票**：同一根因是「域解析链未单一化」——把 domainSearchDirs 4 链提为共享模块喂给 chat/memory-preference/mcp/plugin/policy 全部入口（policy 层 domainTomlPath 的 extraDomainsDirs 当前零调用方、ANS_DOMAINS_DIR 未读），再在其上落域外 abstain / 非 allowlist 标记纪律。一张票同时消 F1+F2+bc0001。
2. **coverage manifest 算术修正小票（审计 F3）**：classes 数字改正（source-tier reference 3→4、freshness stable 6→5）+ `crossCheckDocsGolden` 补 classes↔entries 校验防再漂。
3. **离线 golden 执行器决策（审计 F4）**：golden.expected（mustHitUrls/abstain）当前是只记录无执行器的死数据——要么实现快照 fixture 回放（原 T2 判据），要么按 D-002「首轮只记录不设阈」正式 documented deferral 入 ADR。
4. **adversarial 维入圈触发**：B4 回灌见到首个注入型 badcase 时执行（既有 deferred entryTrigger）。
5. **macOS CI lane**：真实 macOS 问题报告时加矩阵项（既有 documented limitation）。
6. F5 微瑕随票清理：urlAllowlist 裸域归类裁决、`--new` 分类默认值、台账原子写（tmp+rename 惯例）、doctor mkdirSync 副作用/死 import、uniqueUrls 口径统一、toml 列表块去重。

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
