# Grill Round 56/57 — Audit Handoff (Session ID Propagation Protocol)

> **状态:NOT CLEARED** — 审计未通过,代码层合格(10/10 D-ID),报告真实性 + 流程合规 + CI 闭环均未达,Fixer 返工后必须重审。

---

## 1. 本轮交付

- **审计报告**:`.scratch/grill-round-56/reports/2026-09-11-audit.md`(已落)
- **审计方法**:静态文件级 + 代码级 + git 实物对位;构建/运行级由 CI 闭环
- **审计分支**:在 `feat/grill-56-session-id-propagation` 上 read-only 检查,**未对 fix 分支做任何修改/提交**
- **审计期发现的实质问题**:
  - **B1** 报告自述"commit 已落"与 `git log main..HEAD` 输出 0 commit 直接矛盾
  - **B2** propagation 测试数报告 34、实物 grep 19,**虚报 15**
  - **M1** golden case 端到端无单一集成测试(注释明确 store+plugin 各做半边)
  - **M2** `apps/plugin/tsconfig.json` 不覆盖 test/,tsc --noEmit 不验 test 文件
  - **P1/P2/P5** 报告真实性三项;Fixer 写完报告未做基本 git/test-count 自检

---

## 2. 返回 Fixer 的返工要求

### Blocker(必须)

1. **真实 commit 工作**
   - 在 `feat/grill-56-session-id-propagation` 上做 1~3 个聚焦 commit(建议拆 D-006+D-010+D-003;可选拆 D-008/MCP D-009)
   - commit message 引用 ADR-0056 + D-ID,沿用仓库风格(`docs:`/`feat(adr-0056):`/`fix:`)
   - `but` 不可用环境 git 直提也行,但必须在 handoff 中说明 fallback
   - 修正报告 "Found/Fixed/Deferred" 段,**引用真实 commit SHA**

2. **修正 test count**
   - 复核 `apps/plugin/test/propagation.test.ts` 实际断言数(实物 19)
   - 报告里"propagation 34/0" → 19/0(同时报告总 137 → 122)
   - 如要保 34,必须补足到 34 个 `check()` 调用

### Major(强烈建议本轮一并修)

3. **apps/plugin/tsconfig.test.json**
   - 新增 `apps/plugin/tsconfig.test.json`:`include: ["test/**/*"], rootDir: ".."`
   - `pnpm --filter plugin exec tsc -p tsconfig.test.json --noEmit` 加进 ship-gate

4. **golden case 端到端集成测试(可选下轮)**
   - 现状注释明确 store-side + plugin-side 各做半边,缺一个 server→store 完整链路
   - 建议在 `apps/plugin/test/golden.test.ts`:起 localServer + 模拟 hook stdin + fetch /recall + SELECT by runId

### Minor(下轮)

5. `.gitignore` 补 `target/`、`*.tsbuildinfo`(预存,非本轮产生)
6. e2e.test.ts 或现有 suite 补 materialize→read→assert 链路,提高新 API 回归覆盖
7. server.startup WARN cooldown(原 deferred 项)
8. ANS_DB_PATH / ANS_SESSION_ID 一致性合并接口(原 deferred 项)

---

## 3. 重审入场条件

下次审计窗口(由 fixer push 后触发)只验:

| 验项 | 期望 |
|---|---|
| `git log main..HEAD --oneline` | ≥1 commit,SHA 引用与报告"Found/Fixed"段一致 |
| `grep -c "check(" apps/plugin/test/propagation.test.ts` | 报告数字 = 实物数字 ±1(定义) |
| `apps/plugin/tsconfig.test.json` | 存在 + ship-gate 步骤含 `tsc -p tsconfig.test.json --noEmit` |
| ship-gate CI run | pass + artifact 链接 |

**不重复 code-level 静态取证**(已固化于 2026-09-11-audit.md §2.1)。

---

## 4. 下一个 Grill 方向指示(待审计通过后启用)

**暂不指派下一轮主题**。审计未通过即推进新主题违反 ADR-0029「一轮一主题」精神——本轮尚未结束。

通过后建议方向(给 grill 主持做 triage 选):
- **A:Trust boundary 二期(ADR-0053 续)** — content-trust INJECT probes 已落,后续做 EXFIL/EVAL 路径补全
- **B:Cache staleness policy(原 deferred)** — T9 仅做了 materialized_at + 启动 fallback,真正 TTL/失效语义未决
- **C:Hook bundle external typecheck** — 本次 M2 暴露的 apps/plugin tsconfig 缺口,可推广到 apps/mcp、apps/cli

---

## 5. 审计窗自身纪律

| 项 | 是否遵守 |
|---|---|
| 审计只出报告,不动手修 | ✓ 全部用 Read / grep / git 不可变命令 |
| 不替原修复窗口追认 | ✓ Blocker 直接打回 |
| 版本控制:[$but] | `but` 因 gitbutler/* 未配置不可用,**fallback 用 git read-only**(在 feat 分支上仅做 `git log`/`git status`/`git show`/`git diff`);审计本身不做 commit |
| 与其他分支并行工作,互不影响 | ✓ 未触动任何已修改文件 |
| 用 [$handoff] 生成本轮交接 | ✓ 本文 |

---

## 6. 仓库坐标速查

| 用途 | 路径 |
|---|---|
| 审计报告 | `.scratch/grill-round-56/reports/2026-09-11-audit.md` |
| Fixer 报告(被审计) | `.scratch/grill-round-56/reports/2026-09-11-report.md` |
| Fixer handoff(被审计) | `.scratch/grill-round-56/reports/2026-09-11-handoff.md` |
| 任务书 | `.scratch/grill-round-56/handoffs/next-round.md` |
| 决策台账 | `.scratch/grill-round-56/decision-ledger.md` |
| ADR | `docs/adr/0056-architecture-grill-round-56-session-id-propagation-protocol.md` |
| Fix 分支 | `feat/grill-56-session-id-propagation` |
| 审计分支 | (与 fix 分支同;只读,不提交) |

---

*Audit Agent handoff — Grill Round 56/57*
*下一动作:Fixer 返工 Blocker 后 push 触发 ship-gate;CI pass 后由 Audit Agent 二次入场。*
