# Round-84 审计签核 — PASS（返修闭环）

日期：2026-09-27 · 审计对象：`acaaccb3..HEAD`（返修后栈）
审计档（首轮打回记录）：`.scratch/grill-round-84/reports/2026-09-27-audit.md`
返修记录：`.scratch/grill-round-84/reports/2026-09-26-report.md` §Rework + ADR-0085 D6 补记

## 裁决

**PASS**。首轮两打回项均实证修复，全套验收同口径重跑绿，文书披露补齐，返修归属 amend 正确落层。

## 返修项复核（声明 → 复核证据 → 结论）

- **F1 A-02 TOML 腿** → `composition.ts` catch 谓词扩为 `Domain schema:` 族（含 sources.vertical/urlAllowlist 等错形同类）；`Domain not found` 仍 fail-open（缺席≠错形）。**端到端实测**：坏 `sources.vertical` TOML → exit 1 显式指名报错；缺席域 → 静默全扇出保留（正确区分）。负径钉：`packages/kernel/test/composition-vertical.test.ts`（绿）+ e2e「malformed sources.vertical TOML fails fast」（e2e 18/18）。归属 r84-t1（cb768942）。→ **FIXED**
- **F2 A-03/06/08 漏登记** → `deferred-registry.json` 31 条在册，新增 `defer-r83-a03-flagvalueset-swallow` / `defer-r83-a06-vertical-assembly-dup` / `defer-r83-a08-dead-maxresults` 全 open。归属 r84-t4。→ **FIXED**
- **F3 delta.json schema 漂移** → t3 档 §5 披露存量件缺 Iso 失败面字段，重跑条件并入 `defer-r84-delta-quota-rerun`；报告 claim 8 修订为「对现行 runner 契约成立」。→ **DISCLOSED**
- **F4 f1101 归因措辞** → t3 档更正为 rankDiff=5 产生 better（双臂均命中池）。→ **FIXED**
- **过程披露** → 报告 §Rework 节显式承认 T1 谓词旧呈报与实物不符 + 漏登记 + 存量件漂移；ADR-0085 D6 补记吞错修法。→ **DISCLOSED**

## 验收矩阵（同口径重跑，全部实测）

| 项 | 结果 |
|---|---|
| `pnpm check --force` | 8/8（0 cached） |
| `pnpm build --force` | 5/5（0 cached） |
| `pnpm test` | 13/13（e2e 18/18 含坏 TOML 新用例；聚焦重跑 stub 158 / vertical-domain 33 / anysearch 51 / docs-golden 113 / composition-vertical ok） |
| `node scripts/ship-gate.mjs` | exit 0（9 步；含 closeout-claims 派生复核+R84 断言面+MCP stdio+fail-open） |
| `gen-adr-index.mjs --check` | up to date（85 ADRs） |
| closeout-claims.json | 12/12 独立重导 PASS（新增 r84-f1-composition-failfast / r84-f1-negative-tests 两钉） |
| CLI 负径 | 无 domain 的 --vertical-sub-domain → exit 2；坏 TOML → exit 1 指名报错 |

## 栈状态

`but` 栈（未 push）：`r84-audit`(cd8475bc 审计档) → `r84-grill`(mzq) → `r84-t1`(cb768942) → `r84-t2`(9ccc11ec) → `r84-t3`(41f8257f) → `r84-t4`(297d3bc7 + b63df76a closeout)，基 acaaccb3。worktree 净。

## 残余项（如实记，不阻断）

- delta.json 存量件为早期 schema——待 `defer-r84-delta-quota-rerun` 重跑再生（需有效 ANYSEARCH_API_KEY 或匿名额度恢复）。
- Standards 轴 9 条 smell 未处置（judgement 级，非闸）：双 runner argv 序列化重复、isVerticalEntry 三法并存、engine 重复 coalesce、anysearch IIFE-in-spread、runner kill-timer 未清、`canonicalizeVertical` 透传 `subDomain:""` 边角、fakeSink 重复、marked 遮蔽、MCP 文件缩进 churn。
- live 腿 control 重分类连存在性失败（`__error`）一并降级——D-004「存在性一等断言」的弱化点，可入清障轮。
- `defer-r84-anysearch-empty-endpoint-env` / `defer-r84-ip-fifth-domain` / `defer-r83-prefer-capable-weighting`（证据机制在役等数据）持续 open。
- delta.json 位于 gitignore 区（`.scratch/vertical-eval/`）——机器本地态证据通道，重跑再生即可。

## 下一轮 grill 方向指示

- **首选**：`defer-r84-delta-quota-rerun` 条件触发——持有效公网 `ANYSEARCH_API_KEY` 或匿名额度恢复后重跑 delta 腿，再生 4 面 schema 证据件取全量读数；读数出后再评 `defer-r83-prefer-capable-weighting`（本轮证据机制已就位，判据=臂级 delta 是否有收益信号）。
- **并行候选（清障轮）**：`defer-r84-anysearch-empty-endpoint-env` 空串回落修法 + 新登 r83-a03/a06/a08 三联 + Standards smell 清单挑选项 + control 存在性降级口径收紧。
- **观察位**：ip 第五域触发条件（上游补结构化参数词表）；dsh rc.3+ 版本线续 watch；#1764 用户侧不代发。

## Suggested skills（下一会话接手）

- 修复/返工窗口：`tdd`（负径先行）、`diagnosing-bugs`、`code-review`（返修后双轴复核）
- 收口：`handoff`、`neat-freak`（对账）
- 清障轮候选：`triage`（registry 分流）、`improve-codebase-architecture`（A-06 组装归一+smell 清单）
- 重跑 delta 腿：`research`/`atomcode-research`（上游词表变化核对）
