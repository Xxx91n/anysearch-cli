# R77-Q2 atomcode 调研存档 — watch-and-rehearsal 管线分层 + 触发器锚定

> Source: atomcode -p (q2-prompt.txt) @ 2026-09-22. Engines: AnySearch 主引擎（Exa/Tavily 额度耗尽降级）+ 多域名官方文档互证（renovatebot.com/github.blog/docs.github.com/api-extractor.com/microsoft.github.io）。Confidence: 中高。

## 执行摘要

不是「版本监控器」而是**分层漏斗+特征锚定触发器**：零安装静态探针（registry metadata+tarball .d.ts diff）做每日廉价哨兵；昂贵全量安装彩排只留给「静态探针报警+过 48h 龄期闸+rc-or-stable」候选；adoption 触发器从版本号锚定（「0.1.6-rc.1 存在」——已被 leapfrog 证伪）改为特征锚定+稳定性锚定（「agent/created 事件出现在 rc/stable 版本+changelog 审查通过」）；被跳窗版本不欠逐个彩排但欠墓碑记录（Renovate latest-only/Dependabot 冷却跳最新同构）。

## (a) 静态探针 vs 全量彩排 = 漏斗三层（非二选一）

| 层 | 手段 | 检出 | 成本 | 局限 |
|---|---|---|---|---|
| L0 元数据 | npm view versions --json + publish timestamp | 新版本存在/通道/发布时间（喂龄期闸） | 近零 | 看不到 API |
| L1 静态 | npm pack tarball→解包 .d.ts→与当前 pin 做 API report diff | 重命名/删除/签名变更——无需安装不碰 lockfile，天然不受 pnpm 闸管辖也不构成 bypass | 低（可每日 cron） | 看不到运行时行为/类型体操误报/无编译验证 |
| L2 彩排 | repin→install→tsc 期望 RED | 权威判定（编译器终裁） | 高（脏工作区需隔离） | 受 48h 闸约束=设计非缺陷 |

先例：Microsoft API Extractor 的 API report 机制（公共 API 签名固化 .api.md git-tracked，「diff only occurs when a significant contractual change has occurred」）；Azure SDK apiguard（azure-sdk-for-js#22983 两版 API 破坏检测）。关键洞察：兼容警报本质=consumer 侧 API report——对自己 pin 版的消费面生成 API 期望快照，对候选 tarball .d.ts 同法提取，diff=候选破坏面证据预览，可直接归档 evidence transcript 并先验预测 L2 的 expected-RED。分层理由（Renovate 官方）：install 触发 lockfile 重算，传递依赖可能绕 age gate——故 Renovate 建议包管理器侧也配 minimumReleaseAge；pnpm 侧闸已卡 L2，L1 是闸门内唯一能自由探测闸门外版本的层。

## (b) 龄期闸交互 = respect-and-schedule，绝不 bypass

- Renovate minimumReleaseAge（前身 stabilityDays）设计原文「not to slow down fast releasing project updates, but to reduce supply chain security risks」；未过期版本标 pending status check 挂 Dependency Dashboard，到期自动 passing=respect-and-schedule 教科书实现（观察继续/动作延迟/无豁免通道；甚至拒绝信任发布者自报时间戳要求 registry 提供，防恶意回填）。internalChecksFilter=strict 时未过闸更新连分支都不建。
- Dependabot 2026-07 起默认内置 3 天冷却期（default-days:3 按 semver 级可调，exclude 可豁免但默认不开）。
- 失败模式在案：Renovate 曾放行无时间戳版本（42 版起改 fail-closed「absence of timestamp = not yet past」）；internalChecksFilter 非 strict 时 pending 版本阻塞其他更新（discussion #39315）。
- 三模式对号：respect-and-schedule=✅（闸内只观察+归档，到期自动触发彩排）；scratch-dir bypass=❌（实质提前消费未检疫版本，doctrine 连贯性>单次信息收益，且 L1 已能答 80% 问题）；gate exemption=❌（fail-open-with-exceptions，Dependabot exclude 设计为例外非通道）。

## (c) 触发器 = 特征判定「要不要关心」+ 稳定性判定「能不能采纳」+ 版本号只做记录

- 版本锚定已实证失败：registry 锚 0.1.6-rc.1 而 0.1.6 只有 alpha、0.1.7-alpha.1 已出——pre-release 生态常态非意外。Renovate versioning 文档把 prerelease 跨线跳转列为独立关注点；「rc.2→只跟随同 major.minor.patch 预发布」，跨预发布线追踪需 isCurrentVersionStable/isNewVersionStable 新字段（discussion #37146）——上游 leapfrog 应假设会发生。
- 特征锚定先例：feature-detection-over-version-detection 是消费侧 API 演化标准教义（"ontouchstart" in window vs UA sniffing；CDC/契约测试同思想——消费者只断言自己需要的交互不断言提供者版本身份，Microsoft Engineering Playbook+martinfowler.com/consumerDrivenContracts）。落地：触发器=「候选 .d.ts 存在 agent/created 事件且 payload 含 source/signal，且版本为 rc-or-stable」——事件名恰是字符串级可静态检测，.d.ts diff 天然即特征探测器。
- 稳定性锚定：alarm 可对 alpha 响（跟随发布走），adoption 只对 rc-or-stable+changelog 审查（跟随稳定性走）=Dependabot 冷却只管 version updates/紧急通道另设的分层哲学；Renovate ignoreUnstable 默认 true。
- 版本号降级为 transcript 记录字段+.d.ts diff 的 key，永不进触发逻辑。「0.1.6-rc.1」触发条件应立即改写：0.1.6-rc.1 永不发布→触发器死锁；0.1.7 直接出 rc→触发器漏接。

## (d) rehearsal-debt = latest-only + 墓碑记录

- 彩排义务对「当前最新候选」非「每个发布过版本」；每次跳窗留档。Renovate 只对当前最优候选做 pending/passing 判定；Dependabot 冷却结束直接跳最新符合条件版本，中间版本当作从未存在——无主流工具维护 per-version 彩排债。
- 跳窗版本欠**墓碑条目**非彩排：「version X: superseded by Y before rehearsal; static probe result: <L1 diff summary>」。理由：(1) Y 彩排 GREEN 则 X 兼容性被传递证明（X→Y 无新破坏面，需 L1 diff 背书）；(2) Y RED 时破坏面归因需知道哪一跳引入——X 的 L1 快照即归因证据；(3) per-round evidence transcript 治理要求的债务面实现。
- 节奏赶不上时的正确收缩=降层非减少：闸期内 L0/L1 每日扫描（廉价可全自动留档），每个闸门出口只放一个 L2 候选=「每个发布都有 L1 证据+每个采纳候选都有 L2 裁决」，与 Renovate pending 挂 dashboard 到期才建分支同构。

## 推荐管线（综合）

每日 cron：L0 npm view 拉新版本+timestamp→喂龄期闸日历；L1 每新版 tarball→.d.ts→与 pin API 快照 diff→含破坏特征（agent/created, source/signal）→标 ALARM 写 evidence transcript→过闸且 rc|stable 且 ALARM→排 L2；L2（每闸门出口至多一候选）repin→install→tsc expected-RED→transcript 归档→GREEN+changelog 审→adoption 窗口开。债务：跳窗版本写墓碑（version, superseded-by, L1-diff-summary）。触发器：删版本锚定→特征锚定+稳定性锚定。

## 信息缺口（诚实记录）

1. @deepseek-ai/dsh-* 发布节奏与 rc→stable 转换习惯无可核验快照——「0.1.6 是否会出 rc」纯未知，这正是必须改特征锚定的最硬理由（触发器不应依赖无法预测的事实）。
2. Renovate/Dependabot 无「rehearsal debt」概念——(d) 结论是机制推导+行为佐证缝合，无一手指名文献。
3. L1 .d.ts diff 误报率（重导出/命名空间膨胀/条件类型噪声）需一次实测校准；API Extractor report 承诺是库作者自报场景，跨库对比噪声待实测。
4. pnpm minimumReleaseAge 对 catalog repin 的确切拦截行为=本地实验项（npm 侧 --before/ETARGET 边缘行为有 Renovate 文档，pnpm 实现未覆盖）。
5. 三引擎交叉未达成：Exa 402/Tavily plan limit，AnySearch 单引擎+5 域名互证。
