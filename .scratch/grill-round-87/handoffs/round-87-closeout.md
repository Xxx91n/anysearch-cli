# Round 87 收口 — 发布收口轮（release-closeout-ship）

Stack: r87-release-closeout + r87-grill（已 land，均不存）→ main；tag v0.1.0 @ 8292071c

## 绿色 run URL（本轮祖先线上的实证）

- 落栈 tip `a50cb2f6`：ci `https://github.com/Xxx91n/anysearch-cli/actions/runs/36372358387` success；ship-gate `https://github.com/Xxx91n/anysearch-cli/actions/runs/36372358502` success；native-smoke success
- pre-tag `https://github.com/Xxx91n/anysearch-cli/actions/runs/36372963603` success（账本 commit `8292071c`，自派发 ci+ship-gate 双腿绿）
- release（tag v0.1.0）`https://github.com/Xxx91n/anysearch-cli/actions/runs/36373586142` success（post-tag 断言 + publish OIDC 双腿）

## 票序终态

| 票 | 结果 | 实证 |
|---|---|---|
| T0 哨戒续班 | ✅ | t0-watch-2026-09-28.md 归档；锐评第七轮 4/4 全闭、第八轮「发布未发」本轮核销 |
| T0-fix 审计 | ✅ | r87-t0fix-audit-2026-09-28.md：修复本体 PASS；R-1~R-4 分流，LOOP 复核 EXIT=0 复跑通过 |
| T1 pre-tag | ✅ | run 36372963603；账本 sha 8292071c 落 main |
| T2 tag 外发 | ✅ | v0.1.0 挂 8292071c（D-004 语义锚）；release run 36373586142 全绿 |
| T3 发布验证 | ✅ 全绿 | post-release-verify-2026-09-28.md：5 包 latest=0.1.0 / integrity 逐字节 / tarball `/mcp` 在列 `/v1/search` 仅存守卫常量 / 净机 `ans --version`=0.1.0 / dsh-plugin 陌生人安装绿 / OIDC provenance logIndex 显式核验 / gh release 无对象=设计内 |
| T4 deprecate | ⏳ **挂账** | `npm deprecate @anysearch-cli/cli@<0.1.0` 迭代范围正确（0.0.3–0.0.8）但命中账户写操作 **EOTP** 闸，零写入半残留——待用户 OTP/自执，核销回执补记本档 |
| T5 记账件批 | ✅ | F-3 判据勘误脚注（r86 decision-record 追加段 + registry r87-f3-criterion-errata closed-by ADR-0088）；defer-r86×2 去向注记（carried_log 各具名触发维持 open）；R88 候选×2 入库（r88-candidate-f6-refactor-round / r88-candidate-vertical-direction-redeliberation）；锐评核账收尾并入本批 |
| T6 收口 | ✅ | 本档 + ADR-0088 + closeout-claims.json + CHANGELOG 已知缺陷段 + registry 注记 + 记账批入库 |

## 已核验的关键事实

- npm latest=0.1.0 ×5（cli/mcp/plugin/dsh-plugin/embedding），传播延迟分钟级为预期。
- tag v0.1.0 → 8292071c=pre-tag 账本回写 sha（验证的树=tagged 树，零分叉纪律保持）。
- publish OIDC：npm 11.6.1 + `--provenance`，sigstore transparency logIndex 逐包（embedding=2981305683 / cli=2981305731 / mcp=2981305817 …）。

## 挂账（下轮/用户侧）

- **T4 deprecate**：待 OTP。用户二选一：①自执 `npm deprecate "@anysearch-cli/cli@<0.1.0>" "Deprecated: bundled anysearch provider used a dead endpoint (route 404). Fixed in 0.1.0 — upgrade."`；②供 OTP 由 agent 带 `--otp` 执行。核销后 `npm view @anysearch-cli/cli@0.0.8 deprecated` 应见红标，回本档补一行核销回执。
- defer-r86×2：corpus-param-contract（下一矩阵期补 cn_code 或降格）/ anon-quota-nudge（用户侧 env 修正回执核销）——维持 open。
- dsh 哨戒：钉版 rc.1 在役，next=rc.2 候选越 48h 闸合格，无 rc.3；续班移交 R88。

## 下一次 grill 方向（R88 候选，已 registry 登记）

1. **F-6 refactor 施工轮**（推荐正题）：probe-anysearch-mcp-raw.ts `??`/`||` 一致化 + sanitize 对称遮 endpoint + 版本字面量护栏 + CHANGELOG 归位——独立 refactor commit，遵 ADR-0029。
2. **垂域方向重议候审**：prefer-capable 具名重开条件 |ΔarmHostHit|≳0.4 未达，作候选不复活。
