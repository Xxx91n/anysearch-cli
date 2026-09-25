# Q5 atomcode 调研存档——垂域审计事件形态

Date: 2026-09-25. 原题见 q5-prompt.txt；调研经 ctx_batch_execute 自动索引（source: atomcode-r83-q5）。

## 裁定：A=新独立事件 retrieval.vertical.pre（Confidence：高）

OTel 官方判据直给：描述操作中独立 occurrence（零次或多次+需自己时间戳+occurrence-specific attrs）用事件；描述整个操作用 span attribute。垂域路由命中=与 host 过滤正交的独立 occurrence；实物约束「不能搭便车于现有事件触发条件」直接否决 B。

## 心智模型（工业惯例）

- 一 occurrence 一事件，事件名不含动态值 attrs 承载变化值（OTel semconv events 原文）
- 契约演化纪律：**加 attrs=向后兼容；改触发条件=行为破坏；改名/改结构=schema 迁移**（OTel versioning-and-stability+Honeycomb 迁移记录：17 个属性改名即 breaking 先例）
- 命名纪律：{domain}.{operation}.{phase} 全限定 namespace——retrieval.vertical.pre 与 retrieval.domain_filter.pre 平级，新轴入新 namespace 不混用

## 三案代价

- **A**：多一个事件名（增量非破坏）；与 domain_filter.pre 同构 attrs 形状镜像（生效值/来源层/sent/degraded）消费者解析习惯直接迁移；「命名爆炸」担忧不成立——vertical 是一条新轴非持续裂变家族，真正会爆炸的是把不相关轴塞进聚合事件后再拆。
- **B 致命伤**：触发条件 hostAllowlistActive→domainActive‖verticalSet=隐性 breaking change（既有消费者假设「收到该事件=host 策略激活」的假阳性；纯垂域流量下 domain/policy_version/allow_count/deny_count 语义空转=可选字段大杂烩；两轴计数混一事件=wide-event 之争中被证难审计的形态）。
- **C**：违反 OTel 分层判据（occurrence 不是操作整体描述）；审计实质损失=无法按事件名告警/索引/无独立时间戳/span 采样可丢（审计恰恰要求不丢）。

## Sufficiency Gate

searches: 4（AnySearch batch+Exa）；full reads: 3（OTel semconv events/traces/versioning-and-stability 原文）+Honeycomb+isburmistrov 摘要；gaps：Tavily 超限；wide-event 派若强烈主张须与仓内审计消费者实际查询模式对质——但「不搭便车」约束已使 B 不合规无需再争。
