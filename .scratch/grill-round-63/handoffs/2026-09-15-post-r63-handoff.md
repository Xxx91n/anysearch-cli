# Handoff — Round-63 修复轮收口（2026-09-15）

## 状态

T1–T8 全部落盘。GitButler 串行栈（git log 序）：r63-grill(2b405ea) →
r63-t1(7478628) → r63-t2(72c8a82) → r63-t3(0f3159c) → r63-t4(36216ff,2a8fd3e) →
r63-t5(327ac27) → r63-t6(47c7e70) → r63-t7(0ae976f,49960bd) → r63-t8(ntl)。
终审书：`.scratch/grill-round-63/go-no-go-0.0.1.md` — **VERDICT: GO WITH CAVEATS**。
报告：`.scratch/grill-round-63/reports/2026-09-15-report.md`（逐条命令+输出摘要）。

## 下轮任务（发布执行票 —— 全部需用户授权/亲手）

1. `but land` 落栈到 main → push（须授权）。
2. 等 main-tip `ci` + `ship-gate` 双绿 → 记 run URL 入 ADR-0064 Closure (i)。
3. `release.yml` dispatch runPurpose=pre-tag → `git tag v0.0.1` + push tag。
4. 用户本机 `pnpm -r publish`（4 发布包，npm 已登录）。
5. 72h unpublish 窗内净机自验：`npm i -g @anysearch-cli/cli@0.0.1`（npm 无 release-age 门——精确版本装）
   + embedding 显式加装腿 + FTS-only 冒烟；`npm view` 复核 manifest
   （version/dist-tags/access/repository）。
6. 发布 release notes（docs/release-notes/0.0.1.md）；回填 ADR-0064 Closure
   Evidence (i)/(iii)。
7. 0.0.2 前配 per-package trusted publisher → CI OIDC+provenance 回归。

## 带病项监视

- 隔离集 10 条 TTL 2026-10-14：棘轮已在 ship-gate（扩容/续期/过期无裁决全红），
  裁决出口 promote/retire/longterm(≤1)；根因与选项见
  `.scratch/grill-round-63/t6-live-drift-investigation.md`。
- macOS 探针连绿钟自数据点 #1（registration-seg 红）起算，≥5 连绿方可回矩阵。
- 0.0.2 起 CI 发布需带 provenance；0.0.1 无 provenance 为已知 D-006 后果。

## 复跑入口

`node scripts/ship-gate.mjs`（9 步全门）、`node scripts/install-smoke.mjs`
（消费者形态 26 断言）、`pnpm -C packages/store test:online`（live 执行器）。
