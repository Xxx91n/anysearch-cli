# Handoff — Grill Round 95 审计窗 → 返工窗（CONDITIONAL FAIL）

Stack: `r95-exec` but-id 链（旧→新）`trx`(`4a73758b` @ 2026-10-01) → `pnw`(`a9f2088e`) → `rsk`(`04cdce5e`) → `lyz`(`aee54914`) → `xut`(`0ae0c92b`) → `znn`(`4b9a1824`) → `oql`(`3063f957`) → `umy`(`bb4ec7e1`) → `ouz`(`f20fe391`) → `zpv` → `szw`(`9454a182`) → `xlu`(`729e3c36`) → `wzw`(`7a540900` @ 2026-10-01) —— 即 `r95-exec` tip，未 land、未 push
审计件自身：分支 `r95-audit`，审计报告 + 本件（but-id 见 `but log r95-audit`；本件自引用故不写入自身 but-id，避免 amend 后失稳）

## 绿色 run URL（必填）

**PENDING — stack unpushed。** 本轮全部提交未外发（无 push / tag / publish，纪律内），故无本轮 CI run 可引。
门禁证据为**本机实测**，非 CI：`node scripts/ship-gate.mjs` → **exit 0**（审计窗独立复跑，全绿；含 `closeout-coverage: 20/20`、`handoff-lint`、`path-lint: 596 registered doc(s) clean`、`canonical-json`、`gen-adr-index: 96 ADRs at HEAD`）。
> 旁注（不作本轮 run）：`r95-exec` 的共同基底 `3642d494` 的祖先线 CI 实证已发表于 `.scratch/grill-round-95/handoffs/round-95-closeout.md`。审计窗**判定该引用不合模板**（`docs/agents/handoff-template.md:31` 要求未推送即写 PENDING），见 F5。

生成：2026-10-01 | 轮次：R95 审计窗 | 审计报告：`.scratch/grill-round-95/reports/2026-10-01-audit-report.md`
被审件：`reports/2026-10-01-report.md`、`handoffs/round-95-closeout.md`、`decision-ledger.md`（D-001~D-005）
重跑清单：审计报告 §7（阶段一文档层 / 阶段二语料层）

## 0. 一句话

R95 工程实质成立、全部回归锁实测为绿；**失效面在报告真实性与证据可核性**。审计窗判 **CONDITIONAL FAIL**，5 项阻断项（F1~F5）**建议打回原修复窗口返工**，3 项（F6~F8）呈报 owner 裁定。审计窗全程只读，未动手修。

## 1. 必读（返工前先看这三条）

1. **不要重跑在线腿。** delta 终读档与 matrix@3 单次终读结论（INCONCLUSIVE/instrument-flag）**成立且不受返工影响**。224 调用无须重跑。
2. **F3 有指纹悬崖。** 修 F3 若动 `eval-looks.json` 字节 ⇒ 指纹滚 `8da3e482b98f8cba` 失效 ⇒ matrix@3 作废、须重跑全量。**默认取方案 (b)**（改约束 + 加 validator 断言，不动字节）。详见审计报告 §7 末段。
3. **返工后必须跑审计报告 §7 同一套验收**，尤其 `pnpm turbo run check --force`（**勿用缓存**——审计窗首跑命中 turbo `FULL TURBO`，是假绿陷阱）。

## 2. 阻断项（返工清单）

| ID | 一句话 | 修复要求 | 重跑 |
|---|---|---|---|
| **F1** | 「未申报偏差：无」不成立——`729e3c36` 时 pathlint 腿红过，靠 `7a540900` 返工才转绿，轮报只提 closeout-coverage 一腿 | 轮报 §6 增列该条申报偏差（申报不否决轮次，未申报才否决） | 阶段一 |
| **F2** | §2 T3「非注释改动仅 FP+stamp 两处」证伪——实为 4 处，第三处改 selftest fixture 的 better/worse 分布（`i % 9 === 2`），直接移动后验 | 轮报 §2 T3 与 `prereg-matrix.md` §10 改为三处并具名该变更 | 阶段一 |
| **F3** | D-002 负向约束「expect 禁落运行期不存在的语义（Pact Golden Rule）」被自身实现违反——墓碑体仍携 `expected.verdict:"answer"`/`minResults:1`，无 lane 能产生 | **方案 (b)**：改写 D-002 该条为「垂直面禁落…」+ `validateDocsGoldenEntry` 加断言固化；**同步修 `gen-corpus.mjs` 的 `tombstone()` helper** 否则重跑语料会写回 | 阶段二 |
| **F4** | R86 保全件哈希真（`4dcff270…` 吻合）但 **untracked + 路径零披露**（r95 文档/ADR-0096/registry 全无命中） | 轮报 §2 T5 补仓内路径；`but` 提交该档使其入 diff | 阶段一 |
| **F5** | 交接档 Stack 行无 but-id / 无 capture date，run URL 未写 PENDING（`handoff-template.md:12-13,23-27,31`） | Stack 补 but-id 链 + `@ <iso-date>`；改写 `PENDING — stack unpushed` | 阶段一 |

## 3. 呈报 owner 裁定（审计窗不代追认）

- **F6** 一票一 commit 破例：轮报票 3 commit（`szw`/`xlu` 主题近乎重复 + `wzw` 返工）。承认返工例外，还是 amend 归并？
- **F7** R95 未登记 `closeout-claims.json`（R80~R94 全有）⇒ CONTEXT Claims Freeze Point 实际未被行使；同轮又恰有 F1 未申报偏差 ⇒ R93-F1 同型敞口。补登记，还是明确停用并同步 CONTEXT？
- **F8** `handoff-lint` 在 F5 两项缺失下仍 **pass**（祖先线 run 被当作「本轮 history」）⇒ 门禁假绿。是否单独立 issue？

## 4. 已排除的怀疑（勿重复排查）

改前轮工件（r84 `gen-corpus.mjs` / r85 `readout-delta.mjs`）**非违规**（R86 先例 `23de57a2` + ADR-0087，ADR-0096 D1 已明载）；语料越界**无**（diff 严格限 f1105 足迹）；探针档污染判读**无**（两档指纹 `8bba68ae` vs `8da3e482` 结构不同，探针未过闸）；跨日分桶/缩范围**无**（单窗 351s，56=40+16 自洽）；两 validator 作用域分支重复**有界且不可提取**（`DocsGoldenSet` 无 `scopes` 字段）。

## 5. R96 方向指示（下一 grill 正题候选）

**主推：门禁假绿收口（F8）。** 本轮审计暴露 `handoff-lint` 接受祖先线 run URL + 无 but-id Stack 行仍判绿——即门禁本身在 F5 两项上失守。这是**治理工具缺陷**，比 R95 的文档偏差更值得一个独立轮次：面窄、有明确 fail-closed 修法（Stack 行强制 but-id 存在性 + run URL 必须同 stack 或显式 PENDING），且修完可机械证明。

**备选（沿用 R95 交接档 §3，均需用户侧先兑现）：** B 路径检查（私有端点或有效 key → 干净全量跑）；`finding-r95-upstream-validator-vs-doc-vocab-mismatch` 的 `--live` 重跑（配额恢复后）；`fundamental×cn_code` 新格与全语料契约体检独立立案。

> **不建议** R96 直接重开评测矩阵：R95 读数是 input evidence 非方向裁定（ADR-0096 D3），方向裁定权归 owner `anysearch-eval`，agent 不得代裁。

## 6. 坑位（接手先读）

- `verify-validator-vs-doc.ts` **必须** `cd packages/store` 再跑（仓根跑报 `ERR_MODULE_NOT_FOUND: tsx`）。
- `readout-output.json` 是 matrix@3 单次终读原件：**禁止二次 readout/peek**（矩阵作废）。
- `readout-delta.mjs` 物理位置在 **`grill-round-85/`**（非 r95），改它等于改前轮工件，须在 ADR-0096 补注。
- `ANYSEARCH_ENDPOINT` 须给完整 MCP 路径（`https://api.anysearch.com/mcp`）；裸 origin 被 `normalizeEndpoint` 原样透传致 `initialize 404`。
- 本机 env 残留 `ANYSEARCH_ENDPOINT=http://127.0.0.1:20128/v1/search`（死回环）——用户侧事项，agent 不改、不持凭证。

## 7. Suggested skills

- `$but` — 全部版本控制写操作；返工新开 `r95-rework` 分支，与 `r95-exec`/`r95-audit` 并行互不影响；禁裸 git 写。
- `$code-review` — 返工后若 diff 涉代码面（gen-corpus helper + validator），按 Standards/Spec 双轴再过一次。
- `$neat-freak` — R95 轮末收尾（claims 登记 F7 决策落地、文档与代码对齐复核）。
- `$diagnosing-bugs` — 若 F3 修后 `pnpm test` 出红（golden 117 / stub 158 计数会变），按诊断循环走而非直接改断言。
- `$handoff` — 返工收口交接（引用已有工件路径，不复述）。

## 8. 自检

- [x] 引用已有工件（路径）而非复述内容
- [x] 脱敏：无 key / 凭证 / PII（端点仅记源类不记值）
- [x] Stack 行含 but-id 链 + capture date（**本件即 F5 的正确示范**）
- [x] 绿色 run URL 显式写 PENDING（未推送）
- [x] 职责分离声明：审计窗只出报告，**未动手修**
