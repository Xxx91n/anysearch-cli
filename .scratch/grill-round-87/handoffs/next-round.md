# R87 Release Closeout — Handoff（任务书）

Stack: r87-release-closeout（新建）——基座=origin/main tip（cfb0fff7，R86 审计 LOOP-3 PASS 态）
Branch protection: 不推 main；发布执行面遵 D-002 修订面（T0 审计修订：tag push 授权下放 agent——ledger D-004）。

## 状态快照（接手时实物核验而非凭本档）
- 账本：.scratch/grill-round-87/decision-ledger.md 3 条全 current（D-001 主轴/D-002 边界+deprecate/D-003 票序）。
- npm latest=0.0.8（死端点在架）；v0.1.0 已在仓内钉版（R86 T6），tag v0.1.0 未推。
- 审计 tip=cfb0fff7（LOOP-3 时 PASS；**T0 审计勘误：其 ship-gate check 落栈后实测为红——栈期绿证 run headSha 孤儿化致 handoff-lint 悬空，wtm 修复实录见 .scratch/grill-round-87/reports/t0-watch-2026-09-28.md**）。
- 发布机制（ADR-0059/0067/0069/0072）：pre-tag dispatch 花 OF look+账本回写+自派发双腿等绿 → tag push 断言判词未过期+tagged SHA 双腿绿 → publish job npm OIDC trusted publishing 自动发 5 包（cli/mcp/plugin/dsh-plugin/embedding）。
- 敏感域：ANYSEARCH_ENDPOINT/KEY 值不入档；npm OIDC 无 token 面。

## 票序任务表（每票覆盖的 D-xxx + suggested skills）

### T0 哨戒续班（覆盖 D-003 T0）
- 对象：dsh 0.1.7-rc.x 版本线 watch；test-online-anysearch CI 腿观测；llm-init SSE flake watch。
- 工件：.scratch/grill-round-87/reports/t0-watch-*.md + **锐评两轮完成度核账归档**（锐评.txt 第七轮全闭+锐.txt 第八轮仅剩发布未发→本轮核销过程实录，入 reports/）。
- skills：neat-freak（台账）／context-mode（检索比对）。

### T1 pre-tag dispatch（覆盖 D-002 边界 / D-003 T1）
- 动作：`gh workflow run release.yml -f runPurpose=pre-tag`——OF look+账本回写+自派发 ci+ship-gate 在账本 sha 等绿。
- 验收：pre-tag run success；账本回写 commit 出现；双腿绿。
- **此票前禁止任何新 commit 落地**（D-003：保持 tag=tip=审计 SHA 零分叉+验证的树=tagged 树）。
- skills：grilling（判读纪律）。

### T2 tag 外发（覆盖 D-002 边界修订 / D-003 T2 / D-004）
- **T0 审计修订（R-1）**：tag 挂 **pre-tag 完成后的 main tip（账本回写 sha）**——cfb0fff7 字面锚作废（该 sha ship-gate check 红且不可变）；语义锚不变（tag=已审计绿 tip、验证的树=tagged 树）。
- **D-004 授权**：本轮用户已下放 tag push 给 agent——`git tag v0.1.0 <pre-tag 完成后实测 main tip>` + `git push origin v0.1.0`，不再停手交接。
- 呈报内容：pre-tag run URL+绿证、tag 实际挂的 SHA、push 后将发生的事（post-tag 断言→publish OIDC 自动）。
- tag push 后 agent 续跑 T3-T6。
- skills：handoff（交接面文案）。

### T3 发布后实物验证（覆盖 D-001 验证清单 / D-003 T3+OIDC 覆盖）
- npm view @anysearch-cli/cli version dist-tags（latest=0.1.0）+integrity 复核；
- npm pack 拉真实 tarball 拆包验 `/mcp` 端点在列、`v1/search` 不在；
- 净机 temp 目录 install-smoke 对已发布件（ans --version=0.1.0+核心命令活）；
- dsh-plugin 陌生人安装路径验证；
- **publish job OIDC 日志显式核验**（npm/cli#8544 首版特殊路径——非仅看绿标）；
- gh release 面核对。
- 工件：reports/post-release-verify-*.md（每项证据附命令+输出）。
- skills：grilling／domain-modeling（Release Closeout Round/Two-Piece Bleed Kit）。

### T4 deprecate 止血（覆盖 D-002 D1′）
- 前置：T3 全绿实证。
- 动作：`npm deprecate "@anysearch-cli/cli@<0.1.0" "Deprecated: bundled anysearch provider used a dead endpoint (route 404). Fixed in 0.1.0 — upgrade."`
- **不发 Security Advisory**（功能缺陷非安全漏洞）；只标 cli 不扩 4 包。
- 验证：npm view 红标生效。
- skills：domain-modeling（Deprecation Precision）。

### T5 记账件批（覆盖 D-001 顺收 / D-003 T5）
- F-3 判据表述勘误：R86 decision-record+registry 勘误脚注（不溯改正文——字面判据 iso providersFailed=∅ 未达 vs 装置性失败=∅+覆盖 97.6% 语义判据达成，改写为等价表述）。
- defer-r86×2 去向注记：corpus-param-contract（语料解冻后修 cn_code）/anon-quota-nudge（用户侧 env 修正回执核销）维持 open 各具名触发。
- R88 候选登记：F-6 refactor 轮（probe-mcp-raw ??/|| 一致化+sanitize 对称+版本字面量护栏+CHANGELOG 归位）+垂域方向重议轮（prefer-capable 具名重开条件未达，作正题候选）。
- 锐评核账归档收尾。
- skills：domain-modeling（Scoreboard Honesty Correction 惯例）／neat-freak。

### T6 收口（覆盖 D-001/D-003 T6）
- registry 注记（发布完成+deprecate 完成+R88 候选）；
- **ADR-0088** 立档（发布收口轮全程：授权边界/二元时序/deprecate 处方/验证证据）；
- closeout-claims.json 本轮条目（npm latest 版本断言/tarball /mcp 在列/OIDC 日志/deprecate 生效/F-3 勘误在场等机器可验项）；
- CHANGELOG 已知缺陷段（止血两件套第二件）；
- 任务书更新+closeout 交接。
- skills：handoff／neat-freak／domain-modeling。

## 显式范围外（账本负向需求汇总）
F-6 refactor 施工（R88）/方向重议（具名重开条件未达）/Security Advisory/deprecate 扩 4 包/agent 碰 tag push/tag 挂非审计 SHA/记账先行致分叉/tag 前预测态记录/用户侧 env 修正代办/旧 defer 清障（独立 refactor commit）。

## 汇报纪律
单任务隔离报；敏感值遮蔽；发布状态分层（draft→PR→merged→deployed→live-verified→knowledge-closed→cleaned 如实标位）；「已发布」仅当 npm view 实物复核后落档；deprecate 前后都要 npm view 实证。
