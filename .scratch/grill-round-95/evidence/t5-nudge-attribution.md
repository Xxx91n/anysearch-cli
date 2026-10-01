# R95 T5 — 终读档腿级归因（取证，非判读）

- 终读档：`.scratch/vertical-eval/delta.json`（canonical）；同字节归档 `evidence/vertical-delta-r95-terminal.json`（sha256 `28f509fb345923633de0fd67e20f60978a95828491648295305f746570eada0b`）。
- `generatedAt 2026-10-01T02:39:25Z` | rows=56 | fp=`8da3e482b98f8cba` | runner 内联 instrumentFlag=false（仅对照层）。
- 执行：56 格×4 腿=224 调用，并发 4，351s（约 6.3s/腿）；`DEGRADED` 行=0。

## 腿级失败分类（`permanent-auth`=上游匿名配额边界 nudge 类）

| 腿 | permanent-auth | permanent-protocol | transient | 失败合计 |
|---|---|---|---|---|
| isoOn | 29 | 4 | 0 | 33 |
| isoOff | 29 | 0 | 1 | 30 |
| on | 32 | 4 | 0 | 36 |
| off | 32 | 0 | 1 | 33 |

- `permanent-protocol` ×4（isoOn/on）= 设计内 bogus `sub_domain` 对照格（`ctrl-{f,a,c,h}103`）上游 isError 拒收——R86 已立法为预期负向面，非装置病。
- `permanent-auth` = 上游「自动开通/配额边界」回文（provider 已具名分类，`anysearch.ts:151`）→ 匿名配额耗尽。
- 时序：前 19 行（8 控制 + 轮询第 1 槽 8 主体）全干净 → 自第 9 个主体行起系统性 auth 失败 → 当日匿名预算 ≈ 96–100 调用（含本日先前探针/活查消耗）。
- 主体层 instrumentDown：30/40 = 75% > 30% → **G1b 命中（预注册谓词锚）**；对照层 unmeasured 4/16 ≤ 8 且 nonTied 0 < 4 → G1 未触。

## 结论（预注册分支兑现）

- 命中 T5 预注册分支「中段触发 nudge → 不硬跑」：终读档如实落盘（单次、不重跑、不跨日分桶、不缩范围），当日合法判读路径 = INCONCLUSIVE-instrument（G1b 语义），探针读数作**量化锚**（t4-probe-readings.md）。
- B 升级路径（用户侧）：复活私有端点或供有效 key → 兑现后声明式环境一次干净全量跑（判据同 R86 T5：装置性失败=∅ + 覆盖≥70%）。
