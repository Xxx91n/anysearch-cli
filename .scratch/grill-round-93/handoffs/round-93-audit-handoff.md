# R93 审计交接 — 打回返修核销后（PASS）

编制: 2026-09-30 | 上一轮: R93 实施窗（`r93-l3-rerun`，23 commits，未 land 未 push）
审计: LOOP1 打回 F1/F2 → 返修 → LOOP2 复审核销 → **PASS**

## 下一会话要做什么（R94）

**首要动作：r88-candidate sunset 预通知义务**（强制，R95 前必须开庭；R94 是预通知窗口）。
其次：ADR-0094 D6 证据效力口径复核（本机门禁是否升级 blocking）。
两项都是规则/排程动作，**不需要重跑 T2**。

## 判词（一字不差引自工件，勿改写）

`verdict = established-via-fallback`，`branch_label = A`。
L3a `established` · L3b `established-via-fallback` · L3c-min `established` · L3c-full/L3d/L3e `not-established`（非判据）。
权威源：`.scratch/grill-round-93/evidence/t2/t2-verdict.json`（返修零改动）。

## 审计终态（不要重做）

| 项 | 状态 |
|---|---|
| 硬验收（build/pack/启动测活/check/test/ship-gate/adr-index） | 全绿（审计窗 LOOP2 亲跑复核） |
| F1 claims 归档脱节 | **核销**（归档日志 14/14 == 实物 14） |
| F2 票序节待补 | **核销**（12 行 but-id 齐，活锚点清零） |
| F3/F4/F5 低项 | 呈报不改写（chore 改 docs 面 / scope 命名 / T6⑥ 证据节） |
| P1–P6 过程违规 | 呈报不追认 |
| 双轴评审 | Standards + Spec 均 PASS_WITH_NOTES（返修后主发现已闭合） |

## 已完成（不要重做）

- T2 三跑判词、T3 README 版本 B、T4 机器腿 14/14、T5 纯备准、T6 收口批、T7 门禁 83/0/0
- ADR-0094 D1–D8 完整立法 + 票序节终态回填
- r88 sunset 条款写入（开庭主体在 R94/R95）
- 审计打回与返修全链（含 3 处返修自伤已复原记账）

## 待办（R94）

1. **r88-candidate sunset 预通知**（强制）— registry `carried_log` 追加 + 点名 owner `anysearch-eval`；引 ADR-0094 D4 预注册条款，禁现场拟。R95 前必须开庭。
2. **证据效力口径复核**（ADR-0094 D6）— 裁定「本机门禁是否升级为 blocking」；规则制定不混入收口票。
3. **defer-r93-deprecate-credential-scope** — 6 条备准命令待用户亲触（EOTP，不代跑）。
4. **F3/F4/F5 低项** — 可选清理，非硬顶。

## 坑位警告（R93 实际踩到 + 返修教训，下轮直接绕开）

继承 `%TEMP%\r93-handoff-next-round.md` 全部 14 条（含返修新增 3 条），要点：

1. `dsh plugin add` 必须**绝对路径**（相对路径以 profile 目录为基准 → ENOENT）。
2. ship-gate step 0 要求工作区干净；跑门禁前挪走未提交产物。
3. **CHANGELOG 落笔必须先于任何机器腿首跑**（ship-gate:776 fail() 早退，claims 腿不可达）。
4. closeout-coverage 要求当轮有 `round-NN-*closeout*.md`（不含 audit、不以 next 开头）。
5. claims symbol token 必须逐字字面量，概念同义词不算。
6. 机外路径必须带 `<!-- machine-local: reason @ date -->` 标记。
7. `next-round.md` 归属 `r93-grill` lane，**不要追加**（会要求重排他 lane）。
8. 凭证只经子进程 env 注入；泄漏探针双查（原文 + 前缀 `64a88ea6`）。
9. 宿主真包名 `@deepseek-ai/dsh`，不是 `dsh`。
10. featherless `/v1/models` 返回 200（22078 条），非 404。
11. 响应头零 rate-limit 语义，串行纪律按经验继承。
12. **[返修]** 门禁输出禁止直接重定向进仓内 — 先弄脏工作区触发 clean-tree invariant，还会覆盖完好日志。用「临时目录 → 跑完拷入」。
13. **[返修]** `but commit` 不带文件 = 提交全部 — 会裹入他窗产物；显式点名文件或用 `but commit -b <branch> -m ... <id>`。
14. **[返修]** 恢复暂存产物时核对路径拼接 — 嵌套 `.scratch/` 误建会连带误删证据。

## 显式范围外（承 R93，勿越界）

repin / 垂域死刑复核主体（例外=sunset 预通知+开庭）/ r72 web-matrix 主体 / 评测面 / 常驻债清理主体 / approval-channel / tag/push/publish / pathlint 解冻。

## 版本控制状态

- 分支 `r93-l3-rerun`，23 commits ahead of origin/main，工作区 clean。
- 未 land / 未 push / 无新 tag — 纪律内。
- 版本控制用 `but`（gitbutler），与其他分支并行互不影响。

## 关键路径速查

| 用途 | 路径 |
|---|---|
| 审计收口（含对照表+核销） | `.scratch/grill-round-93/handoffs/round-93-audit-closeout.md` |
| 本交接件 | `.scratch/grill-round-93/handoffs/round-93-audit-handoff.md` |
| 轮报（含审计返修轮） | `.scratch/grill-round-93/reports/2026-09-30-report.md` |
| 收口交接件 | `.scratch/grill-round-93/handoffs/round-93-closeout.md` |
| 返修证据 | `.scratch/grill-round-93/evidence/audit-rework-f1-f2.md` |
| 立法 | `docs/adr/0094-architecture-grill-round-93-kimi-l3-rerun-verdict-gated-pivot.md` |
| 判词 | `.scratch/grill-round-93/evidence/t2/t2-verdict.json` |
| 门禁登记 | `.scratch/grill-round-93/closeout-claims.json`（14 条） |
| 挂账 | `docs/deferred-registry.json` |
| 坑位全集 | `%TEMP%\r93-handoff-next-round.md`（14 条） |

## Suggested skills

- `gitbutler`（`but`）— 全量版本控制
- `handoff` — 轮末再次交接
- `code-review` — 轮末双轴复核
- `research` / `atomcode-research` — 若 R94 开庭需外部证据
- `domain-modeling` — 若新增术语
