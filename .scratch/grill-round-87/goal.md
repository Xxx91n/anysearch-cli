# Grill Round 87 — Goal（定稿）

## 主题
`release-r87-closeout-ship`——发布收口轮：把已审计的 v0.1.0 运出码头（D-001）。承接锐评两轮完成度核账——两份锐评唯一未闭伤口=货架上 latest=0.0.8 仍带已测绘证明 404 死路由的 anysearch 默认端点；本轮完成「授权→tag+publish→发布后实物验证→deprecate 止血→收口」全程。

## 账本
3 条全 current（decision-ledger.md，无断号无 revised）：D-001 主轴+顺收项+deprecate 随票 / D-002 执行边界 B′+deprecate D1′ / D-003 票序 A′+OIDC 首版验证覆盖。

## 票序（D-003）
T0 哨戒续班（dsh 0.1.7-rc.x watch+CI 观测+锐评两轮完成度核账归档入 reports/）→ T1 pre-tag dispatch（agent：gh workflow run release.yml -f runPurpose=pre-tag，等绿）→ T2 用户 git push origin v0.1.0（tag 挂 cfb0fff7=当前 tip，零分叉——agent 停手交接点）→ T3 发布后实物验证（agent：npm view dist-tags/integrity+tarball 拆包验 /mcp+净机 install-smoke+dsh-plugin 陌生人安装+publish job OIDC 日志显式核验）→ T4 deprecate 止血（D1′：cli@<0.1.0）→ T5 记账件批（F-3 判据表述勘误+defer-r86×2 去向注记+R88 候选登记）→ T6 收口（registry+ADR-0088+closeout-claims+CHANGELOG 已知缺陷段+任务书）。

## 执行边界（D-002）
agent 不碰 git push tag（署名外发动作=用户问责签名面）；人只碰一次扳机；发布后验证=只读动作划回 agent。

## deprecate 处方（D-002 D1′）
npm deprecate "@anysearch-cli/cli@<0.1.0" "Deprecated: bundled anysearch provider used a dead endpoint (route 404). Fixed in 0.1.0 — upgrade."——不发 Security Advisory（功能缺陷非安全漏洞）；止血两件套=deprecate+release notes/CHANGELOG 已知缺陷段；时序=发布后验证绿→收口前。

## 关键语义
真测量版 NO-GO 是裁决线信号而非发布阻断——发布准入（工程就绪）与产品方向裁决（实验裁决）两道独立的门；NO-GO 构成尽快发布的理由。

## 数据源纪律
本轮整理唯一数据源=decision-ledger.md；结论不许只活在对话里；与本轮无关的回忆不补录。

no-changelog-entry: 发布执行轮——0.1.0 条目系 R86 定稿随版本出仓；本轮止血注记随 T6 落既有 0.1.0 段下（已知缺陷段），不新增轮级 CHANGELOG 条目

## 承继基线
- R86 全程落地并三轮审计 LOOP PASS（栈 kry→pln+审计修复 xur，基座 cfb0fff7）：红门修复+根因落档（env 层双重缺陷）+真测量 NO-GO（P=0.0378）+v0.1.0 全包钉版+双平台门绿。
- 锐评第七轮全闭、第八轮仅剩发布未发一项；prefer-capable 具名重开条件（|ΔarmHostHit|≳0.4）未达。
- 痛点承继：构建信息专精 Agent CLI——本轮把 MCP 迁移+垂域贯通+测量基础设施产物运出码头。

## 显式范围外（本轮新增+承继不回潮）
- 本轮新增：F-6 refactor 施工（R88 候选）/ 垂域方向重议（R88 正题候选，具名重开条件未达）/ Security Advisory（功能缺陷非安全）/ deprecate 扩至其余 4 包（无死路径）/ agent 执行 tag push / tag 挂非审计 SHA / 记账先行致 tag 与 tip 分叉 / 预测态发布记录 / 用户侧 env 修正代办。
- 承继 R86：旧 defer 清障（独立 refactor commit 惯例）/ prefer-capable 加权实施 / ip 第五域 / pathlint 冻结 / kind:machine-local 立法 / 跑批产物原件入库 / 敏感值入档。
- 承继 R84/R85：LLM judge 进闸 / delta 显著性阈值 / 全 17 域浅摊 / peeking 二次读数 / p 值门禁 / 优先级调度序 / 跨文件 boy-scout / 工件混级 / INCONCLUSIVE 无具名触发。

## 遗留呈报项（grill 末复核）
- 调研缺口随档：Q1「审计账本+发布收口」无完全同构公开先例；Q2 agent 全权外发无先例（故 B′）；Q3 npm/cli#8544 首版 OIDC 限制未深挖——已转为 T3 显式核验项。
- B′ 边界为「未定义域补立法」：账本原无明文禁止 agent push tag，本轮 D-002 显式定死。
- deprecate 为调研缺口外推项经用户随票采纳，落点文案已按 npm 惯例精化（range 非枚举）。

## T0 审计修订注记（2026-09-28，补记不溯改）
- **票序 T2 字面锚作废**：「tag 挂 cfb0fff7」物理不可达——该 sha 的 ship-gate check 落栈后实测为红（栈期绿证 run headSha 孤儿化，run 36331503150 双平台 handoff-lint），post-tag 断言对 tagged sha 做不可变五族核验。重钉为「tag 挂 pre-tag 完成后的 main tip（账本回写 sha）」；语义锚（tag=当前 tip、验证树=tagged 树、零分叉）不变。
- **D-002 B′ 边界本轮解除**：用户授权 agent 执行 tag push（ledger D-004）。
- 账本增列 D-004（current）；D-002/D-003 相关条款局部修订，原文不溯改。
