# ADR-0025 — 架构 grill round 22：ship-gate 双段拆分 + 等权冲突裁决暴露（Native Smoke CI + pref review）

## Status
Accepted — grill r22（2026-08-26），基于 round54 审计交接的 5 项待办 + atomcode 六厂商交叉调研（Mem0 / Zep / LangMem / Letta / Cognee / Claude Code memory，16 次搜索 / 11 页全文 / 5 角度全覆盖）。

## Context
round54 审计遗留两条工程缺口：
1. **跨平台发布可信链缺失**：ship-gate 只在 Windows x64 本机串联全套检查；better-sqlite3 v13 已改捆绑式 prebuild（无 install 脚本），pnpm v11 语义收敛为 allowBuilds 映射表。若 CI 允许编译，node-gyp 静默源码编译会掩盖 prebuild 缺失（sweet-search b33e732 / nchat e94ab08 / latchkey.dev 三桩真实事故）。
2. **d-i′ 无 CLI 通道**：ADR-0024 Amendment A1 已将 equal-weight 机器写矛盾路由到 quarantine（demote_reason="equal_conflict"），但用户无法看见/处置隔离区；ADR-0023 adjudicateMemory 路由存在但没有暴露层。业界共识（Mem0 roadmap / Hindsight / OzBrain conflict flag / TANGLE arXiv 2608.13921 / MemConflict arXiv 2605.20926）为 "flag-don't-silently-pick"：隔离+标记，不静默二选一。

## Decision

### D1 — ship-gate 双段拆分
`scripts/ship-gate.mjs` 保持单平台全链路（Windows x64 本机/CI 均可），新增 `.github/workflows/native-smoke.yml`：4-job matrix（windows-latest / macos-latest(arm64) / ubuntu-latest / ubuntu-24.04-arm），每 job 仅 `pnpm install --frozen-lockfile` + `require('better-sqlite3')` 断言加载成功。CI 下必须保持 allowBuilds=false（故意禁编译，让 prebuild 缺失显形），不加 node-gyp 工具链。配套 `scripts/verify-native.mjs` 断言 prebuilds/<platform>.node 路径存在。

### D2 — 等权冲突裁决暴露：C+A 分层（内部 quarantine + pref review）
C 保留：adjudicateMemory 继续把 d-i′ 自动进 quarantine（不动）。A 新增：CLI 一等裁决命令 `ans pref review`，列出 quarantine 中 equal_conflict 记录（key / 两冲突值 / modified / source / evidence），三个处置子命令：
- `--keep <key>`：保留新值，旧值彻底 invalidate（升级 supersede，清 demote_reason）
- `--drop <key>`：确认旧值，隔离新值（保留 quarantine，标记 resolved）
- `--promote <key>`：复用现有 promotePreference 通道提升为 live 偏好
零新存储表、零新 LLM 调用，复用 adjudication 写路径（符合 ADR-0024 D7 provenance 要求）。批量自动归档（B 方案）作为 quarantine 积压阈值兜底层延后至后续 grill。

### D3 — 两项工作同轮并行落地
CI 面（yaml + verify-native.mjs + ship-gate step 标注）与 CLI 面（pref review 子命令 + store 查询 + test）互不依赖，同轮内先后落地，一次 ship-gate 全绿收尾。

### D4 — 明确拒绝 / 延后
- 拒绝纯 C（静默内部裁决）：行业已反复验证失败（labelstud "most memory systems have no resolution policy" / Graphiti #1728 自动失效误退休）。
- 拒绝 B 作为主通道（自动批量合并）：需语义理解，Graphiti #1728 / Claude Auto Dream 误合并实证风险。
- 拒绝 S2 LLM re-rank 本轮重启：ADR-0024 D1 硬性门槛（gating-counter 稳定 +2 轮）未满。
- memory-pipeline.inject role 校验记为 ponytail 债务（与 RAG 同款，P2）。

## Consequences
+ 发布可信链覆盖 win32-x64 / darwin-arm64 / linux-x64 / linux-arm64 四平台，public repo 零成本。
+ `pref list/remember/forget/review` 四动词闭环——六家厂商无一做全的完整形态。
- 新增 1 个 CI workflow + 1 个脚本 + 1 个子命令族；均为 ponytail 最小增量。

## Implementation Plan
1. `scripts/verify-native.mjs`：assert prebuilds/<platform>.node 路径 + require 加载成功。
2. `.github/workflows/native-smoke.yml`：matrix ×4，frozen-lockfile，仅加载断言不构建。
3. `packages/store`（或 kernel）：review 查询 — SELECT quarantine (demote_reason='equal_conflict')。
4. `apps/cli/src/commands/memory-review.ts`：三个处置动作子命令，复用 promote/demote/invalidate 写路径。
5. 测试闭环：store review 查询测试 + CLI review 子命令 e2e（含 keep/drop/promote 路径）。
6. ship-gate 加注 step 标签声明 CI 共補；CONTEXT.md +3 术语。

## Acceptance（番茄闭场）
1. `pnpm -w check && pnpm -w build && pnpm -w test` 全绿（含新 review 测试）。
2. `node scripts/ship-gate.mjs` FULL GREEN。
3. CLI 测活：`--help` 含 `pref review`；`--version` = 0.1.0-rc.0；doctor 10/1/0。
4. `native-smoke.yml` YAML 语法 + matrix 4 job 完整（本地静态校验，push 时 GHA 真跑）。
5. `verify-native.mjs` 本机 Windows x64 跑通（require better-sqlite3 + prebuilds 路径断言）。
6. CONTEXT.md +3 术语：Native Smoke Matrix / Equal-Conflict Review Channel / Flag-Don't-Silently-Pick，格式与既有术语一致（中文标题副注 + 正文 + _Avoid_）。
7. ADR-0025 文件：UTF-8 无 BOM，Status/Context/Decision/Consequences/Implementation Plan/Acceptance/Research Sources 七节齐全。

## Research Sources
- atomcode round22 r22 调研（同一 batch: atomcode，16 searches / 11 full reads / 3 engines）：Mem0 #4896（ADD-only，无内置裁决）+ mem-audit 外部审计工具（"flags, prints a table, and stops. You decide"）、Zep bi-temporal invalid_at、Letta core_memory_replace 自编辑、LangMem tool-mediated merge-first、Cognee memify 图合并、Claude Code /memory + Auto Dream、Hindsight consolidation（2026-05-21，等权静默二选一失败模式）、OzBrain last-write-wins + conflict flag、TANGLE（arXiv 2608.13921）、MemConflict（arXiv 2605.20926）、Graphiti #1728（误退休）。
- atomcode round54 native-deps 调研：pnpm v11 settings/build + v11 迁移页、prebuild-install 归档（2026-02-19）、node-gyp-build README、better-sqlite3 v13.0.3 package.json（registry 实证）、github.blog runner 变更公告（2025-01-16 ubuntu-24.04-arm free / 2025-09-19 macos-13 EOL）、sweet-search/nchat/latchkey.dev 翻车 commit。
