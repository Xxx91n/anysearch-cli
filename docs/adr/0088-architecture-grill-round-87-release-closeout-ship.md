# ADR-0088: Grill Round 87 — 发布收口轮（孤儿绿证勘误 + tag 语义锚 + OIDC 装船实证 + deprecate 处方）

## Status

Accepted (grill round r87; 主轴票 release-closeout-ship). Records T0–T6 per task book `.scratch/grill-round-87/handoffs/next-round.md`. Ledger: `.scratch/grill-round-87/decision-ledger.md` (D-001~D-004). Evidence root: `.scratch/grill-round-87/`（reports/ 记账件 + post-release-verify-2026-09-28.md）。

## Context

R86 收口把 v0.1.0 钉在仓内但未出码头：npm latest=0.0.8 仍在架，其默认打包端点为已退休的 `/v1/search` 死路由（ADR-0082 迁移已完成于包内，但货架上卖的是旧件）。R87 唯一主轴=把已审计的 v0.1.0 运出去（D-001），deprecate 随票（止血两件套），方向裁决显式不做。

## Decision

### D1 红门根因与修复形态（孤儿 SHA 新子类）

T0 实物核验推翻「tip 双平台门绿」快照：ship-gate run 36331503150 在 cfb0fff7 双平台红，红因=handoff-lint——round-86-closeout.md 引用的 6 个绿证 run 的 headSha 全部孤儿化（GitButler 落栈改写历史），liveness 腿要求至少一条引用解析到当前祖先线，6/6 实测 ORPHAN。审计窗第三次踩红签字的新子类：**「落栈改写致绿证悬空」**（R79 工作区脏→R85 机器本地路径→R86 孤儿 SHA，同一漏洞族=证据件与落库树的绑定断裂）。

修复=**补记式勘误而非门禁弱化**（wtm，恰好 +2 行）：closeout 追加引用落栈终态绿证 run（ci 36331503157 / native-smoke 36331503087，head_sha=cfb0fff7 在祖先线），并显式披露孤儿化成因。门禁断言面零改动；goal.md 补 `no-changelog-entry:` 豁免（发布轮结构内已有 0.1.0 段，freshness 腿所需）。

### D2 授权边界修订与 tag 语义锚（D-002/D-004）

原账本字面锚「tag 挂 cfb0fff7」在执行期被证不可达：①该 sha 的 ship-gate check 已红且不可变，post-tag 断言五族必败；②pre-tag 流程必然把 OF 账本回写 commit 推上 main，tip 再前移。审计修正（R-1）+ 用户授权下放（D-004）：**tag 锚=pre-tag 完成后的 main tip（账本回写 sha），语义锚不变——tag=已审计绿 tip、验证的树=tagged 树**。实际执行：main a50cb2f6 三族绿 → pre-tag run 36372963603 落账本 sha 8292071c 并自派发验绿 → `git push origin v0.1.0` 挂 8292071c。

### D3 二元时序（D-003 票序保持）

pre-tag → tag → 验证 → deprecate → 收口，账本 sha 与 tag push 之间零新 commit（双树零分叉）。记账件（reports/）全程未提交，收口批一次性入库——揭示的已知假象：记账件在档期间本地裸跑 ship-gate 必红 step-0 clean-tree（`.scratch/*` ignore + r87 纳管反排除使 reports/ 对 porcelain 可见），CI 树无此态，签名重验以落栈后 CI 为准。

### D4 deprecate 处方（D-002 D1′）

`npm deprecate "@anysearch-cli/cli@<0.1.0>" "…dead endpoint (route 404). Fixed in 0.1.0 — upgrade."`——范围只 cli 不扩 4 包（其余包不含 bundled 端点配置面）；不发 Security Advisory（功能缺陷非安全漏洞）；时机=T3 全绿实证后、收口前。**执行态如实记账**：命令迭代范围正确（0.0.3–0.0.8）但命中 npm 账户写操作 OTP 闸（EOTP），零写入半残留——本项挂账待用户 OTP/自执，核销即 closeout-claims 翻 green。

### D5 发布后实物验证（T3 全绿实证）

只读拉取 registry 逐项复核（非凭 CI 绿标），实录 `.scratch/grill-round-87/reports/post-release-verify-2026-09-28.md`：

- dist-tags：5 包 latest=0.1.0（cli/mcp/plugin/dsh-plugin/embedding）；npm 传播分钟级延迟为预期行为。
- integrity：本机复算 sha512 与 registry dist.integrity 逐字节一致。
- tarball 拆包：`/mcp` 重写逻辑在制品内；`v1/search` 仅存 `LEGACY_REST_SUFFIX` 守卫常量（退休检测用），非调用点。
- 净机陌生人安装：temp 空目录 `npm i @anysearch-cli/cli@0.1.0` → `ans --version`=0.1.0、命令面全列；`@anysearch-cli/dsh-plugin@0.1.0` 安装绿、runtime deps=0（ADR-0073 churn lint 断言面吻合）。
- OIDC 显式核验：publish job 日志逐包 `Signed provenance statement … from GitHub Actions` + sigstore transparency logIndex——npm/cli#8544 首版 OIDC 路径实证，非仅看绿标。
- gh release 面：无 GitHub Release 对象——release.yml publish-only 管线设计内，记录为核对结果而非疏漏。

## Consequences

- v0.1.0 在架，死端点件（0.0.x）挂上 deprecate 后止血闭环；锐评第八轮「发布未发」核销。
- 新红门子类「孤儿 SHA 绿证」的防御已在制度内：handoff-lint 的祖先解析语义本身抓住了它——教训是 closeout 引用绿证时必须引**落栈后**的 run。
- R88 候选已机器可检登记：F-6 refactor 施工轮 + 垂域方向重议候审（prefer-capable 具名重开条件未达）。
