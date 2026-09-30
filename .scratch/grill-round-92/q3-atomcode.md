# R92 Q3 atomcode 调研归档 — 票序+commit 结构+条件票边界

> 存档 2026-09-30。ctx_batch_execute 派发（concurrency=1），7 searches/6 全文读，Confidence 高。

## TL;DR

A 案八票序+TC 整体符合工业界 gate-ordering 心智模型（高置信）——立法先于执行、条件票具名判词闸启停（Azure Deployment Gates/feature-gating 同构）、收口件批后置门禁审计。**采纳带两处补丁+四子题裁决**。

## 符合度核对表

T0 哨戒+基线（release readiness scope/基线先定）✅；T1 立法先于 T2（rule-before-behavior/DoD 三层）✅；T3 条件票具名闸（Azure「all gates succeed same interval」）✅词汇须从 t2-verdict 一字不差取；T4 无条件接线（检测器先行+两拍）✅补 dry-run；T5 deprecate 外发独立记账（change management）✅补双态措辞预注册；T6 收口批同质 docs ✅；T7 门禁+审计 LOOP（post-conditions 复核）✅；TC=T0 一次定死 ✅。

## 四子题裁决

① **L3b 词汇增补落点=新 ADR-0093 载明+标 ADR-0092 D1 revised-in-part**（Fowler「ADR accepted 不可重开或更改，应被 superseded 互链」/Azure WA「ADR=append-only log，变更写新记录互链」/Nygard 派同判；词汇表是 T5 机检法律依据，实质修订够格新 ADR；且 D-002 已立法「显式 revised 非静默」+R90 addendum 先例）。反向考据：ADR org 自述 mutability-in-practice 更好——但本仓先例与账本裁决已锁方向。
② **preflight tool_calls 探针=T2 票内前置**，T1 只立法「探针必须先行」的义务（Entry-Criterion Probe 法律本体是义务非执行；工业：smoke 是 build 第一闸属执行序非验收判据定义稿）。先例张力：R91 T1 独立探针票是因承担 gate 证据归档职责；R92 探针四态已实证（200/404/401/200），tool_calls 可见性是 T2 判词输入。探针败→T2 直落 F-bug 分支无独立票痕；证据归档 T2 evidence 根+verdict 记 preflight 行。
③ **deprecate=T5 位**（收口批+门禁审计前；npm 官方确认 registry 状态外发可 un-deprecate 回滚需 2FA/OTP；OWASP cheat sheet 列 remediation playbook；Azure change-management 外发单列）。隐藏依赖：closeout-claims 必须预设 deprecate 双态措辞（达成/未达成-EOTP 卡点），否则 T5 败连坐 T6 改稿。
④ **T4 首跑=接线票内 shadow/dry-run 取证（evidence-only、不入判词、不阻塞）+T6 显性挂账 R93 首跑专属机器腿**——新检测器合入必须一次非阻塞 shadow run（CircleCI/Harness：新检查先 shadow 后 enforce）；纯静默接线违可见性原则。dry-run 须在 evidence 写明 shadow 性质防审计误判两拍被破。

## 隐藏依赖与反对论据

1. **T2 机制风险=全序最大单点**：pi-ai patch 层 providers 覆写在 dsh 0.1.7-rc.2 无实证——R91 只证 tool 注册面，patch 注入是新面；不支持则反复 LOOP 触发熔断。预注册：「机制不可用（dump-config 无 featherless 痕迹）也落 F-bug 分支」，判词分支词汇已承载（not-established: [L3a]），避免现场发明分支。
2. **T3 措辞骑载风险**：fallback 收窄措辞不在已立法文本里——T3 现场拟措辞=条件票携带立法触纯度红线。裁决：收窄措辞随 ADR-0093 在 T1 立法（预注册 established 版/established-via-fallback 版两版），T3 只做选择与誊抄。
3. T0→TC 窗口一次定死承继，任务书写死。
4. T6 依赖 T2/T3/T4/T5 全部工件：收口件批按「全绿/降格/F-bug 三态」预写骨架。

## 备选矩阵

B（T4 并 T6）中低否——scripts 变更 vs docs 类型混票+接线败熔断连坐收口批+R91 T4a 独票先例；C（readme-token 推 R93）中否——违 D-001 current（接线=本轮无条件票）、推票需再立法；D 否。

## 信息缺口

pi-ai providers 覆写×dsh 0.1.7-rc.2 兼容性无公开信源（T2 实测对象，已映射隐藏依赖#1）；npm deprecate 组织级审批记账无权威模板（本仓 EOTP 惯例为替代）。

## 来源（7 检索/6 全文读）

Fowler ADR、Azure Well-Architected ADR guidance、Azure Deployment Gates、CircleCI smoke-test、npm deprecate 官方文档、ADR GitHub org（search+extract 双读）、kocakyazilim DoD、OWASP NPM cheat sheet、plane.so release checklist、Doppler、Harness 新检查 shadow 实践（摘要）。
