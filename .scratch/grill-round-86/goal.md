# Grill Round 86 — Goal（定稿）

## 主题

`fix-r86-green-gate-ship`——绿门装船轮：装船前置的根因判别与绿门发布（D-001）。承接第八轮锐评核账：红门修复（andon 前置）→ defer-r85 根因判别 → 臂复活 → 全绿臂复跑 → 双平台门绿 → v0.1.0 切版——把 MCP 迁移+垂域贯通+dsh repin 等五轮积压运出码头；npm 0.0.3–0.0.8 全部已发布版的 anysearch 默认臂对 404 死路由的问题就此终结。

## 账本
5 条全 current（decision-ledger.md，无断号；D-001 含局部修订注记指向 D-004）：D-001 主轴+原子集五项 / D-002 红门修法（指纹清单） / D-003 判别探针矩阵 / D-004 复跑认识论（健康闸+判词降级） / D-005 票序+装船边界+预案+版本号。

## 票序（D-005）
T0 哨戒续班（dsh 0.1.7-rc.x watch+CI 观测+锐评第八轮核账归档）→ T1 红门修复（D-002 全套；双平台门绿实证后才推进）→ T2 defer-r85 判别实验（D-003 两批微分探针）→ T3 修复+臂复活（5/5 iso providersFailed 空判据；transient 则零代码核销+ADR 升级条款）→ T4 判读器语义修正+记分簿诚实化（D-004①②，先于 T5——判定者先于被判定物修订）→ T5 全绿臂复跑（D-004③：57 条原协议原指纹，iso providersFailed=∅+非空覆盖≥70%）→ T6 收口装船（registry 三联+CONTEXT 新词+ADR-0087+closeout-claims+v0.1.0 全包钉版）。

## 原子集（D-001）
①红门修复（D-002）②defer-r85 根因判别（D-003）③NO-GO 判词修正（D-004②升级版：indeterminate 降级）④阴性证据最小入库（D-002 manifest 首件）⑤pr-1764-comment.md Status 翻面。

## 不可复活预案（D-005 B1′）
根因=上游长期死→仍发版：MCP 迁移与上游健康正交；anysearch 臂 fail-open 一等降级装船（kill-switch 型先例）；装船条件降级为「根因落档+修复正确性实证」如实记；披露位置纪律=写进 README/装船判词显著位（known-issue 形态）。

## 数据源纪律
本轮整理唯一数据源=decision-ledger.md；结论不许只活在对话里；与本轮无关的回忆不补录。

## 承继基线
- R85 全程落地并审计 PASS（栈 rku→xrm+审计修复，基 7c94622f，已 land main tip 527c817）；项目首份预注册判读完成，终局 NO-GO（其 tied 实证依据本轮判为装置失效无效读数，判词降级 indeterminate——D-004②）。
- 锐评第七轮全清+第八轮四处方两刀三小刀本轮全收编；#1764/#1087 两稿已外发核销。
- 痛点承继：构建信息专精 Agent CLI，遵循 AnySearch 垂直领域理念——本轮把垂域贯通+修复面装船，并为 prefer-capable 预留具名重开条件。
- 环境事实：ANYSEARCH_API_KEY 在场（不录值）；ANYSEARCH_ENDPOINT 用户配置域不录不代改。

## 常驻哨戒承继
- dsh 0.1.7-rc.x 版本线 watch；test-online-anysearch CI 腿观测；llm-init SSE flake watch。
- 敏感域：ANYSEARCH_ENDPOINT/KEY 值不记录不入档（只记存在性/错误类别）。

## 显式范围外（本轮新增+承继不回潮）
- 本轮新增：旧 defer 清障（empty-endpoint/a03/a06/a08/engine coalesce/canonicalizeVertical/MCP 缩进/control 口径/Standards 9 smell/finding-8）走独立 refactor commit 或顺延 / prefer-capable 加权实施 / ip 第五域 / pathlint 维持冻结 / 缩容冒烟冒充全程证据 / 新数据直接改判（peeking 变体）/ 追溯复算 R85 旧件 / kind:machine-local 断言类立法 / 跑批产物原件入库 / ANS_PROVIDERS 名义匹配深挖（已基本排除）。
- 承继 R84/R85：LLM judge 进闸 / delta 显著性阈值 / 全 17 域浅摊 / peeking 二次读数 / p 值门禁 / 优先级调度序 / 跨文件 boy-scout / 工件混级 / INCONCLUSIVE 无具名触发。

## 遗留呈报项（grill 末复核）
- 调研缺口随档：Q1 复合轮节奏治理无直接成文先例（类比论证）；Q2 kind:machine-local 无直接同构先例（本身即反对证据）；Q3 无 MCP 断连恢复专门统计；Q4「装置失效复跑非 peeking」属 protocol-deviation 强类比无专门判例；Q5 upstream-dead 下游发布逐字判例有限。
- 审计窗踩红签字的工序教训已立法为 checklist 硬项（D-002 随票同落）。
- B1 预案的披露位置纪律须在 T6 装船判词/README 显著位落实。
