# Q6 atomcode 调研存档——垂域参数校验与发现策略

Date: 2026-09-25. 原题见 q6-prompt.txt；调研经 ctx_batch_execute 自动索引（source: atomcode-r83-q6）。

## 裁定：A=形状校验+服务端真理（Confidence：高）

客户端消费活词表的一致纪律=客户端只做结构校验（Tolerant Reader「validate extracted values not document structure」），枚举合法性与语义约束真理归服务端；非法值必须 fail loudly 落既有 fail-first 降级臂绝不静默吞零——与 R82 混合容错心智同构。

## 分点结论

1. **C=行业准则点名反模式**：ADP-768（Extensible Enumerations，引 Zalando）「初始值集不应视为完整；Client 应处理未知枚举值而非失败」；gpu-cli/openapi-to-rust 把「no client-side validation——server is source of truth」写成带测试钉死的保证；词表活面+硬编码=经典枚举副本漂移（每次上游加域=发布协调成本+漂移期静默错行为）。
2. **A 边界划得对**：Fowler Tolerant Reader 宽容结构；arc42 精确边界=验提取值的类型/范围/不变量非文档结构——非空字符串/Record 形状检查恰在线内；proto3 官方：未知枚举值保留透传非拒绝=「不内置枚举副本」是 wire-format 级共识。
3. **A+fail-first=fail loudly 无吞零**：arc42 明文「reject/alert/route to fallback——never silent default」；protogate 事故佐证（服务端返回未声明枚举→Zod decoder crash=错误必须边界显式暴露）；非法组合→isError→臂级降级+vertical.pre 审计=可观测错误反馈；代价仅错误反馈晚一跳 RTT。
4. **B 得不偿失**：直查=热路径延迟翻倍（get_sub_domains 独立往返非内联）；TTL 缓存=staleness 窗口+失效语义+缓存击穿=为服务端权威问题在客户端复制权威（违 SSoT）；收益仅「上游 isError 提前本地报」省一跳——为少数路径快一跳引入全路径状态机不划算。
5. **代价模型**：A 漂移成本=0/反馈延迟=1RTT 仅非法时/实现≈三个形状检查；B=全查询延迟税或缓存复杂度+伪真理；C=发布协调成本+漂移期静默错。

## Sufficiency Gate / 缺口

8 源（Fowler/arc42/proto3/GraphQL spec/ADP-768/gpu-cli commit/protogate/SO-SSoT）；Tavily 缺席照例双引擎补。
