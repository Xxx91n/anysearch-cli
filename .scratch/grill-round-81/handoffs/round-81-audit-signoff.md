# R81 审计返工签字交接（round-81-audit-signoff）

Date: 2026-09-24. Stack: `r81-grill` ← `r81-impl` (8 commits) ← `r81-audit` (mty 审计报告 + tmz 返工)。工作区干净。未推送（PENDING）。

## 返工裁决回溯

审计报告 `.scratch/grill-round-81/reports/2026-09-24-audit.md`（commit mty）裁「有条件通过」，2 项须返工 + 1 项建议随修。全部闭合：

| 发现 | 返工内容 | 证据 |
|---|---|---|
| F-1 `docs/publishing.md` 旧 unpublish 句与 C1-C3 分级冲突 | 旧句改写为指向失败分级节；unpublish 保留为灾难性事故兜底 | publishing.md ~L44 新段 |
| F-2 `anysearch.ts:17` 票名误指 `fix-r82-anysearch-rest-contract` | 改为 `fix-r82-anysearch-mcp-migration`（R82 主轴迁移票） | anysearch.ts:17 |
| F-3 TI 双格 transcript 仅 ctx 索引未落档 | 落仓 `evidence/ti-r1-dualcell-transcript.md`（5 格 PASS + marker 合规） | 新增证据文件 |

次要观察 O1-O5 与过程呈报 P1/P2：如实留档，未扩域处理（O1 deadline 属 registry schema 演进、O2-O4 为存量沿袭面——R82 可再议）。

## 重跑清单复核（审计 §7）

| 项 | 结果 |
|---|---|
| `pnpm turbo check --force` | 8/8 实跑 21.5s 绿（0 cached） |
| `node scripts/ship-gate.mjs` 全程 | 9 步全绿 EXIT 0；closeout-claims 11/11 重推导 PASS；path-lint 新增 marker 后零违规 |
| 栈形核验 | r81-grill(rml) ← r81-impl(sro→sox 8 commits) ← r81-audit(mty, tmz)；`git status` 干净 |
| 触及项复核 | publishing.md 分级指向唯一无自矛盾；anysearch.ts 票名与 next-round-r82.md T1 一致 |

## 状态

返工后重跑全绿。本轮 R81 完整收口：诊断裁决（分支 b / MCP 迁移）+ R1 幂等发布补丁 + 插曲事件 1 三扳机 + 审计条件项闭合。

R82 入口见 `handoffs/next-round-r82.md`：主轴 `fix-r82-anysearch-mcp-migration` + REST 宣称修正 + 错形校验 + R2/R3/R4 gate 票。
