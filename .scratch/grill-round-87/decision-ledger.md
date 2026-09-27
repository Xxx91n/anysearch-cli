# Grill Round 87 — Decision Ledger

Slug: grill-round-87
Started: 2026-09-28
Theme: 锐评完成度辩证核账 + R87 方向裁决（候审）
Status format: current / revised / stale / deferred

---

（记录自此往下追加——每条含 ID / 原问题 / 用户原回答原文 / 规范化需求 / 显式约束·负向需求 / 状态）

---

---

## D-001 — R87 主轴裁决：发布收口轮（A′）+ deprecate 止血随票采纳

- **原问题**：R87 主轴——A 发布收口轮 / B 裁量清障轮 / C 战略方向轮 / D 另指。（经 atomcode 调研修订为 A′）
- **用户原回答原文**：采纳
- **规范化需求**：R87=「发布收口轮」。主线=用户授权（本采纳即授权）→ v0.1.0 tag push+npm publish → 发布后实物验证（npm 拉真实 tarball 拆包验 /mcp 端点在列、dsh-plugin 陌生人安装路径、install-smoke 对已发布件、npm view dist-tags/integrity 复核）→ registry/CHANGELOG/ADR 收口。顺收：F-3 判据裁量=【改判据表述】单选（把字面判据改写为包含装置性失败的等价表述——语义已达成、不引入新变量不破坏预注册、不留永久脚注）+ defer-r86 两票去向注记。随票采纳：发布后对 0.0.3–0.0.8 执行 npm deprecate 止血（标注死端点、指向 0.1.0——调研自标缺口外推项，以候选身份被采纳）。
- **关键语义**：真测量版 NO-GO 是裁决线信号而非发布阻断——发布准入（工程就绪）与产品方向裁决（实验裁决）是两道独立的门；NO-GO 构成尽快发布的理由（送测量基础设施产物出去，next experiment 有干净基线）。
- **显式约束/负向需求**：发布轮不混排工程项（release execution 直线段）；F-6 refactor 出列立项 R88 候选（或与方向重议轮按 ADR-0029 分轮）；C 战略方向重议顺延 R88（prefer-capable 具名重开条件 |ΔarmHostHit|≳0.4 未达，此刻重议=goalposts 移动反模式）；用户侧 env 修正不代办（defer-r86-anon-quota-nudge 挂账）；钉版不再动包（immutable artifact）。
- **依据**：atomcode 调研 q1-atomcode.md（PostHog staged-not-shipped 前提不满足、LaunchDarkly 发布轮不混排、flaviocopes+R63 发布验证三段论、mindtheproduct 判据未触发不重开、beefed 不载客列车反模式）。
- **状态**：current

---

## D-002 — 发布执行授权边界（B′ 最后一寸手动）+ deprecate 精准范围文案（D1′）

- **原问题**：Q2a 执行边界——A agent 端到端 / B agent 停 tag push 前最后一寸手动 / C 另指；Q2b deprecate 范围——D1 只 cli@0.0.3–0.0.8 / D2 全 5 包 / D3 不做。（经 atomcode 调研修订为 B′+D1′）
- **用户原回答原文**：采纳
- **规范化需求**：
  - **执行边界（B′）**：agent 跑 pre-tag dispatch（gh workflow run release.yml -f runPurpose=pre-tag）→ 等门绿 → **停手交用户** `git push origin v0.1.0`（tag 挂审计 tip cfb0fff7）→ publish OIDC 自动 → **agent 恢复执行**发布后实物验证（npm view dist-tags/integrity、tarball 拆包验 /mcp、陌生人安装、install-smoke 对已发布件）→ deprecate 止血 → 收口报告。人只碰一次扳机（署名外发动作=问责签名），其余全程自动化（发布后验证=只读动作划回 agent）。
  - **deprecate（D1′）**：npm deprecate `@anysearch-cli/cli@<0.1.0` `Deprecated: bundled anysearch provider used a dead endpoint (route 404). Fixed in 0.1.0 — upgrade.`——range 写法 <0.1.0 优于枚举（0.1.0 起不含死路径）；**不发 Security Advisory**（404 死路由=功能缺陷非安全漏洞，避免 Dependabot 假警报）；止血两件套=deprecate+release notes/CHANGELOG 已知缺陷段。
  - **deprecate 时序**：显式排在「发布后实物验证绿」之后、收口之前（fix 确认在架再标旧版，防提前 deprecate）。
- **显式约束/负向需求**：agent 不得执行 git push tag（署名外发动作=用户问责签名面）；tag 必须挂 cfb0fff7（已审计 PASS 的 tip，不可挂未审 SHA）；钉版不再动包；deprecate 只标 cli 不扩大误伤（死路径载体已测绘只在 cli dist，其余 4 包功能完好）；C 方案 Environment reviewers 记为多人化迁移目标不实施。
- **依据**：atomcode 调研 q2-atomcode.md（Azure DevOps 三层审批模型/GitHub Environment reviewers/Auth0 capability-scoped 授权/npm 官方 deprecate+unpublish 政策/最小正确范围惯例；A 方案无外发先例且与外发闸红线+verified-by 签名先例同构性反向）。
- **状态**：current（B′「agent 不碰 tag push」条款经 D-004 本轮解除——授权下放）

---

## D-003 — R87 票序（A′ 发布先行，记账随收口）+ OIDC 首版验证覆盖

- **原问题**：轮结构票序——A 发布先行记账随收口 / B 记账先行 / C 另排。（经 atomcode 调研修订为 A′）
- **用户原回答原文**：采纳
- **规范化需求**：六票序——T0 哨戒续班（dsh 0.1.7-rc.x watch+CI 观测+锐评两轮完成度核账归档入 reports/）→T1 pre-tag dispatch（agent：gh workflow run release.yml -f runPurpose=pre-tag，等绿）→T2 用户 git push origin v0.1.0（tag 挂 cfb0fff7=当前 tip，零分叉）→T3 发布后实物验证（agent：npm view dist-tags/integrity+tarball 拆包验 /mcp+净机 install-smoke 对已发布件+dsh-plugin 陌生人安装；**新增：publish job OIDC 日志显式核验**——覆盖 npm/cli#8544 首版 OIDC 特殊路径，非仅看绿标）→T4 deprecate 止血（D1′）→T5 记账件批（F-3 判据表述勘误 decision-record/registry 脚注不溯改+defer-r86×2 去向注记+R88 候选登记=F-6 refactor 轮+垂域方向重议题）→T6 收口（registry 注记+ADR-0088+closeout-claims+CHANGELOG 已知缺陷段+任务书）。
- **显式约束/负向需求**：tag 必须在 pre-tag 前无新 commit 落地（保持 tag=tip=审计 SHA 零分叉+「dispatch 验证的树=tagged 树」一致）；记账件全部属「不进制品」类一律 publish 后落（F-3 勘误/defer 注记/R88 登记/锐评归档——进制品内容只余 R86 已在位的 CHANGELOG 0.1.0 段与版本钉版）；禁止记账先行导致 tag 与 tip 分叉；禁止在 tag 前写预测态发布记录。
- **依据**：atomcode 调研 q3-atomcode.md（进制品/不进制品二元时序——Zhortein checklist/Qube/agentops release-notes 失败案例/Keep a Changelog [Unreleased] 机制；tag 挂非 tip SHA 合法理由全为排除性；B 与 D-002 冲突坐实）。
- **状态**：current（T2 字面锚「tag 挂 cfb0fff7」经 D-004 重钉为「pre-tag 完成后 main tip」——原锚 sha 的 ship-gate check 落栈后实测为红，post-tag 断言对 tagged sha 不可变核验故物理不可达）

---

## D-004 — tag 锚点重钉 + tag push 授权下放（修订 D-002 B′ 边界与 D-003 T2 字面锚）

- **原问题**：T0 修复审计 R-1——cfb0fff7 的 ship-gate check（run 36331503150 双平台 handoff-lint 红：栈期绿证 run headSha 经落栈改写全部孤儿化）在 tagged-sha 不可变断言下物理不可达，账本字面锚「tag 挂 cfb0fff7」与零分叉纪律不可两全；同时用户将 tag push 外发动作本轮授权下放给 agent。
- **用户原回答原文**：「分流的四个R小问题，请你以最优方案解决，之后LOOP复核通过。通过后，合并所有分支并push，之后拿到Ci结果，直到为绿色。绿色后，之后删除已经合并的分支，给你权限进行tag push发版（npm login已经登录）」
- **规范化需求**：tag 挂载点=pre-tag 完成后的 main tip（release.yml pre-tag 把 eval-looks.json 账本 commit 推上 main，tip 即该回写 sha——其五族 check 经 release-gate-ledger 临时 ref 自派发验证为绿）。语义锚保持：tag=当前 tip、验证的树=tagged 树、零分叉。tag push 由 agent 执行（D-002 B′「最后一寸手动」本轮解除，仅本轮）。
- **显式约束/负向需求**：tag 不得挂未验证 SHA（仍挂「落栈+账本回写后、五族 check 实测绿」的 main tip）；pre-tag 判词须未过期（TTL 30d，本轮当次新 look）；deprecate/验证票序不变；用户侧 env 修正仍不代办。
- **依据**：T0 修复审计报告 .scratch/grill-round-87/reports/r87-t0fix-audit-2026-09-28.md（gh api+merge-base+门禁源码+复跑全证据链）。
- **状态**：current
