# Round 94 收口 — r88-candidate 垂域死刑复核【开庭轮】（r88-candidate-vertical-direction-redeliberation）

Stack: `r94-court-session` on top of common base `85403a20` → main（未 land，未 push —— 纪律内）

## 绿色 run URL（祖先线实证）

- 本轮共同基底 `85403a20` 与祖先提交 `c1917205` CI 跑实证全绿（本轮全部提交建立在其上，`git merge-base --is-ancestor 85403a20 HEAD` → rc=0 且 `git merge-base --is-ancestor c1917205 HEAD` → rc=0）：
  - ship-gate https://github.com/Xxx91n/anysearch-cli/actions/runs/36666019773 success（head_sha `c1917205`）
  - ci https://github.com/Xxx91n/anysearch-cli/actions/runs/36701973945 success（head_sha `85403a20`）
  - native-smoke https://github.com/Xxx91n/anysearch-cli/actions/runs/36701973948 success（head_sha `85403a20`）
- 本轮提交未外发（无 push / tag / publish —— 纪律内）；本机门禁终态见 `.scratch/grill-round-94/reports/2026-09-30-report.md`。

> 证据效力口径（ADR-0095 D6）：本机门禁在基线 `85403a20` 源码上已是 blocking（`process.exit(1)`），本轮复核确认其阻断效力不变（无源码 diff）。注：T0 预检因在途未登 CHANGELOG exit 1，本轮在途视作待完备暂态，该谓词倒置已在审计返修中如实记入 ADR-0095 与报告。
> 上述绿色 run 属本轮**共同基底**的祖先线实证，**不是**本轮提交的 CI 绿——本轮提交尚未外发，无对应远程 run。

## 票序终态（but-id 双锚）

| 票 | but-id | git sha (真实值) | 类型 | 结果 | 实证索引 |
|---|---|---|---|---|---|
| T0 哨戒+基线 | `nmz` | `53e9dc76` | chore+evidence | ✅ | `evidence/t0/t0-baseline.md` + check/test 全绿 + 全量 ship-gate 预检 |
| T0-F 触发式程序票 | — | — | docs | ⏭ **未触发** | 开庭资格核验成立（TC 未触发，标的未变），全轮正常推进开庭 |
| T1-1 carried_log 先行 | `kvs` | `bcde2ba9` | docs | ✅ | `docs/deferred-registry.json` 追加预通知指针条目（时序先行） |
| T1-2 ADR-0095 立法 | `zwl` | `317fe6e8` | docs | ✅ | `docs/adr/0095-*.md` + `docs/adr/index.md` 开庭立法本体 |
| T2 开庭取证 | `zss` | `6d8a0102` | evidence | ✅ | `evidence/t2/` 01~05 卷宗 + 综合卷宗，段 0 核验与段 1 取证齐备 |
| T3a 登记表落盘 | `mzp` | `dc6d5d48` | evidence | ✅ | `evidence/t3a/evidence-register-table.md`，可控锚=2（严谨具名口径，广义=3） |
| T3b 终审判词文书 | `vor` | `21fe1ec1` | docs+evidence | ✅ | `evidence/t3b/t3b-court-verdict.md` + `verdict.json`（reaffirm 机械落果） |
| T4 落地裁定 | `lkp` | `056d4e0a` | docs | ✅ | `docs/deferred-registry.json` 变更为 `formally-declined`，四项复活条件立案 |
| T5 deprecate 备准 | `lsm` | `eae2bd2d` | chore | ℹ️ 纯备准 | `evidence/t5-deprecate.md`（`credential-scope` 分型，6 版本命令续挂） |
| T6-1 ADR 完成体回填 | `rvx` | `99ad278a` | docs | ✅ | `docs/adr/0095-*.md` 完成体回填（判词果 + 双锚表 + carried_log 必备字段核对） |
| T6-2 词块与状态核对 | — | — | docs | ✅ | 词块并入 `ce62d7a1`，状态闭环并入 `056d4e0a`；41 项状态闭环（27 closed / 13 open / 1 formally-declined） |
| T6-3 claims+轮报+终态戳 | `mmy` | `3004a3c0` | docs | ✅ | `closeout-claims.json` 11 项 claims 登记，轮报落盘，终态戳写入 |
| T6-4 CHANGELOG 追加 | `kmm` | `54946c9c` | docs | ✅ | `CHANGELOG.md` 追加 r94 开庭轮记录 |
| T6-5 R95 交接件 | `ozw` | `57fc4a29` | docs | ✅ | `round-94-closeout.md` 落盘，claims 冻结声明，F3~F5 记账（索引追加 `0bde339f`） |
| T7 门禁+终验审计 | `pul` | `320d9e41` | evidence | ✅ | ship-gate 83 pass / 0 fail，10 阶段（step 0/9 至 9/9），578 篇 markdown 0 violation，进程测活终验 |
| TC 条件票 | — | — | — | ⏭ **未触发** | T0 目击无 `0.2.0` stable（`latest` = `next` = `0.2.0-rc.2`） |
| 审计产物归档 | `tql` | `a6e88137` | docs | ℹ️ 审计 | 审计报告 + 交接件归档，打回返修 5 项未申报偏差 |

注：双锚表全量映射真实 git sha；but-id 为唯一稳定锚。

## 终审判词（T3b 开庭落果）

**`verdict = reaffirm`（充分条件谓词命中，机械落果）**

- **充分条件谓词求值**：
  1. 重开判据实测为负：`TRUE`（R86 matrix@2 终读 P=0.0378、净 −0.125、EL=0.297、rankDiff 中位 0）
  2. 标的实存性成立：`TRUE`（ADR-0084 / ADR-0085 / ADR-0059 垂域三 ADR 链路在案存续）
  3. 可控复活条件数 $\ge 1$：`TRUE`（冻结可控锚计数 = 2，广义口径含条件①为 3，均 $\ge 1$）
- **落地形态**：`formally-declined`
- **原判据状态**：`|ΔarmHostHit|≳0.4` 废止并留存历史原由
- **复活条件集立案**：
  - 条件 ①（半可控）：dsh stable 晋升（npm tags 验证）
  - 条件 ②（纯外部不可控）：上游补垂域参数词表
  - 条件 ③（半可控，owner: anysearch-eval）：cn_code 契约补齐
  - 条件 ④（纯内部可控，owner: anysearch-eval）：新评测矩阵修订版读数
  - （注：原 spec 探索性复活条件⑥「跨模型泛化评测矩阵」因非垂域专属已剪枝剔除，不入案）

## claims 冻结声明（时序不变量锁闭）

依据 ADR-0095 D8 与 `goal.md` 治理闸纪律：
- **冻结点**：T6-3 commit `mmy`（`3004a3c0`）为本轮最后一个可增改 claims 实物的 commit。
- **实物条目总计数**：`11`
- **逐条状态与类型列表**：
  1. `r94-t0-watch` (symbol) — ✅ PASS
  2. `r94-t1-carried-log` (symbol) — ✅ PASS
  3. `r94-t1-adr` (symbol) — ✅ PASS
  4. `r94-t2-evidence` (path) — ✅ PASS
  5. `r94-t3a-register` (symbol) — ✅ PASS
  6. `r94-t3b-verdict-json` (field) — ✅ PASS
  7. `r94-t3b-verdict-doc` (symbol) — ✅ PASS
  8. `r94-t4-registry` (symbol) — ✅ PASS
  9. `r94-t5-deprecate` (symbol) — ✅ PASS
  10. `r94-t6-adr-completion` (symbol) — ✅ PASS
  11. `r94-t6-report` (symbol) — ✅ PASS
- **门禁比对纪律**：T7 仅作只读复证，严禁修改 `closeout-claims.json` 实物。若 T7 发现偏差，必须以「申报的偏差」如实记入交接，不得追写实物。本轮返修绝对未触碰 `closeout-claims.json`。

## F3/F4/F5 低项双态记账

核对本轮开庭前预注册协议：三果谓词与 tie-breaker 开庭前全量预注册进 ADR-0095，执行全程**零 predicate 临时修动**，满足记账前提。

| 项 | 事项 | 处置状态 | 责任主体 / 证据 |
|---|---|---|---|
| **F3** | commit 类型纯洁性（防 chore 混改 docs 面） | **done** | 本轮严格遵循一票一 commit 类型纯洁性，无跨类型混合提交 |
| **F4** | scope 命名一致性 | **deviated** | 历史提交包含 `ce62d7a1`（scope: `r94-grill`），未能全量统一为 `r94-t*` 前缀；审计指出后如实记为偏离并核销 |
| **F5** | 历史低项记账 | **deferred** | owner: `anysearch-eval`，历史呈报项不影响主逻辑，维持归档 |

## 挂账移交 R95 第一待办与待办集

1. **第一待办**：`defer-r93-deprecate-credential-scope` — 6 条 npm deprecate 命令纯备准续挂（见 `.scratch/grill-round-94/evidence/t5-deprecate.md` §3），分型为 `credential-scope`，等待具备权限的用户亲触执行（EOTP 不代跑）。
2. **第二待办**：垂域方向四项复活条件集 — `r88-candidate` 归档为 `formally-declined`，后续仅在四项具名复活条件满足时由 owner `anysearch-eval` 重新立案。
3. **第三待办**：常驻债项维持范围外 — `defer-r72-dsh-web-interactive-matrix`、`defer-f17` 等维持显式范围外候审。
