# Handoff — Grill Round 95 → R96（执行轮收口交接）

生成：2026-10-01 | 轮次：R95 收口 | 本轮账本：`.scratch/grill-round-95/decision-ledger.md`（D-001~D-005 全 current）| 轮报：`.scratch/grill-round-95/reports/2026-10-01-report.md` | 下轮正题候选见 §5

## 0. 本轮终态（一句话）

R95 评测矩阵修订轮按 T1→T8 全票执行完毕：vert-f1105 原位降格 → matrix@3 预注册 → 匿名层终读档 → 中段配额边界触发 → 单次终读 **INCONCLUSIVE/instrument-flag**（G1b，instrumentDown 30/40）。台账三记账与 ADR-0096 同轮闭环；验证电池全绿（check/build/test/install-smoke/`pnpm test`）；ship-gate 终读仅剩 closeout-coverage 一红（本件补记后复跑即绿）。

## 1. 复跑入口（每条一条命令）

- 单次终读产物（只读，不重跑）：`.scratch/grill-round-95/readout-output.json`（结论见轮报 §1）。
- 判读器回归锁：`node .scratch/grill-round-85/readout-delta.mjs assert-corpus`（PASS，fp=`8da3e482b98f8cba`）与 `node .scratch/grill-round-85/readout-delta.mjs selftest`（7/7）。
- 机检信号：`cd packages/store && node --import tsx ../../.scratch/grill-round-95/evidence/verify-validator-vs-doc.ts`（离线 exit 0）；`--live` 复放（匿名配额恢复后重跑；exit 语义见脚本头：0=复现/1=未复现须复核/2=环境无判词）。
- 门禁复跑：`node scripts/ship-gate.mjs`（预期全绿；closeout-coverage 腿以本件为收口档）。

## 2. 复活条件③④供证装箱（owner anysearch-eval 未来轮次开箱，不在本轮开箱）

- 条件③：`eval-looks.json` vert-f1105 tombstone（prior_scope=live，墓碑理由码受控）+ `defer-r86-anysearch-corpus-param-contract`→closed（closed_by=ADR-0096）。上游 finding 另册：`finding-r95-upstream-validator-vs-doc-vocab-mismatch`（open；上游渠道候选，agent 不代发）。
- 条件④：`evidence/vertical-delta-r95-terminal.json`（sha256 `28f509fb…eada0b`）+ `readout-output.json`（INCONCLUSIVE/instrument-flag）+ `evidence/probe-limit4-delta.json`（容量锚）。
- **读数法律角色重申**：读数是输入证据，非方向裁定；即使 Δ 转正，重议仍走 owner 未来轮次立案（ADR-0096 D3）。

## 3. R96 首要待办（建议议程，不越权立案）

1. **用户侧 B 路径兑现检查**（声明式）：私有端点 `127.0.0.1:20128` 或有效 key 若兑现 → 干净全量跑（判据同 R86 T5）→ 条件④升级为洁净读数。未兑现 → 维持 INCONCLUSIVE-instrument（探针锚在档）。
2. **上游渠道跟进**（owner 侧）：finding 的机检信号 `--live` 重跑（配额恢复后）；若 exit 1（未复现=上游已修）→ owner 复核 + registry 更新。
3. **backlog 候选立案**（独立轮次）：`fundamental×cn_code` 新格（须新 id）与全语料契约体检（R95 vert-f1105 案为动机证据）。

## 4. 已知坑位（接手先读）

- `ANYSEARCH_ENDPOINT` 覆写须给**完整 MCP 路径**（`https://api.anysearch.com/mcp`）；裸 origin 被 `normalizeEndpoint` 原样透传致 `initialize 404`（R95 T4 attempt1 实证）。
- 当日匿名预算约 96–100 调用（含活查/探针消耗）；大跑中段 `permanent-auth` 即停（预注册分支），禁跨日分桶合并、禁缩范围终读。
- `verify-validator-vs-doc.ts` 的 exit 语义是 claim 语义（0=复现/1=未复现/2=环境），非构建语义；`--live` exit 2 是环境判词不是证伪。
- `readout-output.json` 是单次终读原件：禁止二次 readout/peek（矩阵作废）。
- 本机 env 残留：`ANYSEARCH_ENDPOINT=http://127.0.0.1:20128/v1/search`（死回环，R86 立法归用户侧，agent 不改）。

## 5. Suggested skills（下一 agent 按需调用 Skill 工具）

- `$atomcode-research` — R96 若遇外部不确定（上游词表/配额形态变化）时的深调通道（串行单发，concurrency:1；配额耗尽走降级）。
- `$gitbutler` — 全部版本控制写操作（一票一 commit；新开 R96 会话分支，与 `r95-exec` 并行互不影响；禁裸 git 写）。
- `$domain-modeling` — CONTEXT 词条立法对齐（若 R96 新增术语）。
- `$neat-freak` — R96 轮末收尾复核（残留/文档同步/凭证闭环）。
- `$handoff` — R96 收口交接（引用已有工件路径，不复述内容；脱敏）。

## 6. 交接件自检（handoff skill 要求）

- [x] 引用已有工件（路径）而非复述：轮报/ADR/ledger/prereg/evidence 均以路径引用。
- [x] 脱敏：无 key/凭证/PII（端点记源类不记值；key 仅记存在性）。
- [x] 交接焦点（R96 待办 §3）已按用户参数裁剪。

