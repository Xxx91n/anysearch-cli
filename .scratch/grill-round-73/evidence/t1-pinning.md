# T1 钉版实证 — dsh 上游依赖族双层锁（2026-09-19）

## 改动
- apps/dsh-plugin/package.json：5 个 @deepseek-ai/* devDeps → `catalog:`；`dependencies:{}` 与 `private:true` 原样保留。
- pnpm-workspace.yaml：新增 `catalog:` 块 16 行（cordis 4.0.2 + 15 个 dsh-* 0.1.5-rc.2）+ `overrides:` 逐名枚举 16 行 → `catalog:` + 解锁条件注释。
- pnpm-lock.yaml：同 commit regen（overrides 块内嵌锁文件头）。

## 门证
1. `pnpm install --frozen-lockfile` → Done 11.3s exit 0。
2. 强制 regen（`rm pnpm-lock.yaml + rm -rf node_modules` 冷态重装 33.5s）：
   - `grep -c '0.1.6' pnpm-lock.yaml` → **0**
   - 全 16 个 @deepseek-ai/* 锁点收敛：15×dsh-*=0.1.5-rc.2 + cordis=4.0.2。
   - `pnpm -F @anysearch-cli/dsh-plugin check`（tsc --noEmit）→ exit 0 零错。
   - 附带实证：冷 regen 时未钉版的 turbo 从 2.10.11 漂到 2.10.13——range 漂移真实发生，钉版必要性反证。
   - 注：本机 global pnpm 冷态写出的锁文件不带 packageManagerDependencies 块（pnpm/setup 系才写）；提交件采用首跑全量解析写出的完整形态（保留 PM 追踪块，零无谓 churn），frozen 校验两形皆绿。
3. `turbo check` 8/8；`turbo test` 13/13（4m29s）。
4. `node scripts/ship-gate.mjs --quick` exit 0——含 ADR-0073 churn lint（zero runtime deps, private ESM bundle）绿。

Commit：uxo on r73
