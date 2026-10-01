# Grill Round 95 — 审计 LOOP2（返工复核报告，审计窗口，不动手修）

日期：2026-10-01 | 复核对象：`r95-exec` 返工批次（`a24684de`/`199f3e72`/`1b7bc809`/`9cac80c1`）
LOOP1 报告：`2026-10-01-audit-report.md`（CONDITIONAL FAIL，5 项阻断 F1~F5 + 3 项呈报 F6~F8）| LOOP1 交接：`round-95-audit-handoff.md`
固定点：`7a540900`（= LOOP1 审计时的 `r95-exec` tip）| 复核基线：`3642d494`

## 0. 复核结论

**CONDITIONAL PASS** —— 8 项全部处置到位，其中 7 项**经审计窗独立取证证实**（非采自述）；**残留 1 项**（F5 残余，交档 Stack 行 tip 字段不准），为**单行文档修复**，不涉代码/测试。

与 LOOP1 的关键差别：LOOP1 的失效面是「报告真实性 + 证据可核性」；本轮返工**逐条补齐且可被第三方机械复证**，指纹悬崖已实证规避，224 调用无须重跑。

> **对 LOOP1 建议的自我更正**：LOOP1 交接档曾建议「新开 `r95-rework` 分支」。实际返工 4 commit 落于 `r95-exec`（17 commits = 原 13 + 返工 4），另存在一个**孤立分支 `r95-rework`（tip=`7a540900`，13 commits，全部已包含于 `r95-exec`）**。审计窗一度疑为 stack 重挂载，实测 `git merge-base --is-ancestor` 证否：`r95-exec` 同时包含 `7a540900` 与 `a24684de`。故 `r95-rework` 是**残留指针**，非重挂载（见 §5-N2）。

## 1. 硬验收独立复跑（不信自述）

审计窗亲自执行；`check`/`build` 均 `--force` 强制未缓存（LOOP1 已揭示 turbo `FULL TURBO` 假绿陷阱，本轮沿用）。

| 验收项 | 自述 | 审计窗实测 | 判定 |
|---|---|---|---|
| `pnpm turbo run check --force` | 8/8 绕缓存 | **exit 0，8/8**（`Tasks: 8 successful, 8 total`） | ✅ 证实 |
| `pnpm turbo run build --force` | 5/5 | **exit 0，5/5** | ✅ 证实 |
| `node scripts/install-smoke.mjs` | 29/0 | **exit 0，`install-smoke: 29 passed, 0 failed`** | ✅ 证实 |
| `pnpm test` | 13/13 | **exit 0，`Tasks: 13 successful, 13 total`**（golden 117/0、stub 158/0、closeout-coverage 46/0 均在日志中） | ✅ 证实 |
| `node scripts/ship-gate.mjs` | run C/D exit 0 全绿 | **exit 0，零 `[fail]` 腿**；`closeout-claims r95: 9/9 registered claims re-derived green`、`handoff-lint` pass、`closeout-coverage: 20/20`、`canonical-json` 绿、`path-lint: 598 registered doc(s) clean`、`clean-tree` 空 | ✅ 证实 |
| `readout-delta.mjs selftest` | 7/7 | **exit 0，7/7** | ✅ 证实 |
| `readout-delta.mjs assert-corpus` | fp 吻合 | **exit 0，fp `8da3e482b98f8cba`**，subjects 40 / controls 16 | ✅ 证实 |
| `verify-validator-vs-doc.ts` 离线 | exit 0 | **exit 0，`DOC SIDE OK`**（须 cwd=`packages/store`） | ✅ 证实 |
| 终读档 sha256 | — | `28f509fb…eada0b` 未动（不在返工 diff 内） | ✅ 承继 |

## 2. F1~F8 逐项复核（声明 → 证据 → 结论）

### F1 未申报偏差 ✅ **证实整改**
- **声明**：轮报 §6 改为「未申报偏差：**本轮新增一条具名申报**——`729e3c36`（`xlu`）时 pathlint 腿红（空挂 marker：`a marker on a line with no machine-local path — remove it`），经返工 commit `7a540900`（`wzw`）转绿」。
- **证据**：返工 diff 显示 §6 该行已替换；引用的 commit / but-id / 门禁报错原文与 LOOP1 实测逐字一致。
- **判定**：**合规**。申报具名、可复证，且同时申报了返工 commit 例外与 Addendum-A 指向。未申报偏差归零。

### F2 T3 改动计数 ✅ **证实整改（口径精确）**
- **声明**：§2 T3 改为「非注释改动**三处**：EXPECTED_FP 滚动 + `out.matrix` 指向 `grill-round-95/prereg-matrix@3` + selftest fixture 分布重调（`i % 7` better 保持 / `i % 9 === 2` worse——n=41→40 后 indeterminate 带意图保持，已复核 P=0.658）；另 +1 空行」。
- **证据**：LOOP1 实测非注释新增恰为 4 处（EXPECTED_FP / out.matrix / fixture / 空行），fixture 表达式逐字为 `i % 7 === 0 ? "better" : i % 9 === 2 ? "worse" : "tied"`。新表述**三处 + 另 1 空行**与实测完全吻合。
- **判定**：**合规**。`prereg-matrix.md` §10 因 SAP 冻结未改字，Addendum-A 声明「以本附录为准」——处理方式正确（预注册不得追改，追加为准）。

### F3 墓碑体 expected ✅ **证实整改（两条独立实证）**
- **声明**：取方案 (b)：`validateDocsGoldenEntry` 新增墓碑行 `expected` 键冻结断言（白名单 `verdict|minResults`；`mustHit*`/`mustNotHit*` 及未知键一律拒）+ 生成器注释同步 + D-002 约束改述为垂直面读法；**语料字节不动**，指纹 `8da3e482b98f8cba` 存续、matrix@3 不作废。
- **证据 A（指纹悬崖规避——审计窗亲跑）**：`eval-looks.json` regen 前后 sha256 均为 `4f952262acf7e27300a38d66fa20f6fd247496b0172a45783104a5210a80bbe2`，`git diff --stat -- eval-looks.json` 为空；regen 输出 `wrote 57 corpus entries (tombstoned=1); totals: golden=76 vert-subjects=40 ctrl=16`。→ **字节同一，指纹存续，matrix@3 不作废，224 调用无须重跑**（审计窗已确认零漂移，工作树保持空）。
- **证据 B（断言真咬——审计窗亲跑）**：直接调用 `validateDocsGoldenEntry`（不经语料文件，故无指纹风险），schema-valid 基线 `{verdict,minResults}` → **0 problems（不过度拒绝）**；三注入全被拒且拒绝理由精确：
  - `mustHitHosts` → `tombstoned entry must not carry expected.mustHitHosts (unproducible without a lane)`
  - `mustNotHitPaths` → 同式拒绝（unproducible without a lane）
  - 未知键 `fooBar` → `…expected carries unknown assertion key fooBar (frozen to verdict|minResults)`
  → **bite-check 4/4 as designed**。
- **判定**：**合规**。这是 LOOP1 唯一有指纹悬崖风险项，返工选择了正确解法（约束改述 + 机检固化，而非删字节），并提供可复证的规避与咬合双证据。

### F4 R86 保全件 ✅ **证实整改**
- **声明**：保全件入 `evidence/` 并随返工入 diff；轮报 §2 T5 + 独立注记补仓内路径与 sha256。
- **证据**：`git ls-files` 确认 `.scratch/grill-round-95/evidence/delta-r86-locked-2026-09-27.json` **已跟踪**；两份 sha256 **均 MATCH** `4dcff270325ddc65…`（仓内 evidence 副本 + `.scratch/vertical-eval/` 原件）；轮报 §2 后新增独立注记段披露仓内路径 + 来源路径 + 完整 sha256。
- **判定**：**合规**。证据可第三方核验，LOOP1 的「哈希真、不可核」缺陷消除。

### F5 交接档模板 ⚠️ **主干合规 + 残留 1 项**（详见 §4-F5R）
- **已合规**：Stack 行改为 `<branch> → <but-id> (<sha> @ <iso-date>)` 模板格式，but-id 链 `trx…wzw` 齐备；绿色 run URL 主字段改为 **`PENDING — stack unpushed`**，祖先线 run 降级为显式标注的「门禁机械锚、非本轮 run」旁注。模板义务与门禁机械锚并存，**F5 修复不回退**。
- **残留**：Stack 行枚举止于 `wzw`（`7a540900`）后接「（返工 commit 见轮报 §6…）—— 即 `r95-exec` tip」，但 `r95-exec` 实际 tip = `9cac80c1` = `ulo`。→ **该行自称 tip 却短 4 个 commit**，模板主键字段未含 tip 的 4 个返工 but-id。

### F6 返工 commit 例外 ✅ **证实整改**
- **声明**：承认返工例外（一票一 commit 遇返工允许异常、须具名申报，不 amend 归并）；§9.4 预申报 4 个返工 commit 集。
- **证据**：返工 4 commit 全部带 `rework(r95-audit):` 前缀（`a24684de`/`199f3e72`/`1b7bc809`/`9cac80c1`）；轮报 §6 具名申报例外 + §9.4 预申报集合；ADR-0096 Addendum-A F1 条落「一票一 commit 遇返工时允许异常 commit，但须在轮报 §6 具名申报」。
- **判定**：**合规**。预申报（§9.4）与事后申报（§6）双轨，claims 实物未追写。

### F7 claims 登记 ✅ **证实整改（冻结完整性经审计窗验证）**
- **声明**：补登记 `closeout-claims.json`（schema `anysearch/closeout-claims@1`，round 95，9 claims），本机复推 9/9 绿；Claims Freeze Point 自登记 commit 行使。
- **证据**：文件实测 schema / round=95 / claims=9，claim id 九条齐备（`r95-t1-corpus … r95-t8-closeout`）；ship-gate `closeout-claims r95: 9/9 registered claims re-derived green`；**冻结完整性**：`git diff a24684de..r95-exec --stat -- .scratch/grill-round-95/closeout-claims.json` 为 **空**（登记 commit 之后 claims 实物未再改动）。
- **判定**：**合规**。Claims Freeze Point 本轮**真正被行使**，且可机械复证。LOOP1 指出的「R95 是 R80 起首轮未登记 claims」已闭合。

### F8 门禁假绿 ✅ **证实处置（defer + 冲突经源码坐实）**
- **声明**：本轮不修门禁，作为 defer 型 backlog 记入 R96 主推；run B 拿到「模板 PENDING 出口 vs gate 强制 run URL 互相冲突」的本机实证。
- **证据（源码坐实，非仅自述）**：`scripts/ship-gate.mjs` 行 1208 对 run URL **无 PENDING 豁免**（ids 为空即报 no actions/runs/<id> URL cited）；行 1188/1200/1224 显示 liveness 腿在 gh+network 不可用时降级为**显式 skip**（`checkedLiveness=false`），行 1233 输出相应省略「cite a run on this round history」子句。与 `docs/agents/handoff-template.md:31` 的 PENDING 出口**构成真实冲突**，返工的 run B 归因**成立、非借口**。R96 首要待办已改列为「门禁假绿收口（F8）」。
- **判定**：**合规**。工具缺陷正确 defer 至独立轮，证据已固化到可交接程度。

## 3. 台账/ADR 完整性抽查

| 项 | 证据 | 判定 |
|---|---|---|
| ADR-0096 本体不动仅追加 | `git diff --numstat` = `15 0`（纯增零删）；新增全部位于 `## Addendum-A` 之后 | ✅ 合规 |
| prereg-matrix.md SAP 冻结 | 返工 diff 对该文件 `git diff --stat` **为空**（未追改预注册） | ✅ 合规 |
| claims 冻结点未追写 | 见 F7 证据 | ✅ 合规 |
| registry / eval-looks.json 未被返工污染 | 返工 diff **不含** `docs/deferred-registry.json` / `eval-looks.json` | ✅ 合规 |
| 审计产物（`kqq`）零改动 | `git diff e9190d9a..r95-exec --stat` 对审计报告与 LOOP1 交接为空 | ✅ 合规 |

## 4. 残留缺陷（唯一阻断项，单行文档修复）

### F5R — 交接档 Stack 行自称 tip 但短 4 个 commit（残留）
- **位置**：`.scratch/grill-round-95/handoffs/round-95-closeout.md` 第 4 行（Stack 行）。
- **证据**：该行枚举 `trx…wzw`（末项 `wzw (7a540900 @ 2026-10-01)`）后接「（返工 commit 见轮报 §6；本件随其同批落盘）—— 即 `r95-exec` tip，未 land、未 push」。但 `r95-exec` tip = `9cac80c1` = `ulo`，`wzw` 短 4 个 commit（`qyv`/`lxn`/`umt`/`ulo`）。`but status` 亦证栈顶为 `ulo`。
- **性质**：非造假（返工 4 commit 已由 §6 + §9.4 具名披露），但**模板主键字段对自身 tip 不准**，恰是 `handoff-template.md:12-13,23-27` 指定为最需准确的字段，亦是 LOOP1 F5 的原址。
- **修复要求（一行）**：Stack 行末补 `→ qyv (a24684de @ 2026-10-01) → lxn (199f3e72 @ 2026-10-01) → umt (1b7bc809 @ 2026-10-01) → ulo (9cac80c1 @ 2026-10-01) —— 即 r95-exec tip，未 land、未 push`；或删「即 r95-exec tip」措辞。
- **重跑**：仅需 `node scripts/ship-gate.mjs`（确认 handoff-lint / path-lint 仍绿）+ `git status --porcelain` 为空。**无需** check/build/test 重跑（纯文档行）。
- **审计窗不代修**（职责分离）。

## 5. 非阻断观察（呈报，不追认）

- **N1 handoff §3 序号错乱（nit）**：`round-95-closeout.md` §3 插入 F8 为主推项后编号出现 1./2./2./3.（第 33-36 行），无 4.。markdown 渲染自动重排故视觉正常，但原文序号畸形，建议随手修正。
- **N2 `r95-rework` 孤立分支（nit/hygiene）**：该分支 tip=`7a540900`（13 commits），全部已包含于 `r95-exec`；属返工窗口遗留的残留指针。不属违规，但悬置分支有混淆/误 land 风险，建议清理或具名保留意图。
- **N3 liveness 腿静默降级（F8 强化）**：gh 在本机 PATH 上但 gate 仍输出 `liveness leg skipped: gh/repo unavailable`——本轮 `handoff-lint` pass **未对 run URL 做活体核验**，即「祖先线 URL 被当本轮 run」这一盲区在 gh 不可用时**必然放过**。这强化 F8 的 R96 优先级：R96 应让 PENDING 成为机械可接受的出口，并对「URL 是否本轮 run」做可离线判定。
- **N4 claims 语义待下一轮确认（观察）**：9 条 claim 与 gate 复推 9/9 绿均已验证；但 claims 的**语义正确性**（每条断言内容是否与实际工件相符）本轮仅验证「能复推绿」，未逐条比对内容。建议 R96 或 claims 专项轮做内容级抽查。此为新增制度的首轮，成本可接受，非本轮缺陷。

## 6. 已排除的怀疑（勿重复排查）

1. **stack 重挂载 / 分支归属错乱**——**证否**。`r95-exec` 含全部 17 commits（含 `wzw` 与 `qyv`）；`r95-rework` 为栈中残留指针，非重挂载。
2. **指纹悬崖已规避**——**证实**。regen 字节同一，matrix@3 作废风险解除。
3. **F3 机检是装饰性断言（不过咬）**——**证否**。bite-check 4/4，三注入按预期理由被拒、基线不过度拒绝。
4. **claims 冻结后被追写**——**证否**。`git diff a24684de..r95-exec` 对 claims 为空。
5. **预注册被追改（违反 SAP）**——**证否**。`prereg-matrix.md` 未被返工触碰。
6. **ADR-0096 本体被改写**——**证否**。numstat 15/0 纯追加。
7. **审计产物被回改**——**证否**。`kqq` 两件对 `r95-exec` diff 为空。

## 7. 复核后放行建议

- **判定**：**CONDITIONAL PASS** —— 8 项处置全部合规（7 项独立取证证实 + F5 主干合规带 1 残留），唯一阻断 F5R 为单行文档修复。
- **放行条件**：修复 F5R（Stack 行补 4 个返工 but-id 或改措辞）+ 复跑 `ship-gate` 与 `git status` 为绿/空。**无需重跑在线腿、无需重跑 check/build/test**（纯文档行改动）。
- **整改归属**：F5R 属原修复窗口（返工窗口）范围，建议回该窗口做单行返工；或 owner 批准后由任一窗口修复。无论谁修，**修完必须复跑上述最小验收**。
- **不得追认事项**：N1/N2/N3/N4 均为非阻断，不构成放行条件，也不由审计窗代为追认；N3/F8 归 R96 主推。

## 8. 审计窗自证

- 本轮**只读**：唯一一次写操作是对 `eval-looks.json` 的 regen 幂等性验证（先记 sha256，跑 regen，比对，确认零漂移），验证后 `git status --porcelain` 为空；临时探针脚本置于 OS 临时目录并已删除；未修改任何被审文件。
- 双轴评审（Standards/Spec）子代理用于交叉取证；本报告 §1/§2/§3 全部结论为审计窗亲测，非转述。