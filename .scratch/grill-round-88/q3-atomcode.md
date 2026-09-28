# R88 Q3 atomcode 调研归档

> 来源：atomcode -p（q3-prompt.txt）；串行单跑；已索引 ctx。Tavily 超限，Exa+AnySearch 双引擎+知识库召回。

## 1) 执行摘要

推荐 A【删解构】，Confidence 高。核心事实：MCP 契约面（AJV+additionalProperties:false）使 maxResults 从未作为契约存在——无外部消费者可依赖（Hyrum 定律前提为空），删除=零风险 dead-code 卫生；schema 增键=单方面扩张已发布公共契约的特性决策。两者属不同发布叙事（refactor vs semver minor），对应 ADR-0029 一轮一主题。最强反对论据（引擎已支持=砍能力）经辩证检验不成立：引擎内部支持≠契约面暴露，三入口行为已对齐统一默认 10。

## 2) 分点结论

结论1：删除判据是「契约上从未存在」而非「代码上曾经写过」。SO 判例「code is not used→throw away, benefit trivially derived from source control」+dev.to「repository is not a museum, git history is the museum」。maxResults 非 latent feature（无消费者经隐式接口依赖可观察行为——AJV 硬拒保证无 observable behavior 被依赖），是「从未上过契约面的手稿」。

结论2：B=特性交付非卫生修复——semver 叙事错位。契约演进共识：加可选字段=additive MINOR、删/收紧/改默认=breaking MAJOR（api-contract.com+semver.org+zuplo 三源）。B 需 Integer 边界设计+三入口一致+changelog 叙事，塞卫生轮违 ADR-0029 且造单口暴露新债。AI agent 语境更尖锐：tool schema 是 LLM ground truth，schema 每加一键扩大 agent 行为面与出错面（tianpan.co Schema Entropy：~60% 生产 agent 失败关联 tool versioning）。

结论3：「全表面不暴露=统一默认 10」本身是自洽已发布的行为契约——三入口无一暴露、统一引擎 ?? 10，是当前唯一被消费者实际依赖的契约。A 移除解构=契约保真修复（实现向 schema 收敛）。

结论4：MCP 生态走向更严 schema 纪律——官方 2026-07-28 spec 升级 tool inputSchema 至完整 JSON Schema 2020-12，additive 不升版本/breaking 用日期版本切割：契约增键应在特性轮按官方节奏走。

## 3) 对比矩阵

| 项 | 契约面影响 | 行为变化 | 发布叙事 | ADR-0029 | 遗留债 |
|---|---|---|---|---|---|
| A 删解构 | 零 | 零 | refactor/patch | 符合 due chore 独立 commit | 无；ADR 注记防复发 |
| B schema 增键 | 扩大已发布 MCP 公共契约（MINOR） | 有新能力解锁 | feature/minor | 违反混排 | 单口暴露不一致或三口扩面膨胀 |

## 4) 对 A 的辩证检验（最强反对论据）

反对：「引擎已完整支持+检索参数暴露是行业惯例（limit/size），删除=砍掉已设计好的能力，未来重写」。

反驳链：(1)「引擎支持」与「契约暴露」是两个发布决策——当前引擎支持只是内部 plumbing；保留永不生效的解构是「保留死接线」，读者/agent grep 到它会走错调试路径（dead code 搜索混乱+agent 误学成本）。(2)「未来重写」成本被高估——SO 判例+ADR 注记已把设计上下文写进账本，特性轮要做的边界/NaN/三入口设计无论如何从头做，一行解构零贡献。(3) 删除-保留不对称性反向成立——零行为变化位点的删除风险可证明为零，保留成本无界。

对 A 的真实代价（诚实记录）：未来暴露需求来临时 git 考古+ADR 注记是唯一恢复路径——由 ADR 注记条款对冲。

## 5) 裁决落地形态

- 删除 search-web.tool.ts:22 maxResults 解构与 :37 传参，refactor commit 不混特性面。
- ADR 注记（registry 原注兑现）：暴露 maxResults 是特性决策非卫生项；未来须特性轮正式设计（Integer 边界/NaN/负值/三入口一致性/semver minor 叙事）。
- 可选加固：单测断言「SearchWebInput 拒收 maxResults 键」——把契约不暴露固化为显式契约测试（schema entropy 的 CI 对策）。

## 6) 来源清单

tianpan.co Schema Entropy（tool schema=agent ground truth，60% 失败关联）/ Nordic APIs Hyrum 定律前提 / hyrumslaw.com 原文 / api-contract.com Versioning&Deprecation（additive=safe 判据）/ semver.org MINOR 定义 / dev.to The Code Nobody Will Delete / softwareengineering.stackexchange.com:103031 / zuplo.com 契约演进 / modelcontextprotocol.io Versioning。

## 7) 信息缺口

Tavily 配额耗尽双引擎顶替（关键结论≥2 信源）；无「schema 拒收型死参数」逐字同案公开判例（以 dead-code 判例+契约纪律类推）；MCP 0.1.0 消费者遥测不可得但不改结论（AJV 硬拒使任何行为无从触及）。