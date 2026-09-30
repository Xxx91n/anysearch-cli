# Round 93 收口 — L3 修复续轮【换模三跑】（dsh-l3-smoke-kimi-rerun）

Stack: `r93-l3-rerun` on top of common base `c1917205` → main（未 land，未 push —— 纪律内）

## 绿色 run URL（祖先线实证）

- 本轮共同基底 `c1917205` CI 三跑全绿（本轮全部提交建立在其上，`git merge-base --is-ancestor c1917205 HEAD` → rc=0）：
  - ship-gate https://github.com/Xxx91n/anysearch-cli/actions/runs/36666019773 success（head_sha `c1917205`）
  - ci https://github.com/Xxx91n/anysearch-cli/actions/runs/36666019722 success（head_sha `c1917205`）
  - native-smoke https://github.com/Xxx91n/anysearch-cli/actions/runs/36666019690 success（head_sha `c1917205`）
- 本轮提交未外发（无 push / tag / publish —— 纪律内）；本机门禁终态见 `.scratch/grill-round-93/reports/2026-09-30-report.md`。

> 证据效力口径（ADR-0094 D6）：本机门禁产出为 **advisory 非 blocking**。
> 上述绿色 run 属本轮**共同基底**的祖先线实证，**不是**本轮提交的 CI 绿——本轮提交尚未外发，无对应 run。

## 票序终态

| 票 | but-id | 类型 | 结果 | 实证索引 |
|---|---|---|---|---|
| T0 哨戒+基线+探针 | `trm` | chore+evidence | ✅ | `evidence/t0/t0-baseline.md` + `t0-probes.md` + 三腿日志 |
| T1 ADR 立法 | `xrw` | docs | ✅ | `docs/adr/0094-*`（D1–D8） |
| T1 ADR index 更态 | `qom` | docs | ✅ | `docs/adr/index.md` 0094 行（`--check` 绿） |
| T2 三跑执行 | `pzv` | evidence | ✅ **established-via-fallback** | `evidence/t2/`（verdict + transcript 双工件 + 三跑 jsonl + dump-config + 直连 toolcall） |
| T-B 转向票 | — | docs | ⏭ **未启** | 谓词 `verdict == "F-bug"` 为假；白名单与议程零触碰 |
| T3 README 双语行对齐 | `qpu` | docs | ✅ | `README.md:227` + `README.zh-CN.md:217`（措辞版本 B 誊抄） |
| T4 机器腿首跑 | `zln` `sss` `syr` | evidence | ✅ 12/12 green | `closeout-claims.json` + `evidence/t4/` |
| T5 deprecate | `rsr` | chore | ℹ️ 纯备准 | `evidence/t5-deprecate.md`（`credential-scope` 分型） |
| T6 收口批 | `pqu` `zqq` + 本批 | docs | ✅ | CHANGELOG + registry 更态 + ADR 完成体 + 轮报 + 终态戳 |
| T7 门禁+审计 | — | — | ✅ | check/test 全绿 + ship-gate 闭环 + 审计 LOOP |
| TC 条件票 | — | — | ⏭ **未触发** | T0 目击无 `0.2.0` stable（`latest` = `next` = `0.2.0-rc.2`） |

注：文内 sha 均为**落笔时值**；but-id 为唯一稳定锚；land 后以 main `git log` 为准。

## 判词（T2 三跑）

**`verdict = established-via-fallback`，`branch_label = A`。**

| 腿 | 判词 | 依据 |
|---|---|---|
| L3a 装册绿 | `established` | `dsh --profile r93-kimi --dump-config` exit 0，8/8 断言 PASS |
| L3b 枚举绿 | `established-via-fallback` | 主判据缺席（stream 无 tools 枚举）；三跑各 1 个 `ans_*` tool_call 侧证 |
| L3c-min 执行绿 | `established` | `ans_search_web` 往返完成，8177B 真实检索载荷 `totalResults:10`；收窄判据下无幻觉调用 |
| L3c-full / L3d / L3e | `not-established` | **非判据**（非门槛） |

`established: [L3a, L3c-min]` · `established-via-fallback: [L3b]` · `not-established: [L3c-full, L3d, L3e]`

## 已核验的关键事实

- **换模成功**：冻结臂 `moonshotai/Kimi-K2-Instruct-0905` 取代 `Qwen/Qwen3-32B`。R91（env 缺）与 R92（reasoning 吞预算）两轮 F-bug 归因均落在旧臂，不再适用于新臂。
- **隔离 profile 生效**：`r93-kimi` 独立建档（不复用 `r92-smoke`，其 patch 硬编旧模型且属 R92 证据工件，本轮零触碰）。
- **L3c-min 收窄判据生效**：三跑 `tool_call` 的 `tool` 字段全为 `ans_search_web`，落在五 `ans_*` 白名单内 —— 0905 的未声明工具幻觉率未污染判词。
- **max-tokens 预算下限判据有实证支撑**：T0 探针证实 `max_tokens: 8` 即触发 `length` 且 content 截断，故诱导轮下限钉 2048（跑中三跑均未复现签名族三形态）。
- **换臂纪律**：换臂 0 次，≥2 换臂的 F-bug 复盘闸未武装。
- **凭证卫生闭环**：User-scope 注入（len=67，SHA-256 前缀 `64a88ea6`），泄漏探针双查（原文 + 前缀）全证据树 0 命中。
- **README 图章清偿**：三轮悬空的 live-verified 图章本轮落定，双语行版本 token 对齐实测宿主 `0.1.7-rc.2`。
- **机器腿首跑完成**：`readme-token-pin` 由 shadow 转真实非 shadow 断言，12/12 closeout-claims re-derived green，R92 挂账核销。
- **治理分型落地**：deprecate 权限缺口分型为 `credential-scope`（`npm whoami` E401），未谎报为 `maintainer` / `org-owner`。

## 执行期偏差（如实记账）

**T6④ CHANGELOG 前置于 T4 机器腿。** `scripts/ship-gate.mjs:776` 的 CHANGELOG 检查 `fail()` 即退，
而 `closeout-claims` 腿在 780 行之后 —— 当轮 CHANGELOG 缺失时 T4 机器腿在门禁内永不可达。
故 T6④ 提前落笔（`pqu`），T4 随后可跑。非绕过，是门禁顺序的真实依赖。

## 挂账（移交 R94）

1. **`r88-candidate-vertical-direction-redeliberation`** —— sunset 硬截止：**R95 前必须开庭**。
   R94 收口批**预通知义务**：在 registry `carried_log` 追加条目并点名 owner `anysearch-eval`，不得静默到期。
   开庭 ≠ 翻案：`reaffirm` / `revise` / `retire` 三果皆合法。
2. **`defer-r93-deprecate-credential-scope`** —— 6 条 `npm deprecate` 备准命令备妥，
   待具备发布权限的账号亲触执行（外发动作，EOTP）。
3. **证据效力口径复核（ADR-0094 D6）** —— d7 缺席下的保守默认（本机门禁 advisory）登记待 R94 裁定
   「本机门禁是否应升级为 blocking」。规则制定不混入收口票。
4. **常驻债续期** —— `defer-r72-dsh-web-interactive-matrix` 主体维持 defer（上游 `.d.ts` 键面仍缺席）；
   评测面（`defer-f17` 等）与常驻债清理维持本轮显式范围外。
5. **TC 窗口已定死** —— 本轮 T0 未目击 `0.2.0` stable（`latest` = `next` = `0.2.0-rc.2`），TC 不启。
   下轮若目击 stable，closing probe 为独立条件票。
