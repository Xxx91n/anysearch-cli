# Q4 atomcode 调研 — promote 证据通道与复跑协议（2026-09-16, grill-round-64）

## 执行摘要

**推荐 A——不是妥协而是工业标准形态的直接对应**（置信度高：Buildkite/Datadog/Trunk/Tuist RFC 四家独立收敛）。两核心点均有先例：①「quarantined-but-runnable」（隔离但实跑、失败不染 exit code）——skip 式隔离被 Tuist RFC 称为死路（quarantined=永远收集不到转绿信号=永远不能有证据地 reinstate），正是本仓 runner「打印 QUARANTINED+continue」缺陷的逐字镜像；②同一判定两处实现的处置先例=Buildkite 架构（判定收在账本侧，runner 只消费清单不复刻谓词）。

## 分点结论

**2.1 skip 式隔离是公认反模式**：Buildkite 官方「Muted tests continue running...detect when they become reliable；Skipped tests produce no execution data，cannot detect reliability」；Tuist RFC（2026-03 一手）：「no signal to determine if fixed…quarantined tests accumulate indefinitely」，解法与 A 同构（照常执行→隔离清单截获失败→仅隔离失败 exit 0 覆写→摘要单列）。核心洞察：「quarantine is about decoupling flaky failures from CI signal, not about hiding tests」。Datadog：Quarantined=background running，failures don't affect CI；且 broken（7 天 100% 败）不自动转 Fixed——截留误 reinstate。A 的「默认 continue、flag 才实跑」与 Buildkite bktec 默认排除+显式开启一致，比 Tuist「总是实跑」更保守=更成熟位。

**2.2 B/C 否决均有先例**：B=Buildkite 官方指令判定必须消费单一账本源，B 造第三份判定副本；且独立 job 是持续观测通道非一次性裁决工具（拿不到 flip-rate 历史）。C=Tuist 点名的主反模式「manually unquarantine and hope they pass」+Datadog 30 天无翻转才转正，C 方向颠倒（re-quarantine 比 reinstatement 更罕见更伤信用）。

**2.3 复跑阈值校准表**：

| 分档 | 实证对照 | 校准 |
|---|---|---|
| 稳定漂移 5 条 ≥1 绿 | 确定性失败非随机翻转，1 绿信息量大 | 1 绿本地+CI test-online corroboration=两个独立可解析自证点（双源 corroboration 是加强非冗余） |
| flaky 3 条 ≥5 跑 flip<0.2 | Gaffer：flip=翻转数/(runs-1)，5-10 runs 脱噪声，fixed 判据=最近 20 runs 0% | 5 跑为最低合格线（统计功效弱，最多容 1 翻转）→promote 后标 post-promote watch，CI 翻转即回退，棘轮「只减不增」兜统计功效 |
| verdict 改判 ≥2 稳定 | operatex「single green run fallacy」 | 改判是重新定性非修复验证，2 次独立+failure_class 已够格 |
| 宿主降格 ≥1 绿 | Datadog broken 截留 | 1 绿可，但绿 run 时间戳须落在降格后环境 |

诚实注脚：Mill-build 300-500 连绿标准适用连续概率 flake；本案是 provider 漂移致确定性/高翻转失败（flip 40%+），5-20 跑可有效区分——别被 300 吓到改成不可执行标准。

**2.4 evidence run 不 gate CI 三先例**：Trunk/Tuist=仅隔离失败则 exit 0 覆写（Tuist RFC exit-code 行为表可直接抄作实现规格）；Buildkite=exit code 按失败来源分流；Playwright/Gaffer=独立 project 收数据不阻塞。提醒：本地日志层 EVIDENCE FAIL 仍醒目是期望的；CI corroboration job 必须 observational-only（与 ADR-0054 abstain smoke 先例一致）。

**2.5 双实现漂移处置**：内联判定改调 activeIds() 是 **A 生效的前置非顺手项**——否则 evidence 模式自身继承 longterm 误判、产出污染证据日志。防复发=加 fixture 一致性单测：构造含 longterm/expired/retired 组合台账，断言 runner 隔离分类与 isActive() 逐条一致（Chromium finder 单测套件先例）。

**2.6 冲突检查：无冲突，一处增强**——Datadog broken 截留启示：稳定漂移/宿主降格两类若复跑**全红**应升级 retire 候选而非干等 TTL——evidence 模式对连续全红条目输出 RETIRE_CANDIDATE 标记喂 reviewDue()。EVIDENCE 行须带 id/结论/时间戳/run URL 四元组（可解析自证）。

## 信息缺口

- Trunk quarantining-tests 一手文档被登录墙拦（仅 Tuist RFC 转述，单源）；
- 复跑阈值无同行评审论文级实证；
- 「本地与 CI 环境差异致证据不可迁移」未深挖——以 CI corroboration run 作 promote 最终见证已闭合风险。

## 辩证附注（呈报人评估）

- 「CI corroboration 作最终见证」意味着 promote 后 CI 红了→按棘轮重入隔离（同 id ∈ baseline 合法）——post-promote watch 的回路靠棘轮天然存在，实现时只需文档化该回路。
- fixture 一致性单测是 Gate-of-the-Gate 的正路落点，成本低。
